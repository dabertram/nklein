/**
 * Auto-discovered routing candidates from the LOADED model set (todo §5.AB north-star, user 2026-07-01 — auto-selection
 * as the DEFAULT, no manual role→model config).
 *
 * Today the routing candidate set is built from `effectiveModelRoles` (manual config) — so with no roles configured a
 * card has nothing to select from. This builds candidates from whatever is currently LOADED on the endpoint instead, so
 * !Klein can auto-pick the best-fit model per card from the available set (the vision). For each loaded model: reuse its
 * observed {@link NKleinModelRegistryEntry} (capability + accumulated stats) when the registry already knows it, else
 * mint a default entry (capability prior). The result feeds the existing {@link routeNKleinTask} selector unchanged — the
 * difference is purely WHERE the candidates come from (loaded set vs. manual roles).
 *
 * Pure (given the loaded ids + a registry snapshot), so it is unit-testable without a live endpoint, scheduler, or fetch.
 */

import type { NKleinModelRegistryEntry } from "./nklein-model-registry";
import { createNKleinModelRegistryEntry } from "./nklein-model-registry-deserialize";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry-key";
import type { NKleinTaskRoutingCandidate } from "./nklein-task-router";

export interface LoadedModelCandidatesInput {
	/** Currently-loaded model ids on `endpoint` (e.g. from `fetchLoadedModelIds`). Embeddings are tolerated — the
	 * downstream suitability/feasibility gate drops a non-agentic model, so the caller need not pre-filter them. */
	loadedModelIds: readonly string[];
	/** The model-registry snapshot's entries — used to reuse a model's OBSERVED capability/stats when known. */
	registryEntries: readonly NKleinModelRegistryEntry[];
	providerId: string;
	endpoint: string | null;
	/** Clock for minting a default entry for a not-yet-observed model (its `createdAt`/`updatedAt`). */
	now: number;
	/** Optional role tag carried onto each candidate (a workflow-STAGE signal for the selector, not a manual mapping). */
	role?: string | null;
}

/**
 * Build {@link NKleinTaskRoutingCandidate}s from the loaded set. Deduplicates by registry key (provider:model:endpoint),
 * skips blank ids, and preserves the loaded order. A model already in the registry keeps its observed entry (so the
 * ledger/observation history drives ranking); an unknown loaded model gets a fresh default entry (capability prior).
 */
export function buildLoadedModelRoutingCandidates(input: LoadedModelCandidatesInput): NKleinTaskRoutingCandidate[] {
	const entriesByKey = new Map(input.registryEntries.map((entry) => [entry.key, entry]));
	const candidates: NKleinTaskRoutingCandidate[] = [];
	const seenKeys = new Set<string>();
	for (const rawModelId of input.loadedModelIds) {
		const modelId = rawModelId.trim();
		if (!modelId) {
			continue;
		}
		const keyInput = { providerId: input.providerId, modelId, endpoint: input.endpoint };
		const key = buildNKleinModelRegistryKey(keyInput);
		if (seenKeys.has(key)) {
			continue;
		}
		seenKeys.add(key);
		const entry = entriesByKey.get(key) ?? createNKleinModelRegistryEntry(keyInput, input.now);
		candidates.push({ entry, role: input.role ?? null });
	}
	return candidates;
}
