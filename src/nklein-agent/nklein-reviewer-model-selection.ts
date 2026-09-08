import { applyWarmthPreference, type PromptSessionKind, type PromptWarmthLedgerEntry } from "../core/cache-warmth";
import {
	collidingIdentifiers,
	describeIdentifierCollision,
	isCollidingIdentifierRoutable,
} from "../core/fleet-identifier-collision";
import { createDefaultLmsRunner, fetchLmsPsModelsCached, type LmsPsModel } from "../core/lms-ps-json";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { filterByLoadedHostAllowlist, getLoadedHostAllowlist } from "../core/loaded-host-allowlist";
import { resolveDefaultLocalModelBaseUrl } from "../core/local-model-endpoint";
import { applyDiversityPreference } from "../core/model-diversity";
import { resolveLineage } from "../core/model-lineage";
import { isModelMarkedDead } from "../core/model-liveness-ledger";
import {
	describeRankedCandidate,
	type RankedReviewerCandidate,
	type ReviewerRanking,
	type StrictlyStrongerBaseline,
	type StrictlyStrongerSelection,
	selectStrictlyStrongerCandidates,
} from "../core/reviewer-capability-ranking";
import type { SwarmRole } from "../core/role-model-class";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import { buildLmStudioMachineByModelId } from "./nklein-lmstudio-host-map";
import {
	describeServing,
	quantizationPenalty,
	rankReviewerCandidateDescriptors,
	resolveWorkerRealId,
} from "./nklein-reviewer-candidate-selection";
import {
	DISABLED_REVIEWER_CAPABILITY_EVIDENCE,
	loadReviewerCapabilityEvidence,
	type ReviewerCapabilityEvidenceSource,
} from "./nklein-reviewer-capability-evidence";
import { now } from "./nklein-session-state";

/** The cache-warmth ledger (kind→shell per model), read to batch back-to-back same-kind turns onto a warm shell. */
export interface ReviewerModelSelectionDeps {
	lastShellKeyByModel: Map<string, PromptWarmthLedgerEntry>;
	/** Isolated ledger root (the session service's F1.26b root) for the capability-evidence read; undefined ⇒ default. */
	ledgerRootDir?: string;
	/** Test seam: the evidence loader (default: the live registry / ledger / fitness / observation read). */
	loadCapabilityEvidence?: typeof loadReviewerCapabilityEvidence;
	/**
	 * P0.REVRANK escalation contract: the pick REPLACES the worker in `workerLaunch`, so it must be proven STRICTLY
	 * stronger than that worker (`selectStrictlyStrongerCandidates`); when nothing qualifies the pick is refused (null)
	 * with an `escalation_not_stronger_refused` observation — never a lateral or downward "escalation".
	 */
	requireStrictlyStrongerThanWorker?: boolean;
}

/**
 * Drop descriptors the fleet cannot actually serve (live 2026-09-05): the loaded-model listing keeps showing a
 * model the liveness ledger has PROVED dead, and an identifier loaded on two LM-Link hosts that the gateway
 * refuses to route ("Failed to resolve model metadata"). The worker start path already excludes both; the
 * reviewer/escalation chooser drew from the raw listing and walked un-parked reviews straight back into the
 * collision (three no-verdict sessions → park). Shared by the diverse chooser and the review runner's
 * loaded-model fallback so every reviewer resolution sees the same truth. lms ps is consulted with a short
 * timeout and any failure means "no collision knowledge" — never a refusal.
 */
export async function excludeUnroutableDescriptors<T extends { runtimeId: string; modelKey: string }>(
	descriptors: readonly T[],
	context: { taskId: string; purpose: string },
): Promise<T[]> {
	if (descriptors.length === 0) {
		return [];
	}
	const fleet = await fetchLmsPsModelsCached(createDefaultLmsRunner(5_000)).catch(() => [] as LmsPsModel[]);
	// Evidence-based collision exclusion (2026-09-05): only identifiers whose cached gateway probe fails.
	const probeBaseUrl = resolveDefaultLocalModelBaseUrl();
	const colliding = new Set(
		(
			await Promise.all(
				[...collidingIdentifiers(fleet)].map(async (id) =>
					(await isCollidingIdentifierRoutable(id, probeBaseUrl)) ? null : id,
				),
			)
		).filter((id): id is string => id !== null),
	);
	const excluded: {
		id: string;
		reason: "liveness_ledger_dead" | "fleet_identifier_collision" | "host_not_allowlisted";
	}[] = [];
	const routable = descriptors.filter((descriptor) => {
		// Endpoint-scoped (P0.AUDIT0904 leg 8): these descriptors come from `probeBaseUrl`, so ask about THAT host —
		// the same model id proven dead behind another endpoint must not exclude this one's live copy.
		if (
			isModelMarkedDead(descriptor.runtimeId, { endpoint: probeBaseUrl }) ||
			isModelMarkedDead(descriptor.modelKey, { endpoint: probeBaseUrl })
		) {
			excluded.push({ id: descriptor.runtimeId, reason: "liveness_ledger_dead" });
			return false;
		}
		if (colliding.has(descriptor.runtimeId)) {
			excluded.push({ id: descriptor.runtimeId, reason: "fleet_identifier_collision" });
			return false;
		}
		return true;
	});
	// David 2026-09-07 ("leave m5max idle for nklein"): the loaded-host allowlist (`workerUseAllLoadedHosts`) governs
	// EVERY auto/fallback selection, not only the worker auto-pool. A model on a host outside it is unroutable for
	// auto selection; an unmapped model counts as `local` (fail-closed). Explicit pins never pass through here.
	const hostFiltered = filterByLoadedHostAllowlist(routable, {
		allowlist: getLoadedHostAllowlist(),
		machineIdByModelId: buildLmStudioMachineByModelId(fleet),
		idsOf: (descriptor) => [descriptor.runtimeId, descriptor.modelKey],
	});
	for (const entry of hostFiltered.excluded) {
		excluded.push({ id: entry.id, reason: "host_not_allowlisted" });
	}
	if (excluded.length > 0) {
		const onlyHostExclusions = excluded.every((entry) => entry.reason === "host_not_allowlisted");
		recordSelfObservation({
			signal: "custom",
			severity: onlyHostExclusions ? "info" : "warning",
			message: `${context.purpose} selection for ${context.taskId} excluded ${excluded.length} unroutable model(s): ${excluded
				.map((entry) =>
					entry.reason === "fleet_identifier_collision"
						? describeIdentifierCollision(entry.id, fleet)
						: entry.reason === "host_not_allowlisted"
							? `${entry.id} (host outside the loaded-host allowlist)`
							: `${entry.id} (held dead by the liveness ledger)`,
				)
				.join("; ")}.`,
			taskId: context.taskId,
			metadata: {
				category: excluded.some((entry) => entry.reason === "fleet_identifier_collision")
					? "fleet_identifier_collision"
					: onlyHostExclusions
						? "loaded_host_allowlist_excluded"
						: "model_pool_loss",
				excluded,
			},
		});
	}
	return hostFiltered.kept;
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

/** Compact per-candidate metadata for the ranking observation (bounded to the head of the list). */
function summarizeRanked(candidates: readonly RankedReviewerCandidate[], limit = 8) {
	return candidates.slice(0, limit).map((candidate) => ({
		modelKey: candidate.modelKey,
		score: candidate.score,
		scoreBasis: candidate.scoreBasis,
		capability: candidate.capability?.score ?? null,
		capabilityBasis: candidate.capability?.basis ?? null,
		samples: candidate.capability?.samples ?? 0,
		classFit: candidate.classFit,
		quantPenalty: candidate.quantPenalty,
		contextLength: candidate.contextLength,
	}));
}

/** The pick's capability facts, stamped on the existing pick observations so a basis is never mistaken for a fact. */
function pickCapabilityMetadata(pick: RankedReviewerCandidate) {
	return {
		reviewerCapability: pick.capability?.score ?? null,
		reviewerCapabilityBasis: pick.capability?.basis ?? null,
		reviewerCapabilitySamples: pick.capability?.samples ?? 0,
		reviewerClassFit: pick.classFit,
	};
}

/**
 * P0.REVRANK: record what the ranking saw and decided — the pick + its basis — so a capability-blind choice can never
 * again hide behind a "lineage-diverse" line. One record per auto pick (reviewer, critic, escalation worker).
 */
function recordRankingObservation(input: {
	taskId: string;
	purpose: ReturnType<typeof describeDiversePickPurpose>;
	role: SwarmRole;
	evidence: ReviewerCapabilityEvidenceSource;
	workerRealId: string;
	ranking: ReviewerRanking;
	strictlyStronger: { baseline: StrictlyStrongerBaseline; selection: StrictlyStrongerSelection } | null;
}): void {
	const head = input.ranking.ranked.slice(0, 3).map(describeRankedCandidate).join(" · ");
	recordSelfObservation({
		signal: "custom",
		severity: "info",
		message: `${input.purpose.label} ranking for ${input.taskId} (${input.evidence.enabled ? "capability evidence" : "class fit only — capability evidence disabled"}, ${input.ranking.rankable.length} evidence-ranked / ${input.ranking.unrankable.length} unrankable / ${input.ranking.excluded.length} class-excluded): ${head || "no candidate"}${
			input.strictlyStronger
				? ` — strictly-stronger-than-worker gate: ${input.strictlyStronger.selection.qualified.length} qualified`
				: ""
		}.`,
		taskId: input.taskId,
		metadata: {
			category: "reviewer_capability_ranking",
			purpose: input.purpose.category,
			role: input.role,
			evidenceEnabled: input.evidence.enabled,
			worker: input.workerRealId,
			ranked: summarizeRanked(input.ranking.ranked),
			rankable: input.ranking.rankable.length,
			unrankable: input.ranking.unrankable.length,
			excluded: input.ranking.excluded,
			strictlyStronger: input.strictlyStronger
				? {
						baseline: {
							modelKey: input.strictlyStronger.baseline.modelKey,
							capability: input.strictlyStronger.baseline.capability?.score ?? null,
							basis: input.strictlyStronger.baseline.capability?.basis ?? null,
							samples: input.strictlyStronger.baseline.capability?.samples ?? 0,
						},
						qualified: input.strictlyStronger.selection.qualified.map((candidate) => candidate.modelKey),
						verdicts: input.strictlyStronger.selection.verdicts,
					}
				: null,
		},
	});
}

/**
 * W2.5a: pick a lineage-diverse LOADED model as the reviewer/escalation model. The worker's REAL model key
 * (descriptor.modelKey, not the per-machine alias) resolves its lineage; candidates are the other loaded
 * non-embedding models, preferred diverse-first via applyDiversityPreference, then §5.AQ(d) warmth-batched by
 * session kind within the diverse set. When the fit-margin policy waives diversity, the best ranked non-worker
 * candidate still wins; null is reserved for a failed/empty model probe, no other candidate, or a refused
 * escalation. Extracted verbatim from InMemoryNKleinTaskSessionService.pickDiverseReviewerModel (shared by the
 * second-opinion review runner and the escalation-model picker).
 *
 * P0.REVRANK: the candidate ORDER is capability evidence (registry × ledger/fitness × verdict — the worker router's
 * own signal), gated by the class of the role the pick fills; class fit alone ranked a catalogued 9B over an
 * uncatalogued 27B and "escalated" a stuck review to the 9B that caused it. Margin math (diversity, warmth) runs on
 * the evidence-ranked set only — a model with no evidence is never promoted over one with evidence.
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
	const descriptors = await excludeUnroutableDescriptors(
		await fetchLoadedModelDescriptors(baseUrl).catch(
			() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
		),
		{ taskId, purpose: purpose.label },
	);
	if (descriptors.length === 0) {
		return null;
	}
	// The worker's launch modelId is usually the SERVED alias — resolve its REAL key for lineage when loaded.
	const workerRealId = resolveWorkerRealId(descriptors, workerLaunch.modelId);
	// The role the pick FILLS gates the class: an escalation replaces the card's WORKER (tool use required), every
	// other kind judges (reviewer class).
	const role: SwarmRole = sessionKind === "worker" ? "worker" : "reviewer";
	const evidence = await (deps.loadCapabilityEvidence ?? loadReviewerCapabilityEvidence)({
		providerId: workerLaunch.providerId,
		endpoint: baseUrl,
		...(deps.ledgerRootDir !== undefined ? { ledgerRootDir: deps.ledgerRootDir } : {}),
	}).catch(() => DISABLED_REVIEWER_CAPABILITY_EVIDENCE);
	const ranking = rankReviewerCandidateDescriptors(descriptors, workerLaunch.modelId, workerRealId, {
		role,
		capabilityEvidence: evidence.resolve,
	});
	let candidates = ranking.ranked;
	let strictlyStronger: { baseline: StrictlyStrongerBaseline; selection: StrictlyStrongerSelection } | null = null;
	if (deps.requireStrictlyStrongerThanWorker) {
		const workerDescriptor =
			descriptors.find(
				(descriptor) =>
					descriptor.runtimeId === workerLaunch.modelId || descriptor.modelKey === workerLaunch.modelId,
			) ?? null;
		const baseline: StrictlyStrongerBaseline = {
			modelKey: workerLaunch.modelId,
			capability: evidence.resolve({ runtimeId: workerLaunch.modelId, modelKey: workerRealId }, role),
			...(workerDescriptor
				? describeServing(workerDescriptor)
				: {
						contextLength: workerLaunch.contextWindow ?? 0,
						quantPenalty: quantizationPenalty(`${workerLaunch.modelId} ${workerRealId}`),
					}),
		};
		const selection = selectStrictlyStrongerCandidates(ranking.ranked, baseline);
		strictlyStronger = { baseline, selection };
		candidates = selection.qualified;
	}
	if (ranking.ranked.length > 0 || ranking.excluded.length > 0) {
		recordRankingObservation({ taskId, purpose, role, evidence, workerRealId, ranking, strictlyStronger });
	}
	if (candidates.length === 0) {
		if (strictlyStronger?.selection.refusedReason) {
			recordSelfObservation({
				signal: "custom",
				severity: "warning",
				message: `${purpose.label} escalation refused for ${taskId}: ${strictlyStronger.selection.refusedReason}.`,
				taskId,
				metadata: {
					category: "escalation_not_stronger_refused",
					worker: workerRealId,
					baselineCapability: strictlyStronger.baseline.capability?.score ?? null,
					baselineBasis: strictlyStronger.baseline.capability?.basis ?? null,
					verdicts: strictlyStronger.selection.verdicts,
				},
			});
		}
		return null;
	}
	// Margin math stays on ONE scale: the evidence-ranked candidates, unless nothing is rankable (then class fit, the
	// pre-evidence order). A candidate with no capability claim is never promoted over one with evidence.
	const rankable = candidates.filter((candidate) => candidate.capability !== null);
	const pool = rankable.length > 0 ? rankable : candidates;
	const preferred = applyDiversityPreference({
		ranked: pool,
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
	const pickByKey = (modelKey: string): RankedReviewerCandidate =>
		pool.find((candidate) => candidate.modelKey === modelKey) ?? (preferredPick as RankedReviewerCandidate);
	if (!preferred.diversityAchieved) {
		// A diversity waiver means the strongest *other* loaded model is same-lineage or the diverse alternative is
		// outside the capability margin. Returning null here used to make the caller fall all the way back to the
		// original worker, silently turning review into self-review even though a stronger independent session was
		// available. Preserve the capability decision and use the ranked non-worker candidate.
		const pick = pickByKey(preferredPick.modelKey);
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
				...pickCapabilityMetadata(pick),
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
	const pick = pickByKey((warmthPick ?? preferredPick).modelKey);
	recordSelfObservation({
		signal: "custom",
		severity: "info",
		message: `Auto-picked lineage-diverse ${purpose.label} ${pick.modelKey} (${resolveLineage(pick.modelId)}) for ${taskId} — worker is ${workerRealId} (${resolveLineage(workerRealId)}).`,
		taskId,
		metadata: {
			category: purpose.category,
			reviewer: pick.modelKey,
			worker: workerRealId,
			...pickCapabilityMetadata(pick),
		},
	});
	return { providerId: workerLaunch.providerId, modelId: pick.modelKey };
}
