/**
 * Sessions the runtime has RETIRED: stopped for a reason that must survive, so nothing resurrects them.
 *
 * ── WHY THIS EXISTS ──
 * Live 2026-09-08, project 38 of the dev-test drive: card `mutation-duration-schedule-kill-m3` reached `completed`
 * with a model turn still queued behind the shared endpoint. When the turn came up, the context-overflow controller
 * decided to compact — and compaction RESTARTS the session. The board-liveness watchdog then saw a live session on
 * a completed card and stopped it ("it holds a model slot with nothing to deliver"). The stop aborted the turn, the
 * delivery retried, the controller compacted again, and the cycle repeated **every 30 seconds**, each round burning
 * one request against the model endpoint. Sixteen junk requests reached the queue in seven minutes and the drive
 * made no progress at all.
 *
 * Two correct mechanisms were fighting: one stops the session of a terminal-lane card, the other restarts a session
 * that needs compacting. Neither is wrong on its own, and adding a lane check to the second would only teach ONE
 * restart path about lanes — `trashed-card-sessions.ts` already records an earlier round of exactly this ("a purged
 * redecompose clone whose session the context-overflow controller kept restarting on every nudge"), where the fix
 * taught the stopper and not the starter, which is why the loop came back.
 *
 * So retirement is a fact about the SESSION, recorded where it is decided and read by every path that could revive
 * one. The asymmetry is the whole design:
 *   - stopping does NOT retire (an ordinary stop is routine — pause, restart, fork all stop first);
 *   - only an explicit retire does, and the caller must have a reason that outlives the stop;
 *   - a deliberate START clears it, because starting the card again is exactly the gesture that says the reason is
 *     gone (an operator re-opening a completed card, a redecompose reusing the id). Nothing else clears it.
 */

export type SessionRetirementReason = "terminal_lane_card" | "card_absent_from_board";

export interface RetiredSession {
	readonly taskId: string;
	readonly reason: SessionRetirementReason;
	/** Free-text detail for the observation trail (the lane it sat in, the card that vanished). */
	readonly detail: string;
	readonly at: number;
}

export type SessionRetirementLedger = ReadonlyMap<string, RetiredSession>;

export const EMPTY_SESSION_RETIREMENT_LEDGER: SessionRetirementLedger = new Map();

/** Record a retirement. Re-retiring keeps the ORIGINAL record — the first reason is the true one. */
export function retireSession(ledger: SessionRetirementLedger, entry: RetiredSession): Map<string, RetiredSession> {
	const next = new Map(ledger);
	if (!next.has(entry.taskId)) {
		next.set(entry.taskId, entry);
	}
	return next;
}

/** Clear a retirement — ONLY on a deliberate start of that task. */
export function reviveSession(ledger: SessionRetirementLedger, taskId: string): Map<string, RetiredSession> {
	if (!ledger.has(taskId)) {
		return new Map(ledger);
	}
	const next = new Map(ledger);
	next.delete(taskId);
	return next;
}

export function findRetiredSession(ledger: SessionRetirementLedger, taskId: string): RetiredSession | null {
	return ledger.get(taskId) ?? null;
}

/**
 * The message a refused revival reports. Names the reason AND the fact that a restart was attempted, because the
 * loop this prevents is silent from the outside: the only visible symptom was requests appearing on the endpoint.
 */
export function describeRefusedRevival(entry: RetiredSession): string {
	return (
		`Refusing to restart the session for ${entry.taskId}: it was retired (${entry.reason}${entry.detail ? ` — ${entry.detail}` : ""}). ` +
		"A retired session has nothing left to deliver; restarting it would re-enter the stop/restart loop that retirement exists to end."
	);
}
