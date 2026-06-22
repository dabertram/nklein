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
import {
	buildReviewSeedPrompt,
	fingerprintReviewArtifact,
	type ReviewSubmissionInput,
	resolveReviewTransition,
	shouldReviewCard,
} from "../core/review-orchestration";

/** Minimal card shape the orchestrator needs (a subset of `RuntimeBoardCard`). */
export interface SecondOpinionReviewCard {
	id: string;
	title: string;
	prompt: string;
	review?: RuntimeCardReview;
}

export type NKleinSecondOpinionReviewOutcome =
	| { type: "skipped"; reason: "disabled" | "not_reviewable" | "no_diff" | "card_not_found" | "no_verdict" }
	| { type: "delivered"; round: number; signOff: string }
	| { type: "bounced"; round: number }
	| { type: "parked"; round: number; reason: string };

export interface RunNKleinSecondOpinionReviewInput {
	taskId: string;
	/** Column the card is in (only `review` cards are reviewed). */
	columnId: string;
	/** The second-opinion-review setting; false skips entirely. */
	enabled: boolean;
	/** Round cap before parking. */
	maxRounds: number;
	/** True when this card is itself a reviewer card (recursion guard). */
	isReviewerCard?: boolean;
	/** True for planning/decomposition cards (skipped). */
	isPlanningCard?: boolean;
	/** Human acceptance-gate summary to give the reviewer, when an acceptance check ran. */
	acceptanceSummary?: string | null;
	now?: () => number;
	deps: {
		/** Resolve the card (with its persisted review history) by id; null when gone. */
		getCard(taskId: string): Promise<SecondOpinionReviewCard | null>;
		/** The worker's diff under review; null/empty means nothing to review. */
		getTaskDiff(taskId: string): Promise<string | null>;
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
		updatedAt: input.now,
	};
}

export async function runNKleinSecondOpinionReview(
	input: RunNKleinSecondOpinionReviewInput,
): Promise<NKleinSecondOpinionReviewOutcome> {
	const now = (input.now ?? Date.now)();
	const card = await input.deps.getCard(input.taskId);
	if (!card) {
		return { type: "skipped", reason: "card_not_found" };
	}
	const diff = (await input.deps.getTaskDiff(input.taskId))?.trim() || "";
	if (
		!shouldReviewCard({
			enabled: input.enabled,
			columnId: input.columnId,
			isReviewerCard: input.isReviewerCard === true,
			isPlanningCard: input.isPlanningCard === true,
			hasReviewableDiff: diff.length > 0,
		})
	) {
		if (!input.enabled || input.columnId !== "review" || input.isReviewerCard || input.isPlanningCard) {
			return { type: "skipped", reason: input.enabled ? "not_reviewable" : "disabled" };
		}
		return { type: "skipped", reason: "no_diff" };
	}

	const history = card.review?.history ?? [];
	const round = history.length + 1;
	const seedPrompt = buildReviewSeedPrompt({
		taskTitle: card.title,
		taskObjective: card.prompt,
		diff,
		acceptanceSummary: input.acceptanceSummary ?? null,
		round,
		priorFeedback: card.review?.lastFeedback ?? null,
	});
	const submission = await input.deps.runReviewSession({ taskId: input.taskId, seedPrompt, round });
	if (!submission) {
		return { type: "skipped", reason: "no_verdict" };
	}

	const workFingerprint = fingerprintReviewArtifact(diff);
	const transition = resolveReviewTransition({
		submission,
		round,
		workFingerprint,
		history,
		maxRounds: input.maxRounds,
	});
	const previousSignOff = card.review?.signOff ?? null;

	if (transition.action === "deliver") {
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
		});
		await input.deps.onDeliver({ taskId: input.taskId, review });
		return { type: "delivered", round, signOff: transition.signOff };
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
