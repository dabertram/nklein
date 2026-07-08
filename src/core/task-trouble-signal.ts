import type { AgentStuckness } from "./agent-stuckness";
import type { RunLiveness } from "./run-attention-signals";

/**
 * §5.AA/§5.AG unified TROUBLE signal — the single first-class read the worker + runtime both watch, composing the
 * four proven guard cores into one verdict so callers don't re-OR them ad hoc:
 *   - agent stuckness (capability-limit vs transient, from the §5.AF outcome stream — {@link classifyAgentStuckness});
 *   - run liveness (active/idle/stalled/silent, from heartbeat+activity ages — {@link assessRunLiveness});
 *   - no-forward-progress streak (read/tool loops, no-diff rounds — {@link consecutiveNoProgressAttempts});
 *   - an uncleared response loop (fixture-flip / echo — {@link detectResponseLoop}).
 *
 * Precedence (strongest → weakest): a `silent` run (heartbeat gone) is the most urgent — the run may be dead;
 * then `hard_stuck` (a real capability ceiling → escalate); then a stalled/no-progress pattern (still recoverable but
 * needs a different approach → vary); else `none`. Pure + total over the injected signals; the caller effects the
 * response (the §5.AG escalation ladder / a skill-variation rung / surfacing to the operator).
 */

export type TaskTroubleKind = "none" | "silent" | "hard_stuck" | "no_progress";

export interface TaskTroubleSignals {
	stuckness: AgentStuckness;
	liveness: RunLiveness;
	/** Consecutive attempts with NO forward progress (0 = last attempt progressed). */
	consecutiveNoProgress: number;
	/** A response loop was detected AND the salvager could not clear it. */
	loopUncleared: boolean;
	/** No-progress streak at/above which a still-alive run counts as troubled (default 3). */
	noProgressThreshold?: number;
}

export interface TaskTroubleVerdict {
	trouble: boolean;
	kind: TaskTroubleKind;
	reason: string;
}

export function assessTaskTrouble(signals: TaskTroubleSignals): TaskTroubleVerdict {
	if (signals.liveness === "silent") {
		return {
			trouble: true,
			kind: "silent",
			reason: "The run's heartbeat is silent — it may be dead; check before waiting further.",
		};
	}
	if (signals.stuckness === "hard_stuck") {
		return {
			trouble: true,
			kind: "hard_stuck",
			reason:
				"Capability-limit reached: repeated non-recoverable failures across approaches — escalate (switch model / carry).",
		};
	}
	const threshold = signals.noProgressThreshold ?? 3;
	if (signals.loopUncleared || signals.consecutiveNoProgress >= threshold) {
		return {
			trouble: true,
			kind: "no_progress",
			reason: signals.loopUncleared
				? "An uncleared response loop is stalling the run — vary the approach (different prompt/skills)."
				: `No forward progress across ${signals.consecutiveNoProgress} attempts — vary the approach before grinding further.`,
		};
	}
	return { trouble: false, kind: "none", reason: "" };
}
