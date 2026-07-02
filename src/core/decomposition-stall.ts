/**
 * Decomposition turn-stall recovery decision core (todo §5.B/§5.G follow-up).
 *
 * An explicit decomposition turn is supposed to end by calling `decompose_project`. Small/mid models stall in
 * two distinct ways that both leave the planning card sitting in Review having never decomposed:
 *
 *  1. Reasoning-only / chat-only: the turn ends with no tool call at all — the model "thought" the answer or
 *     wrote a plan as prose. Recovery: re-prompt to emit the `decompose_project` tool call now.
 *
 *  2. Mid read-workflow: the turn ends right after a `read_large_file` chunk because the model narrated the
 *     next `read_large_file` continuation as text (e.g. a `<tool_call>{...}</tool_call>` block) in its
 *     reasoning channel instead of emitting a real tool call. No tool runs, the turn ends mid-document, and the
 *     large-file workflow's `beforeModel` continuation guidance never re-fires (the model is never re-invoked).
 *     Recovery: re-prompt to make a *real* tool call and continue reading through EOF, then decompose — NOT to
 *     decompose from a half-read spec.
 *
 * The clean-stop summary (`agent_end`) preserves the last tool name, so "a tool ran this turn" alone cannot
 * distinguish genuine progress from a `read_large_file` mid-workflow stall. Keeping this pure makes "given the
 * turn-end facts, do we re-prompt and how" unit-testable without a live runtime; the session service consults it
 * and performs the side effects (self-observation + re-prompt).
 */

/**
 * Stateful read workflows whose presence as the last tool of a stalled turn means the model is stuck
 * mid-read, not done. Mirrors `READ_LARGE_FILE_TOOL_NAME` in `nklein-large-file-workflow`; kept local so this
 * decision core stays in the lower `core` layer with no dependency on the SDK boundary. Compared lowercased.
 */
const STATEFUL_READ_WORKFLOW_TOOLS: ReadonlySet<string> = new Set(["read_large_file"]);

export type DecompositionStallAction = "none" | "continue_read" | "decompose";

export interface DecompositionStallInputs {
	/** The task is an explicit decomposition turn (a planning card driving `decompose_project`). */
	isDecompositionTask: boolean;
	/** Runtime summary state at the stop. */
	state: string;
	/** Why the turn entered review. Only a clean model-stop (`"hook"`) is re-promptable here. */
	reviewReason: string | null;
	/** The turn already applied a decomposition (`decompose_project` succeeded). */
	decomposed: boolean;
	/** Name of the most recent tool this turn (preserved across `agent_end`), if any. */
	lastToolName: string | null;
	/** The final assistant message ended on a clarifying question to the user. */
	endedOnQuestion: boolean;
	/** Re-prompt nudges already spent for this task. */
	nudgeCount: number;
	/** Maximum re-prompt nudges allowed for this task. */
	nudgeLimit: number;
}

export interface DecompositionStallDecision {
	action: DecompositionStallAction;
	/** Short human-readable explanation, surfaced in self-observation telemetry. */
	reason: string;
}

/** True when `toolName` (any casing) is a stateful read workflow that must be continued, not abandoned. */
export function isStatefulReadWorkflowTool(toolName: string | null | undefined): boolean {
	return STATEFUL_READ_WORKFLOW_TOOLS.has((toolName ?? "").trim().toLowerCase());
}

/**
 * Decide whether — and how — to re-prompt a decomposition turn that stopped without decomposing. Pure: all
 * inputs are turn-end facts; the caller owns the nudge budget mutation and the actual re-prompt.
 */
export function decideDecompositionStallRecovery(input: DecompositionStallInputs): DecompositionStallDecision {
	if (!input.isDecompositionTask) {
		return { action: "none", reason: "Not an explicit decomposition turn." };
	}
	// Only a clean model-stop end (awaiting_review/"hook") is re-promptable: the session is still live and can be
	// re-prompted with sendTaskSessionInput. An aborted/torn-down (interrupted) or errored turn is left for restart.
	if (input.state !== "awaiting_review" || input.reviewReason !== "hook") {
		return { action: "none", reason: "Not a clean, still-live model-stop end." };
	}
	if (input.decomposed) {
		return { action: "none", reason: "Decomposition already applied this turn." };
	}
	// A turn that ended on a genuine clarifying question to the user must not be overridden.
	if (input.endedOnQuestion) {
		return { action: "none", reason: "Turn ended on a clarifying question to the user." };
	}
	if (input.nudgeCount >= input.nudgeLimit) {
		return { action: "none", reason: "Decomposition re-prompt budget exhausted." };
	}
	// A mid read-workflow stall takes precedence over the "a tool ran this turn" exemption: the model must finish
	// reading (or stopped after narrating the next read as text) before it can decompose.
	if (isStatefulReadWorkflowTool(input.lastToolName)) {
		return {
			action: "continue_read",
			reason: "Stalled mid read_large_file workflow (likely a tool call narrated as text); continue the read.",
		};
	}
	// #30 (run31 live stall): there is NO "a tool ran this turn" exemption at turn-end. An ended turn never
	// continues on its own — nothing re-invokes the model — so a clean stop without decompose_project strands
	// the planning card in Review regardless of what bookkeeping ran mid-turn. The live failure: the architect's
	// update_focus_chain call was REJECTED on validation (a rejected call still records the tool name), it then
	// emitted the complete decomposition as final TEXT and stopped; the old "a non-read tool ran → genuine
	// progress" exemption swallowed the re-prompt and froze the whole board.
	const lastTool = (input.lastToolName ?? "").trim();
	return {
		action: "decompose",
		reason:
			lastTool.length > 0
				? `Turn ended without decompose_project (last tool this turn: ${lastTool}); re-prompt to emit it.`
				: "Turn ended with no tool call; re-prompt to emit decompose_project.",
	};
}
