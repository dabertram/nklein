import type { RuntimeBoardCard } from "../core/api-contract";
import type { MergeHistoryRecord } from "../state/merge-history-store";

/** Minimum gap since the last recorded merge attempt before the watchdog re-runs the delivery for a card. */
export const MERGE_REDELIVERY_MIN_GAP_MS = 10 * 60_000;
/** Ceiling on automatic re-deliveries per card per rolling day — every attempt can spend a full merge-agent budget. */
export const MERGE_REDELIVERY_MAX_PER_DAY = 24;

export interface MergeRedeliveryDecision {
	taskId: string;
	lastAttemptAt: number;
	attemptsInWindow: number;
	reason: string;
}

/**
 * Pick the ONE approved-but-unmerged review card whose delivery the watchdog should re-run this tick (David
 * 2026-09-05 21:16, "seems sth stalled": after a failed merge resolution nothing re-ran the delivery until a
 * server restart — the fleet sat idle an hour between merge rounds while 77 cards waited on the conflict).
 * A card qualifies when its review is approved, its newest merge-history record failed (conflict or blocked),
 * that record is at least {@link MERGE_REDELIVERY_MIN_GAP_MS} old, no session of the card (worker, review or
 * `::merge`) is live, it was not handled this tick, and fewer than {@link MERGE_REDELIVERY_MAX_PER_DAY} attempts
 * were recorded in the last 24h. Cards never attempted here are left to their own delivery path. Pure.
 */
export function selectApprovedUnmergedRedelivery(input: {
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
}): MergeRedeliveryDecision | null {
	const dayAgo = input.now - 24 * 60 * 60_000;
	for (const card of input.reviewCards) {
		if (card.review?.status !== "approved" || input.handledThisTick.has(card.id)) {
			continue;
		}
		const recentAttemptAt = input.recentAttempts?.get(card.id);
		if (recentAttemptAt !== undefined && input.now - recentAttemptAt < MERGE_REDELIVERY_MIN_GAP_MS) {
			continue;
		}
		if (
			input.activeTaskIds.has(card.id) ||
			input.activeTaskIds.has(`${card.id}::merge`) ||
			input.activeTaskIds.has(`${card.id}::review`)
		) {
			continue;
		}
		const attempts = input.history
			.filter((record) => record.taskId === card.id)
			.sort((left, right) => right.recordedAt - left.recordedAt);
		const last = attempts[0];
		if (!last || last.ok) {
			continue;
		}
		if (input.now - last.recordedAt < MERGE_REDELIVERY_MIN_GAP_MS) {
			continue;
		}
		const attemptsInWindow = attempts.filter((record) => record.recordedAt >= dayAgo).length;
		if (attemptsInWindow >= MERGE_REDELIVERY_MAX_PER_DAY) {
			continue;
		}
		return {
			taskId: card.id,
			lastAttemptAt: last.recordedAt,
			attemptsInWindow,
			reason:
				last.conflictedPaths.length > 0
					? `last merge conflicted in ${last.conflictedPaths.length} file(s)`
					: (last.reason ?? "last merge did not succeed"),
		};
	}
	return null;
}
