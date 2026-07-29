/**
 * §5.U — the PURE gate for the runtime's terminal-retry sweep, lifted out of `runtime-server`'s stateful
 * `retryWaitingCardsAfterTerminal`. The sweep is debounced to avoid storms when several tasks finish at once, but a
 * pending one-shot dead-card REDRIVE (#24) must NOT be swallowed by a neighboring terminal's debounce window — losing it
 * would strand that card permanently. So a redrive bypasses the debounce; otherwise the sweep only runs once the
 * debounce window has elapsed. Total + pure (no clock, no I/O): the caller passes `now`.
 */
import { hasLiveTaskSession } from "../core/session-state-predicates";
import type { RuntimeTaskSessionState } from "../core/task-session-api-contract";

export interface TerminalRetrySweepGateInput {
	/** The current time (ms). */
	now: number;
	/** When this workspace's sweep last ran (ms); 0 if never. */
	lastSweepAt: number;
	/** The debounce window (ms) between ordinary sweeps. */
	debounceMs: number;
	/** True when a one-shot dead-card redrive is pending for this terminal — it must run regardless of the debounce. */
	redrivePending: boolean;
	/**
	 * True when the caller is the one-shot deferred-retry TIMER (#26). The timer exists precisely to be the
	 * trailing sweep after the last completion — debouncing it away re-created the stranded-deferral freeze it
	 * was built to prevent (live-found 2026-07-10, simulated project-02 run: 11 ready cards stuck in Planning
	 * while completions kept resetting the debounce clock).
	 */
	timerFired?: boolean;
}

/** Whether the terminal-retry sweep should run NOW: always for a pending redrive or the trailing timer, else once the debounce has elapsed. */
export function shouldRunTerminalRetrySweep(input: TerminalRetrySweepGateInput): boolean {
	if (input.redrivePending || input.timerFired) {
		return true;
	}
	return input.now - input.lastSweepAt >= input.debounceMs;
}

/**
 * States in which a task already has a live/recovering session and must not receive a dead-card restart.
 *
 * Delegates to the canonical {@link hasLiveTaskSession} rather than restating the state list: this predicate and the
 * durable lease heartbeat had SEPARATE copies of the same concept, they drifted (the heartbeat kept only `running`),
 * and the drift cancelled a healthy queued card in G6.8a v16. One definition, two call sites, no third drift.
 */
export function hasLiveSessionForTerminalRedrive(state: string | null | undefined): boolean {
	return hasLiveTaskSession(state as RuntimeTaskSessionState | null | undefined);
}

/**
 * The task whose terminal event triggered a sweep is owned exclusively by the bounded redrive path. If it remains in
 * Planning/In Progress, the ordinary ready-card sweep would otherwise rediscover it and bypass the one-shot guard on
 * every later terminal event (live run 20260721-134004: one promised restart became three replacement sessions).
 */
export function excludeTriggeringTerminalTask(
	taskIds: readonly string[],
	terminalTaskId: string | undefined,
): string[] {
	return terminalTaskId ? taskIds.filter((taskId) => taskId !== terminalTaskId) : [...taskIds];
}
