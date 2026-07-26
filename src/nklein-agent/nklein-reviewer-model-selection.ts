import { applyWarmthPreference, type PromptSessionKind, type PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { resolveDefaultLocalModelBaseUrl } from "../core/local-model-endpoint";
import { applyDiversityPreference } from "../core/model-diversity";
import { resolveLineage } from "../core/model-lineage";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import { buildReviewerCandidates, resolveWorkerRealId } from "./nklein-reviewer-candidate-selection";
import { now } from "./nklein-session-state";

/** The cache-warmth ledger (kind→shell per model), read to batch back-to-back same-kind turns onto a warm shell. */
export interface ReviewerModelSelectionDeps {
	lastShellKeyByModel: Map<string, PromptWarmthLedgerEntry>;
}

function describeDiversePickPurpose(sessionKind: PromptSessionKind): {
	label: string;
	category: string;
	waiverMessage: string;
} {
	switch (sessionKind) {
		case "worker":
			return {
				label: "escalation worker",
				category: "escalation_worker_auto_diverse",
				waiverMessage: "the best available non-worker model is used without lineage diversity",
			};
		case "plan-critique":
			return {
				label: "plan critic",
				category: "plan_critic_auto_diverse",
				waiverMessage: "the best available non-worker critic is used without lineage diversity",
			};
		case "review":
			return {
				label: "reviewer",
				category: "reviewer_auto_diverse",
				waiverMessage: "the best available non-worker reviewer is used instead of worker self-review",
			};
		default:
			return {
				label: `${sessionKind} model`,
				category: `${sessionKind.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_auto_diverse`,
				waiverMessage: "the caller keeps its fallback model",
			};
	}
}

/**
 * W2.5a: pick a lineage-diverse LOADED model as the reviewer/escalation model. The worker's REAL model key
 * (descriptor.modelKey, not the per-machine alias) resolves its lineage; candidates are the other loaded
 * non-embedding models, preferred diverse-first via applyDiversityPreference, then §5.AQ(d) warmth-batched by
 * session kind within the diverse set. When the fit-margin policy waives diversity, the best ranked non-worker
 * candidate still wins; null is reserved for a failed/empty model probe or no other candidate. Extracted verbatim
 * from InMemoryNKleinTaskSessionService.pickDiverseReviewerModel (shared by the second-opinion review runner and the
 * escalation-model picker).
 */
export async function pickDiverseReviewerModel(
	workerLaunch: NKleinTaskRestartLaunchConfig,
	taskId: string,
	/** §5.AQ (d): the shell KIND the picked model will assemble — the same-kind warmth batching signal. */
	sessionKind: PromptSessionKind,
	deps: ReviewerModelSelectionDeps,
): Promise<{ providerId: string; modelId: string } | null> {
	const purpose = describeDiversePickPurpose(sessionKind);
	const baseUrl = workerLaunch.baseUrl?.trim() || resolveDefaultLocalModelBaseUrl();
	const descriptors = await fetchLoadedModelDescriptors(baseUrl).catch(
		() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
	);
	if (descriptors.length === 0) {
		return null;
	}
	// The worker's launch modelId is usually the SERVED alias — resolve its REAL key for lineage when loaded.
	const workerRealId = resolveWorkerRealId(descriptors, workerLaunch.modelId);
	const candidates = buildReviewerCandidates(descriptors, workerLaunch.modelId, workerRealId);
	if (candidates.length === 0) {
		return null;
	}
	const preferred = applyDiversityPreference({
		ranked: candidates,
		avoidLineages: [resolveLineage(workerRealId)],
	});
	const preferredPick = preferred.ranked[0];
	if (!preferredPick) {
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message: `${purpose.label} diversity waived for ${taskId}: ${preferred.diversityWaivedReason ?? "no diverse loaded model"} — ${purpose.waiverMessage}.`,
			taskId,
			metadata: { category: `${purpose.category}_waived`, reason: preferred.diversityWaivedReason ?? null },
		});
		return null;
	}
	if (!preferred.diversityAchieved) {
		// A diversity waiver means the strongest *other* loaded model is same-lineage or the diverse alternative is
		// outside the capability margin. Returning null here used to make the caller fall all the way back to the
		// original worker, silently turning review into self-review even though a stronger independent session was
		// available. Preserve the capability decision and use the ranked non-worker candidate.
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message:
				`${purpose.label} diversity waived for ${taskId}: ${preferred.diversityWaivedReason ?? "no fit-eligible diverse loaded model"} — ` +
				`${purpose.waiverMessage}: ${preferredPick.modelKey}.`,
			taskId,
			metadata: {
				category: `${purpose.category}_waived`,
				reason: preferred.diversityWaivedReason ?? null,
				reviewer: preferredPick.modelKey,
				worker: workerRealId,
			},
		});
		return { providerId: workerLaunch.providerId, modelId: preferredPick.modelKey };
	}
	// §5.AQ (d) session-KIND batching: among the candidates DIVERSITY allows (its result above is authoritative
	// — never weakened here), prefer the one whose last prompt shell is the SAME KIND (review→review etc.), so
	// back-to-back decision turns land on an already-warm shell instead of interleaving kinds across models.
	// The warmth ledger is keyed by the SERVED id (what the launch config gets) — candidate.modelKey here.
	const workerLineage = resolveLineage(workerRealId);
	const diverseCandidates = preferred.ranked.filter((candidate) => {
		const lineage = resolveLineage(candidate.modelId);
		return lineage !== "unknown" && lineage !== workerLineage;
	});
	const warmth = applyWarmthPreference({
		ranked: diverseCandidates.map((candidate) => ({
			modelKey: candidate.modelKey,
			modelId: candidate.modelKey,
			score: candidate.score,
		})),
		sessionKind,
		workspacePath: workerLaunch.workspaceRoot?.trim() ?? "",
		lastShellKeyByModel: deps.lastShellKeyByModel,
		now: now(),
	});
	const warmthPick = warmth.warmthApplied
		? (diverseCandidates.find((candidate) => candidate.modelKey === warmth.ranked[0]?.modelKey) ?? null)
		: null;
	if (warmthPick && warmth.warmthReason) {
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message: `Cache-warmth kind-batching for ${taskId}: ${warmth.warmthReason} (within the lineage-diverse set).`,
			taskId,
			metadata: { category: "reviewer_warmth_batched", reason: warmth.warmthReason },
		});
	}
	const pick = warmthPick ?? preferredPick;
	recordSelfObservation({
		signal: "custom",
		severity: "info",
		message: `Auto-picked lineage-diverse ${purpose.label} ${pick.modelKey} (${resolveLineage(pick.modelId)}) for ${taskId} — worker is ${workerRealId} (${resolveLineage(workerRealId)}).`,
		taskId,
		metadata: { category: purpose.category, reviewer: pick.modelKey, worker: workerRealId },
	});
	return { providerId: workerLaunch.providerId, modelId: pick.modelKey };
}
