import type { LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";

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

/**
 * Build the reviewer candidate list from the loaded descriptors: drop embeddings and the worker's own model (by either
 * its served alias or its real key), and project each to a candidate with a flat base score.
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
			// modelKey = the SERVABLE id (what the launch config needs); modelId = the REAL key (lineage).
			modelKey: descriptor.runtimeId,
			modelId: descriptor.modelKey,
			score: 50,
		}));
}
