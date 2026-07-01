import type { RuntimeConfigState } from "../../config/runtime-config";
import { isTruthyEnv } from "../../core/env-flag";
import { type LlmfitModel, llmfitRecommend } from "../../core/llmfit-adapter";
import { llmfitCapabilityPrior } from "../../core/llmfit-capability-prior";
import { createLlmfitRunner } from "../../core/llmfit-runner";
import { fetchLoadedModelDescriptors } from "../../core/lmstudio-loaded-model-descriptors";
import { buildLoadedModelRoutingCandidates } from "../nklein-loaded-model-candidates";
import { resolveLoadedModelProfile } from "../nklein-loaded-model-profile";
import { getDefaultNKleinModelRegistry } from "../nklein-model-registry";
import { createNKleinProviderService } from "../nklein-provider-service";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { buildNKleinStartGuardCandidate } from "../nklein-task-start-guard";

/** Process-level cache of llmfit's scored models (opt-in prior) — run once; llmfit's DB doesn't change per decompose. */
let cachedLlmfitModels: readonly LlmfitModel[] | null = null;
async function getLlmfitModelsCached(): Promise<readonly LlmfitModel[]> {
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

/**
 * Build the runnable model "routing candidates" a decomposition can choose from: the default NKlein provider (when one
 * is runnable), **every model currently LOADED on that endpoint** (§5.AB north-star — auto-selection with no manual
 * role→model config), plus any explicitly-configured per-role model. Used by BOTH the task CLI and the runtime
 * decompose-apply path (so it lives in the agent layer, not `commands/`). Roles/models that aren't currently runnable
 * are skipped, not fatal.
 */
export async function buildDecompositionRoutingCandidates(
	runtimeConfig: RuntimeConfigState,
): Promise<NKleinTaskRoutingCandidate[]> {
	const nkleinProviderService = createNKleinProviderService();
	const modelRegistry = await getDefaultNKleinModelRegistry()
		.getSnapshot()
		.catch(() => ({
			schemaVersion: 1 as const,
			updatedAt: 0,
			models: {},
		}));
	const candidates = new Map<string, NKleinTaskRoutingCandidate>();
	try {
		const launchConfig = await nkleinProviderService.resolveLaunchConfig({});
		const candidate = buildNKleinStartGuardCandidate({
			launchConfig,
			role: null,
			modelRegistry,
		});
		candidates.set(candidate.entry.key, {
			entry: candidate.entry,
			role: candidate.role,
		});
		// §5.AB north-star: auto-DISCOVER every model currently loaded on this endpoint as a candidate, so a card can be
		// routed to the best-fit model with NO manual role→model config. Best-effort + LM-Studio-only (a non-LM-Studio
		// endpoint yields []); reuses each model's observed registry entry so the ledger history drives ranking. The
		// configured default/role candidates already set take precedence (richer guard-built entries) — don't clobber them.
		if (launchConfig.baseUrl) {
			// Read the RICH `/api/v1/models` descriptors so each loaded model's REAL key (not the per-machine alias) drives
			// the catalog/affinity lookups, and the authoritative `type` drives the embedding filter. The candidate identity
			// stays the runtime alias (what's actually invoked). A profile is resolved once per loaded model up front.
			const descriptors = await fetchLoadedModelDescriptors(launchConfig.baseUrl);
			// §5.AB llmfit prior (opt-in via NKLEIN_LLMFIT_PRIOR): use llmfit's measured fit score as the cold-start prior
			// AHEAD of the §5.AL catalog. Runs `uvx llmfit recommend` ONCE (cached) — OUTBOUND (HF DB) ⇒ egress-gated, OFF by
			// default so the runtime path stays local. Falls back to the catalog for any model llmfit doesn't score.
			let llmfitPrior: ((realName: string) => number | null) | undefined;
			if (isTruthyEnv(process.env.NKLEIN_LLMFIT_PRIOR)) {
				const llmfitModels = await getLlmfitModelsCached();
				if (llmfitModels.length > 0) {
					llmfitPrior = (realName) => llmfitCapabilityPrior(realName, llmfitModels)?.score ?? null;
				}
			}
			const profilesByRuntimeId = new Map(
				descriptors.map((d) => [
					d.runtimeId,
					resolveLoadedModelProfile(d, llmfitPrior ? { llmfitPrior } : undefined),
				]),
			);
			for (const loadedCandidate of buildLoadedModelRoutingCandidates({
				loadedModelIds: descriptors.map((d) => d.runtimeId),
				registryEntries: Object.values(modelRegistry.models),
				providerId: launchConfig.providerId,
				endpoint: launchConfig.baseUrl,
				now: Date.now(),
				// Cold-start prior (catalog, keyed on the real name) + best-fit affinity tags (runtime caps ∪ catalog), so a
				// never-observed loaded model is ranked by its card. llmfit's richer score can chain into the prior later.
				resolveProfile: (runtimeId) => profilesByRuntimeId.get(runtimeId) ?? null,
			})) {
				if (!candidates.has(loadedCandidate.entry.key)) {
					candidates.set(loadedCandidate.entry.key, loadedCandidate);
				}
			}
		}
	} catch {
		// A workspace without a runnable default NKlein provider can still decompose from explicit role models.
	}

	for (const [role, settings] of Object.entries(runtimeConfig.effectiveModelRoles)) {
		if (!settings.providerId && !settings.modelId) {
			continue;
		}
		try {
			const launchConfig = await nkleinProviderService.resolveLaunchConfig({
				providerIdOverride: settings.providerId ?? undefined,
				modelIdOverride: settings.modelId ?? undefined,
				reasoningEffortOverride: settings.reasoningEffort ?? null,
			});
			const candidate = buildNKleinStartGuardCandidate({
				launchConfig,
				role,
				modelRegistry,
			});
			candidates.set(candidate.entry.key, {
				entry: candidate.entry,
				role: candidate.role,
			});
		} catch {
			// Ignore roles that are configured but not currently runnable.
		}
	}

	return [...candidates.values()];
}
