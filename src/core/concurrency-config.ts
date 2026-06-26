/**
 * Per-provider + per-model concurrency configuration (todo §5.W, user 2026-06-26).
 *
 * The user wants the swarm's parallelism tunable at two grains — per model PROVIDER (e.g. lmstudio / ollama / a custom
 * local endpoint) and per MODEL — each as a GLOBAL default with a per-PROJECT override. This module is the pure
 * resolution + normalization core that the runtime-config threading, the endpoint scheduler (§6.5), and the Settings UI
 * all consume; persistence + wiring are added on top (mirrors how `model-fitness` / `model-behavior-profile` landed).
 *
 * Precedence for the effective cap of a key (a providerId or a canonical modelId): **project override ?? global default
 * ?? a lower-precedence fallback** (for models, the existing per-model registry `maxConcurrentRequests` constraint, §5.T,
 * so today's setting still applies when no config value is set). A `null`/absent cap means "no extra limit" (the
 * endpoint scheduler's default serialization still applies). A session is admitted only when it clears BOTH its
 * provider cap and its model cap (the scheduler ANDs them), so the two grains compose without conflict.
 */

/** A sparse map of key (providerId or canonical modelId) → max concurrent sessions. Absent key = no limit from this layer. */
export type ConcurrencyMap = Record<string, number>;

export interface ConcurrencyConfig {
	/** Global per-provider caps. */
	perProvider: ConcurrencyMap;
	/** Global per-model caps (canonical `provider:model:endpoint` id). */
	perModel: ConcurrencyMap;
}

/** A per-project override layer: a sparse map per grain; only the keys a project overrides appear. */
export interface ConcurrencyOverride {
	perProvider?: ConcurrencyMap | null;
	perModel?: ConcurrencyMap | null;
}

/** The minimum a concurrency cap may be (1 = fully serial). 0/negative/non-finite are dropped as "no cap". */
const MIN_CONCURRENCY = 1;
/** A sane ceiling so a typo can't admit thousands of parallel sessions. */
const MAX_CONCURRENCY = 256;

function normalizeCap(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const truncated = Math.trunc(value);
	if (truncated < MIN_CONCURRENCY) {
		return null;
	}
	return Math.min(MAX_CONCURRENCY, truncated);
}

/** Drop blank keys + out-of-range values, clamp to [1, 256]. Returns a fresh, canonical map (sorted keys). */
export function normalizeConcurrencyMap(value: unknown): ConcurrencyMap {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const out: ConcurrencyMap = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		const trimmed = key.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const cap = normalizeCap((value as Record<string, unknown>)[key]);
		if (cap !== null) {
			out[trimmed] = cap;
		}
	}
	return out;
}

export function normalizeConcurrencyConfig(value: Partial<ConcurrencyConfig> | null | undefined): ConcurrencyConfig {
	return {
		perProvider: normalizeConcurrencyMap(value?.perProvider),
		perModel: normalizeConcurrencyMap(value?.perModel),
	};
}

/**
 * A per-project override returns null when it adds nothing (no keys), so the project config file stays clean — mirrors
 * the `normalize*Override` (returns-null-when-default) convention the other per-project overrides use (§5.W).
 */
export function normalizeConcurrencyOverride(
	value: ConcurrencyOverride | null | undefined,
): ConcurrencyOverride | null {
	if (!value) {
		return null;
	}
	const perProvider = normalizeConcurrencyMap(value.perProvider);
	const perModel = normalizeConcurrencyMap(value.perModel);
	const hasProvider = Object.keys(perProvider).length > 0;
	const hasModel = Object.keys(perModel).length > 0;
	if (!hasProvider && !hasModel) {
		return null;
	}
	return {
		...(hasProvider ? { perProvider } : {}),
		...(hasModel ? { perModel } : {}),
	};
}

function resolveKeyCap(
	key: string,
	override: ConcurrencyMap | null | undefined,
	global: ConcurrencyMap | null | undefined,
	fallback: number | null | undefined,
): number | null {
	const overridden = override?.[key];
	if (typeof overridden === "number") {
		return overridden;
	}
	const globalValue = global?.[key];
	if (typeof globalValue === "number") {
		return globalValue;
	}
	return normalizeCap(fallback);
}

/** The effective per-provider cap for a session, or null when no layer sets one. */
export function resolveEffectiveProviderConcurrency(
	providerId: string,
	input: { global?: ConcurrencyConfig | null; override?: ConcurrencyOverride | null },
): number | null {
	return resolveKeyCap(providerId, input.override?.perProvider, input.global?.perProvider, null);
}

/** The effective per-model cap for a session: override ?? global ?? the per-model registry `maxConcurrentRequests`. */
export function resolveEffectiveModelConcurrency(
	modelId: string,
	input: {
		global?: ConcurrencyConfig | null;
		override?: ConcurrencyOverride | null;
		/** The §5.T registry `maxConcurrentRequests` constraint — the lowest-precedence fallback. */
		registryFallback?: number | null;
	},
): number | null {
	return resolveKeyCap(modelId, input.override?.perModel, input.global?.perModel, input.registryFallback ?? null);
}

export interface SessionConcurrencyCaps {
	/** Max concurrent sessions for this session's provider (null = no provider-grain limit). */
	providerCap: number | null;
	/** Max concurrent sessions for this session's model (null = no model-grain limit). */
	modelCap: number | null;
}

/**
 * Resolve both grains for one session. The scheduler admits the session only when running-for-provider < providerCap
 * AND running-for-model < modelCap (both gates independent; a null cap is "no limit from that grain").
 */
export function resolveSessionConcurrencyCaps(input: {
	providerId: string;
	modelId: string;
	global?: ConcurrencyConfig | null;
	override?: ConcurrencyOverride | null;
	registryModelFallback?: number | null;
}): SessionConcurrencyCaps {
	return {
		providerCap: resolveEffectiveProviderConcurrency(input.providerId, {
			global: input.global,
			override: input.override,
		}),
		modelCap: resolveEffectiveModelConcurrency(input.modelId, {
			global: input.global,
			override: input.override,
			registryFallback: input.registryModelFallback ?? null,
		}),
	};
}
