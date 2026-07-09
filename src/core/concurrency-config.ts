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

import { z } from "zod";

/** A sparse map of key (providerId or canonical modelId) → max concurrent sessions. Absent key = no limit from this layer. */
export type ConcurrencyMap = Record<string, number>;

export interface ConcurrencyConfig {
	/** Global per-provider caps. */
	perProvider: ConcurrencyMap;
	/** Global per-model caps (canonical `provider:model:endpoint` id). */
	perModel: ConcurrencyMap;
	/**
	 * Global per-LM-Studio-host caps keyed by `lms ps --json` machine id (`local` for the current host, linked device
	 * identifiers for LM Link machines). Sparse so configs without host caps keep their existing on-disk shape.
	 */
	perHost?: ConcurrencyMap;
	/**
	 * Global per-ENDPOINT caps keyed by endpoint/baseUrl — todo §5.AB per-machine pools (user 2026-06-29). LM Studio links
	 * each machine as a distinct endpoint, so an endpoint cap IS the machine pool's concurrency. Optional + sparse so
	 * configs that don't use pools keep their exact shape (no round-trip change).
	 */
	perEndpoint?: ConcurrencyMap;
}

/** A per-project override layer: a sparse map per grain; only the keys a project overrides appear. */
export interface ConcurrencyOverride {
	perProvider?: ConcurrencyMap | null;
	perModel?: ConcurrencyMap | null;
	perHost?: ConcurrencyMap | null;
	perEndpoint?: ConcurrencyMap | null;
}

/**
 * Wire schemas for the §5.W config threading (runtime-config + tRPC contract). Lenient on the number values — the
 * `normalize*` writers above clamp to [1,256] and drop blanks/out-of-range on load — but shape-correct, so the
 * contract round-trips the two grains. `concurrencyOverride` mirrors the nullable-per-grain project-override shape.
 */
export const concurrencyMapSchema: z.ZodType<ConcurrencyMap> = z.record(z.string(), z.number());
export const concurrencyConfigSchema = z.object({
	perProvider: concurrencyMapSchema,
	perModel: concurrencyMapSchema,
	perHost: concurrencyMapSchema.optional(),
	perEndpoint: concurrencyMapSchema.optional(),
});
export const concurrencyOverrideSchema = z.object({
	perProvider: concurrencyMapSchema.nullable().optional(),
	perModel: concurrencyMapSchema.nullable().optional(),
	perHost: concurrencyMapSchema.nullable().optional(),
	perEndpoint: concurrencyMapSchema.nullable().optional(),
});
// Compile-time drift guards: keep the wire schemas in lockstep with the threaded types.
const _concurrencyConfigGuard: z.ZodType<ConcurrencyConfig> = concurrencyConfigSchema;
const _concurrencyOverrideGuard: z.ZodType<ConcurrencyOverride> = concurrencyOverrideSchema;
void _concurrencyConfigGuard;
void _concurrencyOverrideGuard;

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
	const perHost = normalizeConcurrencyMap(value?.perHost);
	const perEndpoint = normalizeConcurrencyMap(value?.perEndpoint);
	return {
		perProvider: normalizeConcurrencyMap(value?.perProvider),
		perModel: normalizeConcurrencyMap(value?.perModel),
		// Sparse: only emit perHost when a host cap is actually set, so older two-grain configs round-trip unchanged.
		...(Object.keys(perHost).length > 0 ? { perHost } : {}),
		// Sparse: only emit perEndpoint when a pool cap is actually set, so non-pool configs round-trip unchanged.
		...(Object.keys(perEndpoint).length > 0 ? { perEndpoint } : {}),
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
	const perHost = normalizeConcurrencyMap(value.perHost);
	const perEndpoint = normalizeConcurrencyMap(value.perEndpoint);
	const hasProvider = Object.keys(perProvider).length > 0;
	const hasModel = Object.keys(perModel).length > 0;
	const hasHost = Object.keys(perHost).length > 0;
	const hasEndpoint = Object.keys(perEndpoint).length > 0;
	if (!hasProvider && !hasModel && !hasHost && !hasEndpoint) {
		return null;
	}
	return {
		...(hasProvider ? { perProvider } : {}),
		...(hasModel ? { perModel } : {}),
		...(hasHost ? { perHost } : {}),
		...(hasEndpoint ? { perEndpoint } : {}),
	};
}

/** The empty default (no caps from this layer) — the §5.W runtime-config threading's `…Defaults` fallback. */
export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = { perProvider: {}, perModel: {} };

function areConcurrencyMapsEqual(
	left: ConcurrencyMap | null | undefined,
	right: ConcurrencyMap | null | undefined,
): boolean {
	const a = left ?? {};
	const b = right ?? {};
	const aKeys = Object.keys(a);
	if (aKeys.length !== Object.keys(b).length) {
		return false;
	}
	return aKeys.every((key) => a[key] === b[key]);
}

/** Change-detection equality for the global config (mirrors `areCodeEmbeddingSettingsEqual`, §5.W threading). */
export function areConcurrencyConfigsEqual(left: ConcurrencyConfig, right: ConcurrencyConfig): boolean {
	return (
		areConcurrencyMapsEqual(left.perProvider, right.perProvider) &&
		areConcurrencyMapsEqual(left.perModel, right.perModel) &&
		areConcurrencyMapsEqual(left.perHost, right.perHost) &&
		areConcurrencyMapsEqual(left.perEndpoint, right.perEndpoint)
	);
}

/** Change-detection equality for the nullable per-project override. */
export function areConcurrencyOverridesEqual(
	left: ConcurrencyOverride | null,
	right: ConcurrencyOverride | null,
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		areConcurrencyMapsEqual(left.perProvider, right.perProvider) &&
		areConcurrencyMapsEqual(left.perModel, right.perModel) &&
		areConcurrencyMapsEqual(left.perHost, right.perHost) &&
		areConcurrencyMapsEqual(left.perEndpoint, right.perEndpoint)
	);
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

/** The effective per-ENDPOINT (machine-pool) cap for a session, or null when no layer sets one (§5.AB per-machine pools). */
export function resolveEffectiveEndpointConcurrency(
	endpoint: string,
	input: { global?: ConcurrencyConfig | null; override?: ConcurrencyOverride | null },
): number | null {
	return resolveKeyCap(endpoint, input.override?.perEndpoint, input.global?.perEndpoint, null);
}

/** The effective per-LM-Studio-host cap for a session, or null when no layer sets one (§5.AB host caps). */
export function resolveEffectiveHostConcurrency(
	hostId: string,
	input: {
		global?: ConcurrencyConfig | null;
		override?: ConcurrencyOverride | null;
		/** Optional lowest-precedence uniform host cap, kept for the legacy `NKLEIN_PER_MACHINE_MAX_CONCURRENCY` env. */
		fallback?: number | null;
	},
): number | null {
	return resolveKeyCap(hostId, input.override?.perHost, input.global?.perHost, input.fallback ?? null);
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
	/** Max concurrent sessions for this session's LM Studio host/machine id (null = no host-grain limit). */
	hostCap: number | null;
	/** Max concurrent sessions for this session's ENDPOINT/machine pool (null = no endpoint-grain limit). */
	endpointCap: number | null;
}

/**
 * Resolve both grains for one session. The scheduler admits the session only when running-for-provider < providerCap
 * AND running-for-model < modelCap (both gates independent; a null cap is "no limit from that grain").
 */
export function resolveSessionConcurrencyCaps(input: {
	providerId: string;
	modelId: string;
	/** The session's endpoint/baseUrl (its machine pool). Optional so existing callers are unaffected until pool-wired. */
	endpoint?: string | null;
	/** The LM Studio host/machine id from `lms ps --json` (`local` for the current host). */
	hostId?: string | null;
	global?: ConcurrencyConfig | null;
	override?: ConcurrencyOverride | null;
	registryModelFallback?: number | null;
	hostFallback?: number | null;
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
		endpointCap:
			input.endpoint && input.endpoint.trim().length > 0
				? resolveEffectiveEndpointConcurrency(input.endpoint, { global: input.global, override: input.override })
				: null,
		hostCap:
			input.hostId && input.hostId.trim().length > 0
				? resolveEffectiveHostConcurrency(input.hostId, {
						global: input.global,
						override: input.override,
						fallback: input.hostFallback ?? null,
					})
				: null,
	};
}
