/**
 * F12.21 instruction re-anchoring against context rot — PURE core.
 *
 * 7–8B models lose mid-context information (>30% accuracy drop) and long cards suffer instruction fade-out: the
 * acceptance criteria that opened the prompt stop steering behavior a hundred turns later. This core decides WHEN a
 * fresh anchor is worth injecting (event-driven, never chatty) and renders WHAT to inject — a compact reminder of
 * the card's acceptance criteria + the current plan step, shaped as a TAIL message so it lands in the recency zone
 * without touching the cache-stable prefix (F4.40). Delivery rides the F12.56 steer channel at the turn boundary.
 */

export interface ReanchorSignals {
	/** Turns since the last anchor (start or previous re-anchor). */
	readonly turnsSinceAnchor: number;
	/** A tool call just errored (fresh confusion — the moment guidance pays most). */
	readonly toolErrorJustHappened: boolean;
	/** The loop/thrash guard flagged this session (already circling — re-ground before nudging). */
	readonly loopDetected: boolean;
}

export interface ReanchorDecision {
	readonly fire: boolean;
	readonly trigger: "loop_detected" | "tool_error" | "turn_interval" | null;
	readonly reason: string;
}

/** Default: re-anchor every 12 turns even when nothing is visibly wrong — fade-out is silent by nature. */
export const REANCHOR_TURN_INTERVAL = 12;

/** Event-driven firing: loop > tool-error > the periodic interval. Quiet otherwise — reminders that spam get ignored. */
export function decideReanchor(signals: ReanchorSignals, options: { turnInterval?: number } = {}): ReanchorDecision {
	const interval = options.turnInterval ?? REANCHOR_TURN_INTERVAL;
	if (signals.loopDetected) {
		return { fire: true, trigger: "loop_detected", reason: "the session is circling — re-ground it on the goal." };
	}
	if (signals.toolErrorJustHappened && signals.turnsSinceAnchor >= 3) {
		return { fire: true, trigger: "tool_error", reason: "a tool just failed and the anchor is stale — re-ground." };
	}
	if (signals.turnsSinceAnchor >= interval) {
		return {
			fire: true,
			trigger: "turn_interval",
			reason: `${signals.turnsSinceAnchor} turns since the last anchor — silent fade-out is due.`,
		};
	}
	return { fire: false, trigger: null, reason: "anchor still fresh." };
}

/** Render the tail reminder. Compact by design: the criteria + the current step, nothing else. */
export function buildReanchorReminder(input: {
	acceptanceCriteria: string | null;
	currentFocusStep: string | null;
	trigger: "loop_detected" | "tool_error" | "turn_interval";
}): string {
	const lines: string[] = ["[!Klein re-anchor — the goal has not changed; re-ground on it]"];
	if (input.currentFocusStep?.trim()) {
		lines.push(`Current step: ${input.currentFocusStep.trim()}`);
	}
	if (input.acceptanceCriteria?.trim()) {
		lines.push(`Done means: ${input.acceptanceCriteria.trim()}`);
	}
	if (input.trigger === "loop_detected") {
		lines.push("You appear to be repeating yourself — take the SMALLEST next action toward the step above.");
	} else if (input.trigger === "tool_error") {
		lines.push("After that tool error, continue toward the step above — fix the immediate cause, don't restart.");
	}
	return lines.join("\n");
}
