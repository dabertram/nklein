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

/** Embedding model ids are not agentic routing candidates (e.g. `text-embedding-nomic-embed-text-…`). */
const EMBEDDING_ID_PATTERN = /(?:^|[-/@])(?:text-)?embed/i;

export interface LoadedModelCandidatesInput {
	/** Currently-loaded model ids on `endpoint` (e.g. from `fetchLoadedModelIds`). Embedding ids are filtered out here. */
	loadedModelIds: readonly string[];
	/** The model-registry snapshot's entries — used to reuse a model's OBSERVED capability/stats when known. */
	registryEntries: readonly NKleinModelRegistryEntry[];
	providerId: string;
	endpoint: string | null;
	/** Clock for minting a default entry for a not-yet-observed model (its `createdAt`/`updatedAt`). */
	now: number;
	/** Optional role tag carried onto each candidate (a workflow-STAGE signal for the selector, not a manual mapping). */
	role?: string | null;
	/**
	 * Cold-start capability prior for an UNOBSERVED model (id → 0–100 score, or null). Set as the candidate's
	 * `observedCapability` so the router ranks a cold model by a real estimate (llmfit score → §5.AL catalog) instead of
	 * the flat default. Pure + injected so the builder stays free of llmfit/catalog I/O. Skipped for OBSERVED models.
	 */
	capabilityPrior?: (modelId: string) => number | null;
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
		if (!modelId || EMBEDDING_ID_PATTERN.test(modelId)) {
			continue; // skip blanks + embedding models (not agentic routing candidates)
		}
		const keyInput = { providerId: input.providerId, modelId, endpoint: input.endpoint };
		const key = buildNKleinModelRegistryKey(keyInput);
		if (seenKeys.has(key)) {
			continue;
		}
		seenKeys.add(key);
		const known = entriesByKey.get(key);
		const entry = known ?? createNKleinModelRegistryEntry(keyInput, input.now);
		// Cold-start capability prior: an UNOBSERVED loaded model gets a prior via the candidate's `observedCapability`
		// (the router's score override) from the injected resolver (llmfit score → §5.AL catalog → null), so the router
		// can tell a coder from a reasoner instead of treating every cold model identically. An OBSERVED model (already
		// in the registry, with accrued stats) keeps its learned score — no override.
		const prior = known ? null : (input.capabilityPrior?.(modelId) ?? null);
		candidates.push({
			entry,
			role: input.role ?? null,
			...(prior !== null ? { observedCapability: prior } : {}),
		});
	}
	return candidates;
}
