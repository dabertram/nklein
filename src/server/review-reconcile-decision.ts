import type { RuntimeBoardCard } from "../core/api-contract";
import type { MergeHistoryRecord } from "../state/merge-history-store";
import type { TaskResultBranchProbe } from "../workspace/task-result-branches";
import {
	classifyApprovedUnmergedCard,
	MERGE_REDELIVERY_MAX_PER_DAY,
	MERGE_REDELIVERY_MIN_GAP_MS,
	type MergeRedeliveryDecision,
	minutesUntil,
} from "./merge-redelivery-decision";

/**
 * P0.RECONCILE-SKIP — the boot reconcile's per-candidate decision, lifted out of `runtime-server.ts` so every
 * way a Review/In-Progress auto-review card can be NOT driven at boot is a named, tested outcome.
 *
 * ── THE SILENCE THIS CLOSES (live 2026-09-04, two boots in a row) ──
 * The reconcile did `if (resolveTaskResultBranchCommit(...)) finalize(...)`. That resolver returns `null` for BOTH
 * "no result branch" and "the git probe FAILED" (spawn failure under a boot-time git burst, a torn ref, a missing
 * object) — and the `if` dropped the card with no line, for the rest of the process (the reconcile runs once per
 * boot). Two APPROVED cards whose deliveries had conflicted produced zero log lines across two boots while their
 * verdict-less sibling was processed; an operator hand-merge later landed one of them and the NEXT boot completed
 * it via the already-merged path. Which of the silent exits fired that night is not recoverable from the code
 * alone; what is provable is that the loop had three exits with no record (probe null, per-candidate throw
 * aborting the remaining candidates, and the plan-mode skip inside the finalizer) and consulted no merge history
 * at all — so approved cards whose last delivery FAILED were re-merged blind, without the watchdog's documented
 * gap/cap rules, or not at all.
 *
 * ── THE CONTRACT NOW ──
 * Every candidate ends in exactly one of: `finalize` (drive the finalizer — for an approved card whose newest
 * delivery attempt failed, that is a RE-DELIVERY carrying the same decision the watchdog records), `hold` (the
 * redelivery gap or daily cap says not yet — surfaced with WHEN), or `skip` (nothing to drive — surfaced with
 * WHY). The three-state result-branch probe stays three-state: an ERROR is fail-closed and named, never mistaken
 * for absence. Pure — the effectful caller probes, records and drives.
 */

/** Retry schedule (ms) for a result-branch probe that ERRORS at boot — one transient git failure must not drop a card for the process lifetime. */
export const RECONCILE_RESULT_BRANCH_PROBE_RETRY_DELAYS_MS: readonly number[] = [500, 2_000];

export type ReviewReconcileCandidate = Pick<RuntimeBoardCard, "id" | "review" | "startInPlanMode">;

export type ReviewReconcileHoldKind = "redelivery_gap" | "redelivery_cap";
export type ReviewReconcileSkipKind = "plan_mode" | "no_result_branch" | "result_branch_probe_error";

export type ReviewReconcileDecision =
	| {
			action: "finalize";
			taskId: string;
			reason: string;
			/** Present when the finalize IS a re-delivery of a failed attempt — the caller records it as such. */
			redelivery: MergeRedeliveryDecision | null;
	  }
	| {
			action: "hold";
			taskId: string;
			hold: ReviewReconcileHoldKind;
			reason: string;
			lastAttemptAt: number;
			attemptsInWindow: number;
			/** When the hold lifts by itself (gap elapsed / cap window rolled) — the watchdog re-gates the card then. */
			retryAt: number;
	  }
	| { action: "skip"; taskId: string; skip: ReviewReconcileSkipKind; reason: string };

const NO_SESSIONS: ReadonlySet<string> = new Set();

export function decideReviewReconcileCandidate(input: {
	card: ReviewReconcileCandidate;
	probe: TaskResultBranchProbe;
	history: readonly MergeHistoryRecord[];
	now: number;
	/**
	 * `NKLEIN_RECONCILE_REDELIVERY_RULES` (default on). Off = the pre-fix boot behaviour: an approved card whose
	 * last delivery failed is re-finalized at once, gap and cap ignored — still recorded as a re-delivery.
	 */
	honourRedeliveryRules: boolean;
}): ReviewReconcileDecision {
	const { card, probe, now } = input;
	const taskId = card.id;
	const reviewStatus = card.review?.status ?? null;
	const approved = reviewStatus === "approved";
	if (card.startInPlanMode) {
		return {
			action: "skip",
			taskId,
			skip: "plan_mode",
			reason: "plan-mode card — its decomposition path owns it; the auto-review finalizer never auto-completes it",
		};
	}
	if (probe.status === "error") {
		return {
			action: "skip",
			taskId,
			skip: "result_branch_probe_error",
			reason: `the result-branch probe failed (${probe.message}) — held fail-closed rather than treated as "no result"; the next boot re-probes`,
		};
	}
	if (probe.status === "missing") {
		return approved
			? {
					action: "finalize",
					taskId,
					reason: "approved with no result branch — the settled no-op completes through delivery",
					redelivery: null,
				}
			: {
					action: "skip",
					taskId,
					skip: "no_result_branch",
					reason: `review ${reviewStatus ?? "pending"} and no result branch — nothing to deliver; the watchdog's review rescue / bounced redrive owns it`,
				};
	}
	if (!approved) {
		return {
			action: "finalize",
			taskId,
			reason: `review ${reviewStatus ?? "pending"} — dispatching the review`,
			redelivery: null,
		};
	}
	const classification = classifyApprovedUnmergedCard({
		card,
		history: input.history,
		activeTaskIds: NO_SESSIONS,
		handledThisTick: NO_SESSIONS,
		now,
	});
	switch (classification.kind) {
		case "never_failed":
			return {
				action: "finalize",
				taskId,
				reason:
					classification.lastAttemptAt === null
						? "approved — delivery not yet attempted"
						: "approved — the last delivery merged; completing",
				redelivery: null,
			};
		case "redeliver":
			return {
				action: "finalize",
				taskId,
				reason: classification.decision.reason,
				redelivery: classification.decision,
			};
		case "gap": {
			const decision: MergeRedeliveryDecision = {
				taskId,
				lastAttemptAt: classification.lastAttemptAt,
				attemptsInWindow: classification.attemptsInWindow,
				reason: classification.reason,
			};
			if (!input.honourRedeliveryRules) {
				return {
					action: "finalize",
					taskId,
					reason: `${classification.reason} (redelivery rules disabled)`,
					redelivery: decision,
				};
			}
			return {
				action: "hold",
				taskId,
				hold: "redelivery_gap",
				reason:
					`the last delivery attempt failed ${Math.round((now - classification.lastAttemptAt) / 60_000)} min ago ` +
					`(${classification.reason}); the watchdog re-gates it in ~${minutesUntil(classification.retryAt, now)} min ` +
					`(gap ${MERGE_REDELIVERY_MIN_GAP_MS / 60_000} min, attempt ${classification.attemptsInWindow + 1} of ` +
					`${MERGE_REDELIVERY_MAX_PER_DAY} in 24h)`,
				lastAttemptAt: classification.lastAttemptAt,
				attemptsInWindow: classification.attemptsInWindow,
				retryAt: classification.retryAt,
			};
		}
		case "cap": {
			const decision: MergeRedeliveryDecision = {
				taskId,
				lastAttemptAt: classification.lastAttemptAt,
				attemptsInWindow: classification.attemptsInWindow,
				reason: classification.reason,
			};
			if (!input.honourRedeliveryRules) {
				return {
					action: "finalize",
					taskId,
					reason: `${classification.reason} (redelivery rules disabled)`,
					redelivery: decision,
				};
			}
			return {
				action: "hold",
				taskId,
				hold: "redelivery_cap",
				reason:
					`${classification.attemptsInWindow} delivery attempts in 24h spent the automatic re-delivery cap of ` +
					`${MERGE_REDELIVERY_MAX_PER_DAY} (${classification.reason}); automatic re-delivery resumes in ` +
					`~${minutesUntil(classification.windowResetsAt, now)} min unless an operator merges or re-drives the card first`,
				lastAttemptAt: classification.lastAttemptAt,
				attemptsInWindow: classification.attemptsInWindow,
				retryAt: classification.windowResetsAt,
			};
		}
		case "not_approved":
		case "handled_this_tick":
		case "live":
			// Unreachable at boot (approval checked above; the reconcile passes no live/handled sets) — drive it.
			return { action: "finalize", taskId, reason: "approved", redelivery: null };
	}
}

/** The one observation a held or skipped candidate records — the fact that replaces the silent `if`. */
export function buildReviewReconcileHoldObservation(
	decision: Exclude<ReviewReconcileDecision, { action: "finalize" }>,
): {
	signal: "custom";
	severity: "info" | "warning";
	message: string;
	taskId: string;
	metadata: {
		category: "review_reconcile_hold";
		seam: "boot_reconcile";
		outcome: ReviewReconcileHoldKind | ReviewReconcileSkipKind;
		retryAt?: number;
		attemptsInWindow?: number;
		lastAttemptAt?: number;
	};
} {
	const outcome = decision.action === "hold" ? decision.hold : decision.skip;
	const severity = outcome === "redelivery_cap" || outcome === "result_branch_probe_error" ? "warning" : "info";
	return {
		signal: "custom",
		severity,
		message: `Boot reconcile ${decision.action === "hold" ? "held" : "skipped"} ${decision.taskId}: ${decision.reason}.`,
		taskId: decision.taskId,
		metadata: {
			category: "review_reconcile_hold",
			seam: "boot_reconcile",
			outcome,
			...(decision.action === "hold"
				? {
						retryAt: decision.retryAt,
						attemptsInWindow: decision.attemptsInWindow,
						lastAttemptAt: decision.lastAttemptAt,
					}
				: {}),
		},
	};
}

/** Short fate label for the per-boot summary line that names every candidate (greppable by card id). */
export function summarizeReviewReconcileDecision(decision: ReviewReconcileDecision, now: number): string {
	switch (decision.action) {
		case "finalize":
			return decision.redelivery
				? `re-deliver (attempt ${decision.redelivery.attemptsInWindow + 1}/${MERGE_REDELIVERY_MAX_PER_DAY} in 24h)`
				: "finalize";
		case "hold":
			return `held: ${decision.hold} (~${minutesUntil(decision.retryAt, now)} min)`;
		case "skip":
			return `skipped: ${decision.skip}`;
	}
}
