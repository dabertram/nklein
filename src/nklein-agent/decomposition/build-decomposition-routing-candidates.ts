import type { RuntimeConfigState } from "../../config/runtime-config";
import { fetchLoadedModelIds } from "../../core/lmstudio-loaded-models";
import { buildLoadedModelRoutingCandidates } from "../nklein-loaded-model-candidates";
import { getDefaultNKleinModelRegistry } from "../nklein-model-registry";
import { createNKleinProviderService } from "../nklein-provider-service";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { buildNKleinStartGuardCandidate } from "../nklein-task-start-guard";

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
			const loadedModelIds = await fetchLoadedModelIds(launchConfig.baseUrl);
			for (const loadedCandidate of buildLoadedModelRoutingCandidates({
				loadedModelIds,
				registryEntries: Object.values(modelRegistry.models),
				providerId: launchConfig.providerId,
				endpoint: launchConfig.baseUrl,
				now: Date.now(),
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
