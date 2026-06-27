/**
 * §5.AG operator board-health classifier — the at-a-glance "healthy / stuck / risky / done" state for a task, derived
 * from signals !Klein ALREADY emits. Pure + deterministic over a normalized signal set (the UI/runtime maps a session
 * summary + board card + gate state onto it), so the daily-operator status story is one tested rule, not scattered ad-hoc
 * checks. The board-header rollup + per-lane badge read this; richer surfaces (§5.AB "why this model", §5.AF "what was
 * tried") hang off the same state.
 *
 * Priority order (most operator-urgent first): RISKY (something unsafe/blocked needs the operator NOW) → DONE (clean
 * terminal: merged or awaiting review) → STUCK (blocked/parked but not urgent) → HEALTHY (actively progressing).
 */

export type OperatorTaskState = "healthy" | "stuck" | "risky" | "done";

export type OperatorSessionState =
	| "idle"
	| "queued"
	| "running"
	| "paused"
	| "awaiting_review"
	| "failed"
	| "interrupted";

export type OperatorColumnId = "backlog" | "planning" | "in_progress" | "review" | "completed" | "trash";

export interface OperatorTaskSignals {
	sessionState: OperatorSessionState;
	columnId: OperatorColumnId;
	/** The session is paused (user-paused or the state machine paused it). */
	paused: boolean;
	/** The agent heartbeat was lost (§5.A) — the run may be dead. */
	heartbeatLost: boolean;
	/** A start-blocking reason on the card (needs-decomposition / local-model-required / sandbox-unavailable). */
	blockedKind: "needs_decomposition" | "local_model_required" | "agent_sandbox_unavailable" | null;
	/** An unsafe/host action is awaiting the operator's explicit acknowledgement (§5.M G3b). */
	awaitingHostActionAck: boolean;
	/** A delivery (commit/PR) is held pending the operator (§5.L gate). */
	deliveryGateHeld: boolean;
	/** A clarifying question is pending the operator's answer (§5.S). */
	clarifyingQuestionPending: boolean;
	/** The run is parked / making no progress / was loop-salvaged (§5.AA). */
	noProgressOrLoop: boolean;
}

export function classifyOperatorTaskState(signals: OperatorTaskSignals): OperatorTaskState {
	// RISKY — needs the operator's attention NOW: an unsafe action to ack, a held delivery, or the sandbox unavailable.
	if (
		signals.awaitingHostActionAck ||
		signals.deliveryGateHeld ||
		signals.blockedKind === "agent_sandbox_unavailable"
	) {
		return "risky";
	}
	// DONE — clean terminal: merged (completed) or awaiting human review (the review column / awaiting_review state).
	if (
		signals.columnId === "completed" ||
		signals.columnId === "review" ||
		signals.sessionState === "awaiting_review"
	) {
		return "done";
	}
	// STUCK — blocked/parked but not urgent: dead/parked run, paused, lost heartbeat, no-progress/loop, a pending
	// clarification, or a non-urgent start blocker (needs-decomposition / local-model-required).
	if (
		signals.sessionState === "failed" ||
		signals.sessionState === "interrupted" ||
		signals.paused ||
		signals.heartbeatLost ||
		signals.noProgressOrLoop ||
		signals.clarifyingQuestionPending ||
		signals.blockedKind !== null
	) {
		return "stuck";
	}
	// HEALTHY — running/queued/idle and otherwise fine: progressing.
	return "healthy";
}
