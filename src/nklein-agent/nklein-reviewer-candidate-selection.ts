import type { LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { lookupModelCapability } from "../core/model-capability-catalog";
import {
	type RankedReviewerCandidate,
	type ReviewerCapabilityEvidence,
	type ReviewerRanking,
	rankReviewerCandidates,
} from "../core/reviewer-capability-ranking";
import { type SwarmRole, scoreModelClassFitForRole } from "../core/role-model-class";

/**
 * §5.U — the PURE candidate-building sub-computations lifted out of `InMemoryNKleinTaskSessionService.pickDiverseReviewerModel`
 * (which stays as the stateful orchestrator: fetch descriptors, apply diversity/warmth prefs, record observations). These
 * two steps — resolving the worker's REAL model key and turning the loaded descriptors into reviewer candidates (excluding
 * embeddings and the worker's own model) — are pure, so they're independently testable.
 *
 * P0.REVRANK: the ORDER is owned by `rankReviewerCandidates` (core) — class fit gates, capability evidence ranks, and a
 * model with no evidence is never given a number. This module only turns descriptors into that core's input.
 */

/** A reviewer candidate: `modelKey` is the SERVABLE id the launch config needs; `modelId` is the REAL key (lineage). */
export type ReviewerCandidate = RankedReviewerCandidate;

/** Capability evidence for a loaded model in the role it would fill — null when nothing is known (never a default). */
export type ReviewerCapabilityResolver = (
	model: { runtimeId: string; modelKey: string },
	role: SwarmRole,
) => ReviewerCapabilityEvidence | null;

export interface ReviewerCandidateOptions {
	/** The role the pick fills — the class GATE. Default `reviewer`; the stuck-review escalation replaces the WORKER. */
	role?: SwarmRole;
	/**
	 * P0.REVRANK capability evidence per loaded model. Omitted ⇒ every candidate is unrankable and class fit orders them
	 * (the pre-evidence order, byte-identical — the kill-switch path).
	 */
	capabilityEvidence?: ReviewerCapabilityResolver;
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

/** Role class fit (0–100 + eligibility) from the §5.AL catalog for a model's REAL key — a reasoning model scores far
 * above a chat/roleplay one; an uncatalogued id resolves to the neutral `unknown`/`UNKNOWN` fallback. This is the
 * class GATE and the tie-break among equal capabilities; it carries no strength (a 9B and a 27B of one class tie). */
function roleClassFit(realModelId: string, role: SwarmRole): { score: number; eligible: boolean } {
	const entry = lookupModelCapability(realModelId);
	const facts = entry
		? { kind: entry.kind, toolUse: entry.toolUse }
		: ({ kind: "unknown", toolUse: "UNKNOWN" } as const);
	const fit = scoreModelClassFitForRole(role, facts);
	return { score: fit.score, eligible: fit.eligible };
}

/** The serving facts the ranking tie-breaks on (live 2026-09-05: three instances of one 27B differed only here). */
export function describeServing(descriptor: LoadedModelDescriptor): { contextLength: number; quantPenalty: number } {
	return {
		contextLength: descriptor.loadedContextLength ?? descriptor.maxContextLength ?? 0,
		quantPenalty: quantizationPenalty(`${descriptor.runtimeId} ${descriptor.modelKey}`),
	};
}

/**
 * Rank the loaded descriptors as candidates for the role: drop embeddings and the worker's own model (by either its
 * served alias or its real key), then hand the class fit, capability evidence and serving facts to
 * `rankReviewerCandidates` — best-first, class-gated, evidence-ranked, with the unrankable tail and exclusions exposed.
 */
export function rankReviewerCandidateDescriptors(
	descriptors: readonly LoadedModelDescriptor[],
	workerModelId: string | null | undefined,
	workerRealId: string,
	options: ReviewerCandidateOptions = {},
): ReviewerRanking {
	const role = options.role ?? "reviewer";
	return rankReviewerCandidates(
		descriptors
			.filter(
				(descriptor) =>
					!descriptor.isEmbedding &&
					descriptor.runtimeId !== workerModelId &&
					descriptor.modelKey !== workerRealId,
			)
			.map((descriptor) => ({
				// modelKey = the SERVABLE id (what the launch config needs); modelId = the REAL key (lineage + catalog match).
				modelKey: descriptor.runtimeId,
				modelId: descriptor.modelKey,
				classFit: roleClassFit(descriptor.modelKey, role),
				capability:
					options.capabilityEvidence?.({ runtimeId: descriptor.runtimeId, modelKey: descriptor.modelKey }, role) ??
					null,
				...describeServing(descriptor),
			})),
	);
}

/** The ranked candidate list (see {@link rankReviewerCandidateDescriptors}); the shape the margin cores consume. */
export function buildReviewerCandidates(
	descriptors: readonly LoadedModelDescriptor[],
	workerModelId: string | null | undefined,
	workerRealId: string,
	options: ReviewerCandidateOptions = {},
): ReviewerCandidate[] {
	return rankReviewerCandidateDescriptors(descriptors, workerModelId, workerRealId, options).ranked;
}

/** 2 for ≤2-bit quants, 1 for 3-bit, 0 otherwise — read from the served identifier / real key (`@q2_k_xl`, `iq3_xs`). */
export function quantizationPenalty(text: string): number {
	const lowered = text.toLowerCase();
	if (/\b(?:i?q2|q2_k|2bit|2-bit)/u.test(lowered) || /[@_-]i?q2/u.test(lowered)) {
		return 2;
	}
	if (/\b(?:i?q3|q3_k|3bit|3-bit)/u.test(lowered) || /[@_-]i?q3/u.test(lowered)) {
		return 1;
	}
	return 0;
}
