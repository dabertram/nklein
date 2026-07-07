import { buildNKleinModelRegistryKey } from "./nklein-model-registry-key";

/**
 * §5.BG (c) routing-key flip — re-key a routing-candidate map to STABLE routing keys, in one pass. Extracted from the
 * `handleStartTaskSession` hot path (a clear-boundary pure sub-computation: it touches only the candidate map + the
 * injected resolver + `buildNKleinModelRegistryKey`, no other handler state) so the Map-mutation is unit-testable.
 *
 * For each candidate: resolve its runtime `entry.modelId` to a stable id (via the injected resolver, which reads the
 * learned runtimeId→modelKey map); when it changes, rebuild `entry.key` from the stable id and re-key the map under it
 * (a shallow clone — `entry.modelId` stays the RUNTIME id, the launch + verdict identity). Two runtime instances that
 * resolve to the SAME stable key collapse to one entry (the same model IS one routing identity). A candidate with no
 * stable mapping keeps its runtime-derived key (consistent with a runtime-keyed ledger write). Mutates in place.
 *
 * Iterates a SNAPSHOT (`[...candidates]`) so deleting/re-inserting during the loop can't invalidate the iterator.
 */
export function applyStableRoutingKeysToCandidates<
	TEntry extends { key: string; modelId: string; providerId: string; endpoint: string | null },
	TCandidate extends { entry: TEntry },
>(candidates: Map<string, TCandidate>, resolveStableRoutingModelId: (runtimeModelId: string) => string): void {
	for (const [oldKey, candidate] of [...candidates]) {
		const stableModelId = resolveStableRoutingModelId(candidate.entry.modelId);
		if (stableModelId === candidate.entry.modelId) {
			continue; // no stable mapping known ⇒ the runtime-derived key stands
		}
		const stableKey = buildNKleinModelRegistryKey({
			providerId: candidate.entry.providerId,
			modelId: stableModelId,
			endpoint: candidate.entry.endpoint,
		});
		if (stableKey !== oldKey) {
			candidates.delete(oldKey);
			candidates.set(stableKey, { ...candidate, entry: { ...candidate.entry, key: stableKey } });
		}
	}
}
