import { isTruthyEnv } from "../core/env-flag";
import { type LlmfitModel, llmfitRecommend } from "../core/llmfit-adapter";
import { findLlmfitMatch } from "../core/llmfit-capability-prior";
import { llmfitRoutingPrior } from "../core/llmfit-fitness-bridge";
import { createLlmfitRunner } from "../core/llmfit-runner";

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

export function createLlmfitCapabilityPriorResolver(
	models: readonly LlmfitModel[],
): LlmfitCapabilityPriorResolver | undefined {
	if (models.length === 0) {
		return undefined;
	}
	return (realName) => {
		const match = findLlmfitMatch(realName, models);
		return match ? llmfitRoutingPrior(match).capabilityPrior : null;
	};
}

/**
 * Opt-in only: when `NKLEIN_LLMFIT_PRIOR` is truthy, run/cache `llmfit recommend` and return a cold-start capability
 * prior resolver for loaded-model REAL names. Disabled by default, so normal task starts and decompositions remain local.
 */
export async function loadOptInLlmfitCapabilityPriorResolver(
	opts: {
		env?: Readonly<Record<string, string | undefined>>;
		loadModels?: () => Promise<readonly LlmfitModel[]>;
	} = {},
): Promise<LlmfitCapabilityPriorResolver | undefined> {
	const env = opts.env ?? process.env;
	if (!isTruthyEnv(env.NKLEIN_LLMFIT_PRIOR)) {
		return undefined;
	}
	const models = await (opts.loadModels ?? loadCachedLlmfitModels)().catch(() => [] as LlmfitModel[]);
	return createLlmfitCapabilityPriorResolver(models);
}
