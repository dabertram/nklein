import type { RuntimeTaskSessionState } from "./task-session-api-contract";

/**
 * Session-state predicates (todo §5.U — consolidates a `state === "running" || state === "queued"` check that had
 * drifted across ~5 files). A single source of truth for the state groupings the runtime reasons about.
 */

/**
 * True while a session actively occupies a runtime/model slot: it is RUNNING or waiting-to-run (QUEUED). The grouping
 * the concurrency/preemption/park paths mean by "busy" — a session in either state is holding (or about to hold)
 * capacity. Deliberately excludes `awaiting_review` and `idle`, which are separate concepts some call sites add on top.
 */
export function isBusySessionState(state: RuntimeTaskSessionState | null | undefined): boolean {
	return state === "running" || state === "queued";
}

/**
 * True while the worker may still produce or change its result: RUNNING, QUEUED, or PAUSED. The grouping the
 * result-probe/rerun paths mean by "work is still in flight" — a durable result branch seen in these states may be a
 * previous round's artifact and must not be accepted as the current outcome. Broader than `isBusySessionState`
 * because a paused session holds no capacity but its work is still unfinished.
 */
export function isActiveWorkSessionState(state: RuntimeTaskSessionState | null | undefined): boolean {
	return isBusySessionState(state) || state === "paused";
}

/**
 * True while the task still HAS a session the runtime owns — running, waiting-to-run (`queued`), deliberately held
 * (`paused`), or handed to review (`awaiting_review`). The grouping every recovery/reclaim path means by "something
 * is still alive here; do not restart it and do not declare its worker dead".
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT AN INLINE CHECK ──
 * This module exists because exactly this concept had drifted across ~5 files (see the header). It drifted again, and
 * the second drift cost a live run: the durable lease heartbeat filtered `state === "running"` alone, while the
 * terminal-retry sweep used the full set. So a card whose session sat QUEUED in model-turn admission was "live" to
 * one subsystem and "a dead worker" to the other — and the durable scheduler reclaimed its lease every 5 minutes,
 * burning an attempt each time, until `max_attempts` cancelled a card that had done nothing wrong.
 *
 * G6.8a v16 (2026-07-29), verbatim: `habit-score-clamping-tests-clamping` was leased at 19:26:55 and its model turn
 * queued behind the host's 1-concurrent-session cap (a sibling worker's single turn ran 19:34→19:53 under low-power
 * mode). Its lease expired at 19:31:55, 19:37:28, 19:42:58 → `cancelled(max_attempts)`. The card then STARTED FOR
 * REAL at 19:53:44 — eleven minutes after the scheduler had already given up on it — and the board sat frozen for
 * ~70 minutes. Waiting your turn on a saturated host is the system working; the lease-expiry guard is for DEAD
 * workers, not for slow or queued ones.
 *
 * RESIDUAL RISK, accepted deliberately: a session wedged in `queued` forever now holds its lease forever instead of
 * failing after three reclaims. That is the better failure — the reclaim path did not rescue anything (the board
 * livelocked anyway, just with a cancelled card as well), the admission layer's own awaits are bounded (F1.34c), and
 * the run's max-wait bounds the whole drain. Reclaiming a card that never got a slot only destroys its retry budget.
 */
export function hasLiveTaskSession(state: RuntimeTaskSessionState | null | undefined): boolean {
	return isActiveWorkSessionState(state) || state === "awaiting_review";
}

/**
 * True when a session ended in an UNSUCCESSFUL terminal state: it errored (`failed`) or was aborted / torn down
 * (`interrupted`) — as opposed to still-active, awaiting review, or cleanly completed. The grouping the recovery /
 * feedback / finalize paths mean by "the run did not finish successfully".
 */
export function isTerminalFailureSessionState(
	state: RuntimeTaskSessionState | null | undefined,
): state is "failed" | "interrupted" {
	return state === "failed" || state === "interrupted";
}
