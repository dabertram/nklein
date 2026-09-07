import type { RuntimeBoardCard } from "../core/api-contract";
import type { MergeHistoryRecord } from "../state/merge-history-store";

/** Minimum gap since the last recorded merge attempt before the watchdog re-runs the delivery for a card. */
export const MERGE_REDELIVERY_MIN_GAP_MS = 10 * 60_000;
/** Ceiling on automatic re-deliveries per card per rolling day — every attempt can spend a full merge-agent budget. */
export const MERGE_REDELIVERY_MAX_PER_DAY = 24;
/** The rolling window the daily cap counts over. */
export const MERGE_REDELIVERY_WINDOW_MS = 24 * 60 * 60_000;

export interface MergeRedeliveryDecision {
	taskId: string;
	lastAttemptAt: number;
	attemptsInWindow: number;
	reason: string;
}

export interface ApprovedUnmergedInput {
	reviewCards: readonly Pick<RuntimeBoardCard, "id" | "review">[];
	history: readonly MergeHistoryRecord[];
	activeTaskIds: ReadonlySet<string>;
	handledThisTick: ReadonlySet<string>;
	now: number;
	/**
	 * When the watchdog last RE-RAN each card's delivery (in-process). A re-run that fails before it can write a
	 * merge-history record (Dschinn replay 2026-09-07: s54 re-delivered every 30 s tick for 3 minutes) must still
	 * respect the gap — the record is the durable basis, this map the in-flight one.
	 */
	recentAttempts?: ReadonlyMap<string, number>;
}

/**
 * Why an approved review card is NOT being re-delivered right now — or that it should be. Every leg of the
 * redelivery rules is a named outcome so a seam that decides "not now" can SAY why (P0.RECONCILE-SKIP: the boot
 * reconcile dropped approved+conflicted cards with zero log lines; the watchdog's daily cap was silent for 24h).
 */
export type ApprovedUnmergedClassification =
	/** The card's review is not approved — redelivery has no business here. */
	| { kind: "not_approved"; taskId: string }
	/** Another leg of this tick already handled the card. */
	| { kind: "handled_this_tick"; taskId: string }
	/** The newest attempt failed less than the gap ago (durable record, or an in-process re-run that left none). */
	| {
			kind: "gap";
			taskId: string;
			basis: "record" | "in_process";
			lastAttemptAt: number;
			/** When the gap elapses — the earliest the watchdog re-gates the card. */
			retryAt: number;
			attemptsInWindow: number;
			reason: string;
	  }
	/** A session of the card (worker, `::merge` or `::review`) is live. */
	| { kind: "live"; taskId: string; sessionKey: string }
	/** Never attempted here, or the newest attempt succeeded — the card's own delivery path owns it. */
	| { kind: "never_failed"; taskId: string; lastAttemptAt: number | null }
	/** The daily cap is spent; the count drops below it again at `windowResetsAt`. */
	| {
			kind: "cap";
			taskId: string;
			lastAttemptAt: number;
			attemptsInWindow: number;
			windowResetsAt: number;
			reason: string;
	  }
	/** Re-run the delivery now. */
	| { kind: "redeliver"; taskId: string; decision: MergeRedeliveryDecision };

/** The operator-facing one-liner for a failed merge-history record. */
export function describeFailedMergeAttempt(record: MergeHistoryRecord): string {
	return record.conflictedPaths.length > 0
		? `last merge conflicted in ${record.conflictedPaths.length} file(s)`
		: (record.reason ?? "last merge did not succeed");
}

/**
 * Classify ONE review card against the redelivery rules (approved, not handled, in-process gap, no live session,
 * newest record failed, durable gap, daily cap). The check order is the original watchdog order, so the first
 * rule that stops the redelivery names the outcome. Pure.
 */
export function classifyApprovedUnmergedCard(input: {
	card: Pick<RuntimeBoardCard, "id" | "review">;
	history: readonly MergeHistoryRecord[];
	activeTaskIds: ReadonlySet<string>;
	handledThisTick: ReadonlySet<string>;
	now: number;
	recentAttemptAt?: number;
}): ApprovedUnmergedClassification {
	const taskId = input.card.id;
	if (input.card.review?.status !== "approved") {
		return { kind: "not_approved", taskId };
	}
	if (input.handledThisTick.has(taskId)) {
		return { kind: "handled_this_tick", taskId };
	}
	const attempts = input.history
		.filter((record) => record.taskId === taskId)
		.sort((left, right) => right.recordedAt - left.recordedAt);
	const last = attempts[0];
	const windowStart = input.now - MERGE_REDELIVERY_WINDOW_MS;
	const attemptsInWindow = attempts.filter((record) => record.recordedAt >= windowStart);
	if (input.recentAttemptAt !== undefined && input.now - input.recentAttemptAt < MERGE_REDELIVERY_MIN_GAP_MS) {
		return {
			kind: "gap",
			taskId,
			basis: "in_process",
			lastAttemptAt: input.recentAttemptAt,
			retryAt: input.recentAttemptAt + MERGE_REDELIVERY_MIN_GAP_MS,
			attemptsInWindow: attemptsInWindow.length,
			reason:
				last && !last.ok
					? describeFailedMergeAttempt(last)
					: "a re-delivery is in flight and has left no record yet",
		};
	}
	for (const sessionKey of [taskId, `${taskId}::merge`, `${taskId}::review`]) {
		if (input.activeTaskIds.has(sessionKey)) {
			return { kind: "live", taskId, sessionKey };
		}
	}
	if (!last || last.ok) {
		return { kind: "never_failed", taskId, lastAttemptAt: last?.recordedAt ?? null };
	}
	const reason = describeFailedMergeAttempt(last);
	if (input.now - last.recordedAt < MERGE_REDELIVERY_MIN_GAP_MS) {
		return {
			kind: "gap",
			taskId,
			basis: "record",
			lastAttemptAt: last.recordedAt,
			retryAt: last.recordedAt + MERGE_REDELIVERY_MIN_GAP_MS,
			attemptsInWindow: attemptsInWindow.length,
			reason,
		};
	}
	if (attemptsInWindow.length >= MERGE_REDELIVERY_MAX_PER_DAY) {
		// The count falls below the cap once the cap-th newest record ages out of the window.
		const capHolder = attemptsInWindow[MERGE_REDELIVERY_MAX_PER_DAY - 1] ?? last;
		return {
			kind: "cap",
			taskId,
			lastAttemptAt: last.recordedAt,
			attemptsInWindow: attemptsInWindow.length,
			windowResetsAt: capHolder.recordedAt + MERGE_REDELIVERY_WINDOW_MS,
			reason,
		};
	}
	return {
		kind: "redeliver",
		taskId,
		decision: { taskId, lastAttemptAt: last.recordedAt, attemptsInWindow: attemptsInWindow.length, reason },
	};
}

/** Classify every review card, in board order. Pure. */
export function classifyApprovedUnmergedCards(input: ApprovedUnmergedInput): ApprovedUnmergedClassification[] {
	return input.reviewCards.map((card) => {
		const recentAttemptAt = input.recentAttempts?.get(card.id);
		return classifyApprovedUnmergedCard({
			card,
			history: input.history,
			activeTaskIds: input.activeTaskIds,
			handledThisTick: input.handledThisTick,
			now: input.now,
			...(recentAttemptAt !== undefined ? { recentAttemptAt } : {}),
		});
	});
}

/**
 * Pick the ONE approved-but-unmerged review card whose delivery the watchdog should re-run this tick (David
 * 2026-09-05 21:16, "seems sth stalled": after a failed merge resolution nothing re-ran the delivery until a
 * server restart — the fleet sat idle an hour between merge rounds while 77 cards waited on the conflict).
 * A card qualifies when its review is approved, its newest merge-history record failed (conflict, blocked or a
 * failed delivery gate), that record is at least {@link MERGE_REDELIVERY_MIN_GAP_MS} old, no session of the card
 * (worker, review or `::merge`) is live, it was not handled this tick, and fewer than
 * {@link MERGE_REDELIVERY_MAX_PER_DAY} attempts were recorded in the last 24h. Cards never attempted here are
 * left to their own delivery path. The first `redeliver` classification in board order wins. Pure.
 */
export function selectApprovedUnmergedRedelivery(input: ApprovedUnmergedInput): MergeRedeliveryDecision | null {
	for (const classification of classifyApprovedUnmergedCards(input)) {
		if (classification.kind === "redeliver") {
			return classification.decision;
		}
	}
	return null;
}

/** Whole minutes from `now` until `at`, floored at zero. */
export function minutesUntil(at: number, now: number): number {
	return Math.max(0, Math.ceil((at - now) / 60_000));
}

/**
 * The observation the watchdog records ONCE per (card, attempt count) when an approved card has spent its daily
 * re-delivery cap — the one redelivery hold that is otherwise silent for up to 24h (the gap hold resolves itself
 * within minutes). The caller dedups; a changed attempt count re-arms it.
 */
export function buildApprovedUnmergedCapHoldObservation(
	hold: Extract<ApprovedUnmergedClassification, { kind: "cap" }>,
	now: number,
): {
	signal: "custom";
	severity: "warning";
	message: string;
	taskId: string;
	metadata: {
		category: "review_reconcile_hold";
		seam: "watchdog";
		outcome: "redelivery_cap";
		attemptsInWindow: number;
		lastAttemptAt: number;
		retryAt: number;
	};
} {
	return {
		signal: "custom",
		severity: "warning",
		message:
			`Approved ${hold.taskId} stays unmerged: ${hold.attemptsInWindow} delivery attempts in 24h spent the automatic ` +
			`re-delivery cap of ${MERGE_REDELIVERY_MAX_PER_DAY} (${hold.reason}); automatic re-delivery resumes in ` +
			`~${minutesUntil(hold.windowResetsAt, now)} min unless an operator merges or re-drives the card first.`,
		taskId: hold.taskId,
		metadata: {
			category: "review_reconcile_hold",
			seam: "watchdog",
			outcome: "redelivery_cap",
			attemptsInWindow: hold.attemptsInWindow,
			lastAttemptAt: hold.lastAttemptAt,
			retryAt: hold.windowResetsAt,
		},
	};
}
