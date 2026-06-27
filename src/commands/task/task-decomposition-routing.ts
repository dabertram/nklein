import type { RuntimeConfigState } from "../../config/runtime-config";
import { getDefaultNKleinModelRegistry } from "../../nklein-agent/nklein-model-registry";
import { createNKleinProviderService } from "../../nklein-agent/nklein-provider-service";
import type { NKleinTaskRoutingCandidate } from "../../nklein-agent/nklein-task-router";
import { buildNKleinStartGuardCandidate } from "../../nklein-agent/nklein-task-start-guard";

/**
 * Build the runnable model "routing candidates" a decomposition can choose from: the default NKlein provider (when one
 * is runnable) plus every configured per-role model that currently resolves a launch config. Extracted from the task
 * CLI (§5.U) — independent of task.ts internals (only the provider service + model registry + start-guard), so the
 * decomposition-routing concern stands on its own. Roles that aren't currently runnable are skipped, not fatal.
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
