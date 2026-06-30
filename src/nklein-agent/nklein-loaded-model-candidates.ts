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

/** Fallback embedding guess from a runtime id, used ONLY when the caller's profile doesn't carry the authoritative
 * `isEmbedding` flag (the LM Studio `/api/v1/models` `type` is preferred — see {@link LoadedModelRoutingProfile}). */
const EMBEDDING_ID_PATTERN = /(?:^|[-/@])(?:text-)?embed/i;

/**
 * Per-model facts the CALLER resolves (keyed on the model's REAL name — LM Studio aliases the runtime id, so the caller
 * maps alias→real key via `/api/v1/models` before catalog/affinity lookups). Injected so this builder stays pure of
 * catalog/llmfit/API I/O. All fields optional — an absent profile reproduces the old id-only behavior.
 */
export interface LoadedModelRoutingProfile {
	/** Authoritative embedding flag (LM Studio `type === "embedding"`); when omitted the builder name-guesses the id. */
	isEmbedding?: boolean;
	/**
	 * Cold-start capability prior (0–100, keyed on the real name) for an UNOBSERVED model — set as the candidate's
	 * `observedCapability` (the router's score override) so a cold model is ranked by a real estimate, not the flat
	 * default. Ignored for an OBSERVED model (it keeps its learned ledger score).
	 */
	capabilityPrior?: number | null;
	/** Best-fit affinity tags (runtime caps ∪ §5.AL catalog) carried onto the candidate for task↔model routing. */
	affinityTags?: readonly string[];
}

export interface LoadedModelCandidatesInput {
	/** Currently-loaded model RUNTIME ids (LM Studio per-instance aliases — the invocation identity / candidate key). */
	loadedModelIds: readonly string[];
	/** The model-registry snapshot's entries — used to reuse a model's OBSERVED capability/stats when known. */
	registryEntries: readonly NKleinModelRegistryEntry[];
	providerId: string;
	endpoint: string | null;
	/** Clock for minting a default entry for a not-yet-observed model (its `createdAt`/`updatedAt`). */
	now: number;
	/** Optional role tag carried onto each candidate (a workflow-STAGE signal for the selector, not a manual mapping). */
	role?: string | null;
	/** Resolve a runtime id's {@link LoadedModelRoutingProfile} (real-name catalog/affinity/embedding facts). */
	resolveProfile?: (runtimeId: string) => LoadedModelRoutingProfile | null | undefined;
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
		const profile = input.resolveProfile?.(modelId) ?? null;
		// Embedding models aren't agentic routing candidates — prefer the caller's authoritative flag, name-guess only as
		// a fallback when the profile is absent.
		if (profile ? profile.isEmbedding : EMBEDDING_ID_PATTERN.test(modelId)) {
			continue;
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
		// (the router's score override), so the router can tell a coder from a reasoner instead of treating every cold
		// model identically. An OBSERVED model (already in the registry, with accrued stats) keeps its learned score.
		const prior = known ? null : (profile?.capabilityPrior ?? null);
		const affinityTags = profile?.affinityTags ?? [];
		candidates.push({
			entry,
			role: input.role ?? null,
			...(prior !== null && prior !== undefined ? { observedCapability: prior } : {}),
			...(affinityTags.length > 0 ? { affinityTags } : {}),
		});
	}
	return candidates;
}
