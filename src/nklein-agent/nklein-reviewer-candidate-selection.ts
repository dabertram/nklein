import type { LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { lookupModelCapability } from "../core/model-capability-catalog";
import { scoreModelClassFitForRole } from "../core/role-model-class";

/**
 * §5.U — the PURE candidate-building sub-computations lifted out of `InMemoryNKleinTaskSessionService.pickDiverseReviewerModel`
 * (which stays as the stateful orchestrator: fetch descriptors, apply diversity/warmth prefs, record observations). These
 * two steps — resolving the worker's REAL model key and turning the loaded descriptors into reviewer candidates (excluding
 * embeddings and the worker's own model) — are pure, so they're independently testable.
 */

/** A reviewer candidate: `modelKey` is the SERVABLE id the launch config needs; `modelId` is the REAL key (lineage). */
export interface ReviewerCandidate {
	modelKey: string;
	modelId: string;
	score: number;
}

/**
 * The worker's REAL publisher key. The worker's launch modelId is usually the SERVED alias; if it's currently loaded,
 * resolve its `modelKey`. Falls back to the launch modelId (or "") when not found.
 */
export function resolveWorkerRealId(
	descriptors: readonly LoadedModelDescriptor[],
	workerModelId: string | null | undefined,
): string {
	const workerDescriptor = descriptors.find(
		(descriptor) => descriptor.runtimeId === workerModelId || descriptor.modelKey === workerModelId,
	);
	return workerDescriptor?.modelKey ?? workerModelId ?? "";
}

/** Reviewer-class fit (0–100) from the §5.AL catalog for a model's REAL key — a reasoning model scores far above a
 * chat/roleplay one; an uncatalogued id resolves to the neutral `unknown`/`UNKNOWN` fallback. This is the JUDGE-DEPTH
 * signal the picker was missing: with a flat score, `applyDiversityPreference`'s margin logic (never force a badly-unfit
 * diverse reviewer) is inert and its `top = ranked[0]` is arbitrary descriptor order. */
function reviewerFitScore(realModelId: string): number {
	const entry = lookupModelCapability(realModelId);
	const facts = entry
		? { kind: entry.kind, toolUse: entry.toolUse }
		: ({ kind: "unknown", toolUse: "UNKNOWN" } as const);
	return scoreModelClassFitForRole("reviewer", facts).score;
}

/**
 * Build the reviewer candidate list from the loaded descriptors: drop embeddings and the worker's own model (by either
 * its served alias or its real key), score each by its catalog REVIEWER-class fit, and return best-first (stable by
 * modelKey) so `applyDiversityPreference` (which trusts a pre-sorted list + its margin) prefers the DEEPEST diverse judge
 * — not an arbitrary-order one. Equal-fit candidates keep their relative order (stable), matching the pre-scoring behavior.
 */
export function buildReviewerCandidates(
	descriptors: readonly LoadedModelDescriptor[],
	workerModelId: string | null | undefined,
	workerRealId: string,
): ReviewerCandidate[] {
	return descriptors
		.filter(
			(descriptor) =>
				!descriptor.isEmbedding && descriptor.runtimeId !== workerModelId && descriptor.modelKey !== workerRealId,
		)
		.map((descriptor) => ({
			// modelKey = the SERVABLE id (what the launch config needs); modelId = the REAL key (lineage + catalog match).
			modelKey: descriptor.runtimeId,
			modelId: descriptor.modelKey,
			score: reviewerFitScore(descriptor.modelKey),
		}))
		.sort((a, b) => b.score - a.score || a.modelKey.localeCompare(b.modelKey));
}
