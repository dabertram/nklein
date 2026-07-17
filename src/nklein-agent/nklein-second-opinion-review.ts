/**
 * Second-opinion review orchestrator (todo.md §5.K).
 *
 * Drives one review round for a card that just became reviewable: gate it, extract the worker's diff, run a
 * reviewer-role session that returns a structured verdict, then map that verdict to a board transition and call
 * the matching side-effect primitive (deliver / bounce-to-worker / park). All I/O — loading the board, getting
 * the diff, starting the reviewer session, and applying the transition — is injected, mirroring
 * {@link runNKleinAcceptanceAutoRepair}, so the whole flow is unit-testable without a live model, Docker, or
 * board. The live wiring (real diff extraction, reviewer session, board mutation + broadcast) lives in the
 * runtime state hub and only has to satisfy these dependency shapes.
 */

import type { RuntimeCardReview, RuntimeReviewRoundRecord } from "../core/api-contract";
import { classifyDiffReviewRisk } from "../core/diff-review-risk";
import { type FocusChain, formatFocusChainForPrompt } from "../core/focus-chain";
import type { ReviewLens } from "../core/review-lenses";
import {
	buildReviewSeedPrompt,
	fingerprintReviewArtifact,
	type ReviewBoardContext,
	type ReviewSubmissionInput,
	resolveReviewTransition,
	shouldReviewCard,
} from "../core/review-orchestration";

/** Extra context the reviewer should judge against: the worker's reasoning + the card's place in the board/plan. */
export interface ReviewContext {
	workerReasoning: string | null;
	boardContext: ReviewBoardContext | null;
}

/** Minimal card shape the orchestrator needs (a subset of `RuntimeBoardCard`). */
export interface SecondOpinionReviewCard {
	id: string;
	title: string;
	prompt: string;
	review?: RuntimeCardReview;
	/** The worker's self-authored focus chain (todo §5.N), surfaced to the reviewer to judge plan adherence. */
	focusChain?: FocusChain | null;
}

export type NKleinSecondOpinionReviewOutcome =
	| { type: "skipped"; reason: "disabled" | "not_reviewable" | "card_not_found" | "no_verdict" }
	| { type: "blocked"; reason: "pinned_reviewer_unavailable"; message: string }
	/** §5.AW: `preferred` is set only when the review was an A/B arbitration (a speculative candidate existed). */
	| {
			type: "delivered";
			round: number;
			signOff: string;
			preferred?: "primary" | "speculative" | null;
			/** True when unchanged work reused its persisted approval without launching another reviewer session. */
			reusedApproval?: boolean;
	  }
	| { type: "bounced"; round: number }
	/** W4.2: the stuck card was re-driven on a stronger/different-lineage worker (one escalation per card). */
	| { type: "escalated"; round: number }
	| { type: "parked"; round: number; reason: string };

export interface RunNKleinSecondOpinionReviewInput {
	taskId: string;
	/** Column the card is in (only `review` cards are reviewed). */
	columnId: string;
	/** The second-opinion-review setting; false skips entirely. */
	enabled: boolean;
	/** Round cap before parking. */
	maxRounds: number;
	/** W4.2: an untried stronger/different-lineage worker exists AND deps.onEscalate is wired. */
	escalationAvailable?: boolean;
	/** W4.2: this card already used its one escalation. */
	alreadyEscalated?: boolean;
	/** True when this card is itself a reviewer card (recursion guard). */
	isReviewerCard?: boolean;
	/** True for planning/decomposition cards (skipped). */
	isPlanningCard?: boolean;
	/** Human acceptance-gate summary to give the reviewer, when an acceptance check ran. */
	acceptanceSummary?: string | null;
	/**
	 * §5.AW review-panel lenses (opt-in): the orthogonal perspectives the reviewer seed should steer through. The
	 * runner computes these via {@link planReviewPanel} only when `NKLEIN_REVIEW_LENSES` is set — otherwise absent,
	 * so the seed prompt is byte-identical to the un-lensed default.
	 */
	reviewLenses?: readonly ReviewLens[];
	/** §5.V test-driven gate (or any deterministic PRE-review verdict): when set, the reviewer MODEL is skipped and
	 *  this submission rides the standard transition machinery — so a synthetic `request_changes` bounces via the
	 *  normal onBounce, and a REPEATED identical gate feedback trips the identical-loop PARK guard (never spins). */
	preReviewVerdict?: ReviewSubmissionInput | null;
	now?: () => number;
	/**
	 * Diagnostic phase stamps (2026-07-11 review-hang autopsy, todo §12): a silently-wedged review pinpoints its
	 * LAST-reached inner phase (card-load / diff / context / seed-built / review-session). Optional + warn-routed —
	 * absent means zero overhead and byte-identical behavior.
	 */
	stampPhase?: (phase: string) => void;
	deps: {
		/** Resolve the card (with its persisted review history) by id; null when gone. */
		getCard(taskId: string): Promise<SecondOpinionReviewCard | null>;
		/** The worker's diff under review; null/empty means nothing to review. */
		getTaskDiff(taskId: string): Promise<string | null>;
		/** §5.AW: the speculative mirror's diff for the same card, when a `::spec` result branch exists. */
		getSpeculativeDiff?(taskId: string): Promise<string | null>;
		/** The worker's reasoning + the card's board/plan context, so the reviewer judges approach + fit, not just files. */
		getReviewContext?(taskId: string): Promise<ReviewContext>;
		/** Start a reviewer-role session with the seed prompt + `submit_review` tool; resolve to its verdict. */
		runReviewSession(input: {
			taskId: string;
			seedPrompt: string;
			round: number;
		}): Promise<ReviewSubmissionInput | null>;
		/** Approved: persist the review state and proceed to delivery with the sign-off. */
		onDeliver(input: { taskId: string; review: RuntimeCardReview }): Promise<void>;
		/** Changes requested: persist the review state, send the worker the feedback, move the card back. */
		onBounce(input: { taskId: string; review: RuntimeCardReview; workerPrompt: string }): Promise<void>;
		/** W4.2 (optional): re-drive the stuck card on a stronger/different-lineage worker. Absent ⇒ park instead. */
		onEscalate?(input: { taskId: string; review: RuntimeCardReview; workerPrompt: string }): Promise<void>;
		/** Parked: persist the review state and flag the card for a human. */
		onPark(input: { taskId: string; review: RuntimeCardReview; reason: string }): Promise<void>;
	};
}

function buildNextReview(input: {
	round: number;
	history: readonly RuntimeReviewRoundRecord[];
	record: RuntimeReviewRoundRecord;
	submission: ReviewSubmissionInput;
	status: RuntimeCardReview["status"];
	signOff: string | null;
	parkedReason: string | null;
	previousSignOff: string | null;
	now: number;
	/** §5.AW: persisted A/B arbitration pick on a delivered review; omitted otherwise. */
	preferredCandidate?: "primary" | "speculative";
}): RuntimeCardReview {
	return {
		status: input.status,
		round: input.round,
		history: [...input.history, input.record],
		lastVerdict: input.submission.verdict,
		lastSummary: input.submission.summary,
		lastFeedback: input.submission.feedback,
		lastInsight: input.submission.insight,
		signOff: input.signOff ?? input.previousSignOff,
		parkedReason: input.parkedReason,
		...(input.preferredCandidate ? { preferredCandidate: input.preferredCandidate } : {}),
		updatedAt: input.now,
	};
}

export async function runNKleinSecondOpinionReview(
	input: RunNKleinSecondOpinionReviewInput,
): Promise<NKleinSecondOpinionReviewOutcome> {
	const now = (input.now ?? Date.now)();
	const stamp = input.stampPhase ?? (() => {});
	stamp("core: card-load");
	const card = await input.deps.getCard(input.taskId);
	if (!card) {
		return { type: "skipped", reason: "card_not_found" };
	}
	stamp("core: diff-load");
	const diff = (await input.deps.getTaskDiff(input.taskId))?.trim() || "";
	if (
		!shouldReviewCard({
			enabled: input.enabled,
			columnId: input.columnId,
			isReviewerCard: input.isReviewerCard === true,
			isPlanningCard: input.isPlanningCard === true,
		})
	) {
		return { type: "skipped", reason: input.enabled ? "not_reviewable" : "disabled" };
	}

	// A review approval is durable delivery evidence for the exact work artifact it judged. Runtime finalization can
	// be requested again while the first delivery is still settling (summary churn, restart reconciliation, or a
	// transient workspace-state lock retry). Re-running the reviewer for unchanged, already-approved work wastes a
	// model turn and can turn a valid sign-off into a later `no_verdict` hold. Reuse only a fully self-consistent
	// approval record; carried-forward sign-offs on changes-requested/parked cards and old/corrupt records fail closed.
	// A deterministic pre-review verdict deliberately supersedes the old approval (for example test-driven mode).
	const workFingerprint = fingerprintReviewArtifact(diff || "(no file changes)");
	const persistedReview = card.review;
	const latestReviewRecord = persistedReview?.history.at(-1);
	if (
		input.preReviewVerdict == null &&
		persistedReview?.status === "approved" &&
		persistedReview.lastVerdict === "approve" &&
		persistedReview.signOff?.trim() &&
		persistedReview.round === latestReviewRecord?.round &&
		latestReviewRecord.verdict === "approve" &&
		latestReviewRecord.workFingerprint === workFingerprint
	) {
		return {
			type: "delivered",
			round: persistedReview.round,
			signOff: persistedReview.signOff,
			preferred: persistedReview.preferredCandidate ?? null,
			reusedApproval: true,
		};
	}

	const history = card.review?.history ?? [];
	const round = history.length + 1;
	stamp("core: context-load");
	const reviewContext = (await input.deps.getReviewContext?.(input.taskId)) ?? null;
	// §5.AW: a captured speculative candidate arms the A/B arbitration seed. Only a non-empty PRIMARY diff
	// qualifies — a no-op primary keeps the ordinary no-changes review flow (the spec is discarded with it).
	const speculativeDiff = diff ? ((await input.deps.getSpeculativeDiff?.(input.taskId))?.trim() ?? "") : "";
	// F12.54: classify the diff's review risk and route the reviewer's attention (deep-review demand on high-risk
	// surface, fast-track on docs/tests, fatigue warning on oversized) — a prompt directive, never a gate.
	const diffRisk = diff ? classifyDiffReviewRisk(diff) : null;
	const seedPrompt = buildReviewSeedPrompt({
		taskTitle: card.title,
		taskObjective: card.prompt,
		diff,
		riskDirective: diffRisk?.directive ?? null,
		speculativeDiff: speculativeDiff || null,
		workerReasoning: reviewContext?.workerReasoning ?? null,
		boardContext: reviewContext?.boardContext ?? null,
		acceptanceSummary: input.acceptanceSummary ?? null,
		round,
		priorFeedback: card.review?.lastFeedback ?? null,
		focusChain: card.focusChain ? formatFocusChainForPrompt(card.focusChain) : null,
		// Opt-in: absent unless the runner (gated on NKLEIN_REVIEW_LENSES) supplied a non-empty panel.
		...(input.reviewLenses && input.reviewLenses.length > 0 ? { lenses: input.reviewLenses } : {}),
	});
	stamp(`core: review-session start (round ${round}, seed ${seedPrompt.length}b)`);
	const submission =
		input.preReviewVerdict ?? (await input.deps.runReviewSession({ taskId: input.taskId, seedPrompt, round }));
	stamp(`core: review-session done (${submission ? submission.verdict : "no submission"})`);
	if (!submission) {
		return { type: "skipped", reason: "no_verdict" };
	}

	// A no-change result still gets a stable work fingerprint so the stall / identical-loop guards engage when a
	// card keeps coming back with nothing done (a common bad-planning symptom), rather than bouncing to the cap.
	const transition = resolveReviewTransition({
		submission,
		round,
		workFingerprint,
		history,
		maxRounds: input.maxRounds,
		// Escalation only counts as available when the executor is actually wired.
		escalationAvailable: Boolean(input.escalationAvailable && input.deps.onEscalate),
		...(input.alreadyEscalated !== undefined ? { alreadyEscalated: input.alreadyEscalated } : {}),
	});
	const previousSignOff = card.review?.signOff ?? null;

	if (transition.action === "deliver") {
		// §5.AW: an approving reviewer that named no candidate delivers the PRIMARY (conservative default).
		const preferred = speculativeDiff ? (submission.preferred ?? "primary") : null;
		const review = buildNextReview({
			round,
			history,
			record: transition.record,
			submission,
			status: "approved",
			signOff: transition.signOff,
			parkedReason: null,
			previousSignOff,
			now,
			// Persist the pick so a restart between this verdict and delivery still delivers the winner.
			...(preferred ? { preferredCandidate: preferred } : {}),
		});
		await input.deps.onDeliver({ taskId: input.taskId, review });
		return {
			type: "delivered",
			round,
			signOff: transition.signOff,
			preferred,
		};
	}
	if (transition.action === "bounce_to_worker") {
		const review = buildNextReview({
			round,
			history,
			record: transition.record,
			submission,
			status: "changes_requested",
			signOff: null,
			parkedReason: null,
			previousSignOff,
			now,
		});
		await input.deps.onBounce({ taskId: input.taskId, review, workerPrompt: transition.workerPrompt });
		return { type: "bounced", round };
	}
	if (transition.action === "escalate_worker" && input.deps.onEscalate) {
		const review = buildNextReview({
			round,
			history,
			record: transition.record,
			submission,
			status: "changes_requested",
			signOff: null,
			parkedReason: null,
			previousSignOff,
			now,
		});
		await input.deps.onEscalate({ taskId: input.taskId, review, workerPrompt: transition.workerPrompt });
		return { type: "escalated", round };
	}
	const review = buildNextReview({
		round,
		history,
		record: transition.record,
		submission,
		status: "parked",
		signOff: null,
		parkedReason: transition.reason,
		previousSignOff,
		now,
	});
	await input.deps.onPark({ taskId: input.taskId, review, reason: transition.reason });
	return { type: "parked", round, reason: transition.reason };
}
