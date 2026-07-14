import { isTruthyEnv } from "../core/env-flag";
import { type LlmfitModel, llmfitRecommend } from "../core/llmfit-adapter";
import { findLlmfitMatch } from "../core/llmfit-capability-prior";
import { type LlmfitRoutingPrior, llmfitRoutingPrior } from "../core/llmfit-fitness-bridge";
import { createLlmfitRunner } from "../core/llmfit-runner";

export type LlmfitRoutingPriorResolver = (realName: string) => LlmfitRoutingPrior | null;
export type LlmfitCapabilityPriorResolver = (realName: string) => number | null;

/** Process-level cache of llmfit's scored models (opt-in prior) - run once; llmfit's DB does not change per route. */
let cachedLlmfitModels: readonly LlmfitModel[] | null = null;

async function loadCachedLlmfitModels(): Promise<readonly LlmfitModel[]> {
	if (cachedLlmfitModels) {
		return cachedLlmfitModels;
	}
	const result = await llmfitRecommend(createLlmfitRunner()).catch(() => ({
		models: [] as LlmfitModel[],
		system: null,
	}));
	cachedLlmfitModels = result.models;
	return result.models;
}

export function createLlmfitRoutingPriorResolver(
	models: readonly LlmfitModel[],
): LlmfitRoutingPriorResolver | undefined {
	if (models.length === 0) {
		return undefined;
	}
	return (realName) => {
		const match = findLlmfitMatch(realName, models);
		return match ? llmfitRoutingPrior(match) : null;
	};
}

export function createLlmfitCapabilityPriorResolver(
	models: readonly LlmfitModel[],
): LlmfitCapabilityPriorResolver | undefined {
	const resolveRoutingPrior = createLlmfitRoutingPriorResolver(models);
	return resolveRoutingPrior ? (realName) => resolveRoutingPrior(realName)?.capabilityPrior ?? null : undefined;
}

/**
 * F2.7b: resolve a model's NORMALIZED llmfit capability ids (e.g. `["vision", "tool_use"]`) from the cached catalog —
 * the chat send seam's vision gate. Fail-closed: an unknown model / empty catalog / llmfit error resolves `[]`, so
 * images are refused rather than sent to a model not known to read them. Cached (llmfit's DB doesn't change per turn).
 */
export async function resolveLlmfitModelCapabilityIds(modelId: string): Promise<readonly string[]> {
	const models = await loadCachedLlmfitModels().catch(() => [] as LlmfitModel[]);
	return findLlmfitMatch(modelId, models)?.capabilityIds ?? [];
}

/**
 * Opt-in only: when `NKLEIN_LLMFIT_PRIOR` is truthy, run/cache `llmfit recommend` and return score/tok/s routing priors
 * for loaded-model REAL names. Disabled by default, so normal task starts and decompositions remain local.
 */
export async function loadOptInLlmfitRoutingPriorResolver(
	opts: {
		env?: Readonly<Record<string, string | undefined>>;
		loadModels?: () => Promise<readonly LlmfitModel[]>;
	} = {},
): Promise<LlmfitRoutingPriorResolver | undefined> {
	const env = opts.env ?? process.env;
	if (!isTruthyEnv(env.NKLEIN_LLMFIT_PRIOR)) {
		return undefined;
	}
	const models = await (opts.loadModels ?? loadCachedLlmfitModels)().catch(() => [] as LlmfitModel[]);
	return createLlmfitRoutingPriorResolver(models);
}

export async function loadOptInLlmfitCapabilityPriorResolver(
	opts: {
		env?: Readonly<Record<string, string | undefined>>;
		loadModels?: () => Promise<readonly LlmfitModel[]>;
	} = {},
): Promise<LlmfitCapabilityPriorResolver | undefined> {
	const resolveRoutingPrior = await loadOptInLlmfitRoutingPriorResolver(opts);
	return resolveRoutingPrior ? (realName) => resolveRoutingPrior(realName)?.capabilityPrior ?? null : undefined;
}

export function llmfitPriorPredictedWallTimeMs(
	prior: LlmfitRoutingPrior | null | undefined,
	outputTokens: number,
): number | null {
	const tps = prior?.estimatedTps ?? null;
	if (tps === null || tps <= 0 || !(outputTokens > 0)) {
		return null;
	}
	return Math.round((outputTokens / tps) * 1000);
}
