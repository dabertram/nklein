/**
 * §5.AB wait-vs-attempt consumption — the pure gate behind the `hardTaskRoutingMode` setting. Under
 * `wait_for_best`, a HARD card whose qualified models are ALL busy (the free-first selector's `busyFallback`
 * signal) should WAIT for the best model to free up instead of starting on a busy/lesser one; under the default
 * `attempt_with_available` nothing changes (today's behavior). Pure over the injected signals — the start path
 * effects the wait via its existing queued/endpoint-busy defer protocol.
 */

/** Start-guard difficulty (0–100) at/above which a card counts as HARD for the wait policy: base 25 + a meaty
 *  prompt (+≤35) alone stays under it; hard-task text (+12) or a plan card (+10) on a substantial prompt crosses it. */
export const HARD_TASK_WAIT_DIFFICULTY_THRESHOLD = 55;

export interface HardTaskWaitInput {
	mode: "wait_for_best" | "attempt_with_available";
	/** The start-guard difficulty score (0–100). */
	difficulty: number;
	/** The free-first selector fell back to a BUSY model because no qualified model was free. */
	busyFallback: boolean;
	threshold?: number;
}

export function shouldWaitForBestModel(input: HardTaskWaitInput): boolean {
	return (
		input.mode === "wait_for_best" &&
		input.difficulty >= (input.threshold ?? HARD_TASK_WAIT_DIFFICULTY_THRESHOLD) &&
		input.busyFallback
	);
}
