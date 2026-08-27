/**
 * Refinement turn-stall recovery decision core (sibling of `decomposition-stall.ts`).
 *
 * A `--no-plan` work card starts as a REFINABLE card in the Planning lane (`isRefinableWorkCard = !startInPlanMode`):
 * it does a brief refinement pass against the current project state, then calls `begin_implementation` — the
 * promotion tool — to advance to In Progress and build. Small/mid models stall by exploring/wandering the workspace
 * for turns and never calling `begin_implementation`, so the card sits in Planning until the run cap and produces NO
 * terminal outcome. Live-observed: qwen3.8-27b on `cli-parser-medium --no-plan` (`.real-runs/20260827-015045`) made
 * 24 tool calls, wandered to `ls /repos` / `ls /`, and never promoted. The decomposition-stall nudger covers only
 * the decompose→`decompose_project` path, and the no-diff watchdog targets In Progress work — nothing catches a
 * refinement card that never promotes. (This matters beyond one card: an un-promoted card yields no terminal
 * outcome, and the evidence-gated mechanisms only cross their floors on cards that reach one.)
 *
 * Pure: given the turn-end facts, decide whether to re-prompt "call `begin_implementation`". The caller owns the
 * nudge-budget mutation and the re-prompt side effect. Kept in `core` with no SDK dependency, exactly like the
 * decomposition-stall core, so the gating is unit-testable without a live runtime.
 */

export type RefinementStallAction = "none" | "begin_implementation";

export interface RefinementStallInputs {
	/** The task is a refinable work card (started `!startInPlanMode`; not a home-agent or plan-mode card). */
	isRefinableWorkCard: boolean;
	/** The card already promoted to In Progress (a `begin_implementation` / explicit-decomposition tool fired). */
	begunImplementation: boolean;
	/** Runtime summary state at the stop. A clean refinement stop arrives as `awaiting_review`. */
	state: string;
	/** Why the turn entered review; an operator park (`"attention"`) is terminal and must not be re-nudged. */
	reviewReason: string | null;
	/** The final assistant message ended on a clarifying question — it is waiting on the operator, not stalled. */
	endedOnQuestion: boolean;
	/** Re-prompt nudges already spent for this task. */
	nudgeCount: number;
	/** Maximum re-prompt nudges allowed for this task. */
	nudgeLimit: number;
}

export interface RefinementStallDecision {
	action: RefinementStallAction;
	/** Short human-readable explanation, surfaced in self-observation telemetry. */
	reason: string;
}

/**
 * Decide whether to re-prompt a refinement turn that stopped without promoting to In Progress. Pure: all inputs
 * are turn-end facts; the caller owns the nudge budget + the actual re-prompt. Fires at most `nudgeLimit` times.
 */
export function decideRefinementStallRecovery(input: RefinementStallInputs): RefinementStallDecision {
	if (!input.isRefinableWorkCard) {
		return { action: "none", reason: "not a refinable work card" };
	}
	if (input.begunImplementation) {
		return { action: "none", reason: "already promoted to In Progress" };
	}
	if (input.endedOnQuestion) {
		return { action: "none", reason: "ended on a clarifying question — waiting on the operator, not stalled" };
	}
	if (input.nudgeCount >= input.nudgeLimit) {
		return { action: "none", reason: "refinement nudge budget spent" };
	}
	// Only a clean turn-end in a reviewable/held state is a steerable stall. A failed or interrupted card, or one
	// already parked for the operator (`reviewReason: "attention"`), is terminal and must not be re-driven here.
	if (input.state === "failed" || input.state === "interrupted" || input.reviewReason === "attention") {
		return { action: "none", reason: "card is failed/interrupted/parked — not a steerable refinement stall" };
	}
	return {
		action: "begin_implementation",
		reason: "refinement turn ended without begin_implementation — re-prompt to promote and start building",
	};
}
