import { type ModelLineage, resolveLineage } from "../core/model-lineage";
import type { ReviewerCandidate } from "./nklein-reviewer-candidate-selection";

/**
 * §5.AB parallel panel (David 2026-07-07 decision: "3 diverse judges, majority + security veto"). The N-judge
 * generalization of {@link import("./nklein-reviewer-model-selection").pickDiverseReviewerModel} (which picks ONE
 * lineage-diverse reviewer). Given the depth-scored reviewer candidates (from {@link buildReviewerCandidates}) + the
 * worker's lineage, select up to `size` judges that MAXIMIZE base-family diversity, depth-first within each family.
 *
 * Two passes:
 *  1. **Diversity-first** — one judge per DISTINCT non-worker base lineage, taking the deepest (highest reviewer-fit) in
 *     each. This is the uncorrelated-judgment core: N different families catch each other's blind spots.
 *  2. **Fill to size** — if fewer distinct non-worker lineages than `size` exist, top up with the best remaining
 *     candidates (any lineage, incl. a second of an already-used family) so the panel still reaches its vote count. A
 *     padded same-family judge adds a majority vote but not diversity — the fleet advisor flags a true monoculture.
 *
 * Pure + deterministic. Returns fewer than `size` only when fewer candidates exist (a 1-model fleet ⇒ a 1-judge "panel").
 */
export function selectReviewerPanel(input: {
	candidates: readonly ReviewerCandidate[];
	workerLineage: ModelLineage;
	size: number;
}): ReviewerCandidate[] {
	const size = Math.max(0, Math.trunc(input.size));
	if (size === 0 || input.candidates.length === 0) {
		return [];
	}
	// Depth-first ordering (highest reviewer-fit first; stable by modelKey) — both passes consume this order.
	const ranked = [...input.candidates].sort((a, b) => b.score - a.score || a.modelKey.localeCompare(b.modelKey));
	const chosen: ReviewerCandidate[] = [];
	const usedLineages = new Set<ModelLineage>();

	// Pass 1: one deepest judge per distinct KNOWN non-worker lineage.
	for (const candidate of ranked) {
		if (chosen.length >= size) {
			break;
		}
		const lineage = resolveLineage(candidate.modelId);
		if (lineage !== "unknown" && lineage !== input.workerLineage && !usedLineages.has(lineage)) {
			chosen.push(candidate);
			usedLineages.add(lineage);
		}
	}

	// Pass 2: fill remaining slots with the best not-yet-chosen candidates (any lineage) to reach the vote count.
	if (chosen.length < size) {
		const chosenSet = new Set(chosen);
		for (const candidate of ranked) {
			if (chosen.length >= size) {
				break;
			}
			if (!chosenSet.has(candidate)) {
				chosen.push(candidate);
			}
		}
	}
	return chosen;
}

/** How many DISTINCT base lineages the panel actually spans (the real uncorrelated-judgment breadth, worker excluded). */
export function panelLineageBreadth(panel: readonly ReviewerCandidate[]): number {
	const lineages = new Set<ModelLineage>();
	for (const candidate of panel) {
		const lineage = resolveLineage(candidate.modelId);
		if (lineage !== "unknown") {
			lineages.add(lineage);
		}
	}
	return lineages.size;
}
