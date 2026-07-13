// §5.AF/§5.AK workflow kernel (seed) — the PURE task-lifecycle state machine the future durable scheduler builds on.
//
// A total reducer over `(phase, command) → { phase, effects }`. It is the orthogonal *scheduler* view of a task: finer
// grained than the board column (it distinguishes WHY a task is queued — board capacity vs endpoint vs sandbox — and
// the acceptance/review/delivery sub-states a single column can't express), so a durable scheduler can persist a phase
// + a command log and resume/replay exactly where it left off. **No behavior change and NOT yet wired:** the board
// mutation helpers (`task-board-mutations`, §5.B lane reconcile) remain the single source of truth for board/lane
// moves; this kernel is a seam for the §5.AF durable scheduler to grow into. Pure + total: every command in every phase
// has a defined result (unhandled commands are a no-op that holds the phase), so it never throws on an unexpected event.

export type WorkflowPhase =
	| "idle"
	| "queued_for_board_capacity"
	| "queued_for_endpoint"
	| "queued_for_sandbox"
	| "planning"
	| "implementing"
	| "awaiting_acceptance"
	| "awaiting_review"
	| "reviewing"
	| "ready_for_delivery"
	| "delivering"
	| "completed"
	| "failed"
	| "cancelled";

export type WorkflowCommand =
	/** The user/board started the card — admit it into the queue ladder. */
	| { kind: "start_requested" }
	| { kind: "board_capacity_granted" }
	| { kind: "endpoint_granted" }
	| { kind: "sandbox_granted" }
	/** §5.B: the refinement/planning lane promotes the card to active implementation. */
	| { kind: "begin_implementation" }
	/** The agent finished a turn and the acceptance gate should run. */
	| { kind: "implementation_finished" }
	| { kind: "acceptance_passed" }
	| { kind: "acceptance_failed" }
	| { kind: "review_started" }
	| { kind: "review_passed" }
	| { kind: "review_changes_requested" }
	| { kind: "delivery_requested" }
	| { kind: "delivered" }
	/** Honored from any active phase. */
	| { kind: "failed" }
	| { kind: "cancel_requested" }
	/** F1.27b: re-admit a dead/parked card (failed/cancelled/any active phase → idle). `completed` never reopens. */
	| { kind: "reopened" };

export type WorkflowEffect =
	| { kind: "enqueue"; queue: "board_capacity" | "endpoint" | "sandbox" }
	| { kind: "start_session" }
	| { kind: "run_acceptance" }
	| { kind: "request_review" }
	| { kind: "capture_result_branch" }
	| { kind: "mark_done" }
	| { kind: "release_resources" };

export interface WorkflowTransition {
	phase: WorkflowPhase;
	effects: WorkflowEffect[];
}

const TERMINAL_PHASES: ReadonlySet<WorkflowPhase> = new Set(["completed", "failed", "cancelled"]);

/** Whether the phase is terminal (no further commands transition it). */
export function isTerminalWorkflowPhase(phase: WorkflowPhase): boolean {
	return TERMINAL_PHASES.has(phase);
}

/**
 * Apply one command to the current phase. Pure + total. `cancel_requested` and `failed` are honored from any
 * non-terminal phase (releasing resources); otherwise each phase advances only on its expected command, and any other
 * command is a no-op that holds the phase (so out-of-order/duplicate events are safe to replay).
 */
export function applyWorkflowCommand(phase: WorkflowPhase, command: WorkflowCommand): WorkflowTransition {
	const hold: WorkflowTransition = { phase, effects: [] };

	// F1.27b `reopened`: the ONLY command honored at a terminal phase — a failed/cancelled card the recovery
	// rungs (or the operator) restart goes back to idle so the admission ladder replays cleanly. Delivered work
	// never reopens; reopening an already-idle card is a natural hold (idle → idle, no effects).
	if (command.kind === "reopened") {
		return phase === "completed" ? hold : { phase: "idle", effects: [] };
	}

	if (isTerminalWorkflowPhase(phase)) {
		return hold;
	}

	if (command.kind === "cancel_requested") {
		return { phase: "cancelled", effects: [{ kind: "release_resources" }] };
	}
	if (command.kind === "failed") {
		return { phase: "failed", effects: [{ kind: "release_resources" }] };
	}

	switch (phase) {
		case "idle":
			return command.kind === "start_requested"
				? { phase: "queued_for_board_capacity", effects: [{ kind: "enqueue", queue: "board_capacity" }] }
				: hold;
		case "queued_for_board_capacity":
			return command.kind === "board_capacity_granted"
				? { phase: "queued_for_endpoint", effects: [{ kind: "enqueue", queue: "endpoint" }] }
				: hold;
		case "queued_for_endpoint":
			return command.kind === "endpoint_granted"
				? { phase: "queued_for_sandbox", effects: [{ kind: "enqueue", queue: "sandbox" }] }
				: hold;
		case "queued_for_sandbox":
			return command.kind === "sandbox_granted" ? { phase: "planning", effects: [{ kind: "start_session" }] } : hold;
		case "planning":
			return command.kind === "begin_implementation" ? { phase: "implementing", effects: [] } : hold;
		case "implementing":
			return command.kind === "implementation_finished"
				? { phase: "awaiting_acceptance", effects: [{ kind: "run_acceptance" }] }
				: hold;
		case "awaiting_acceptance":
			if (command.kind === "acceptance_passed") {
				return { phase: "awaiting_review", effects: [{ kind: "request_review" }] };
			}
			// A failed acceptance bounces back to implementation for another attempt.
			return command.kind === "acceptance_failed" ? { phase: "implementing", effects: [] } : hold;
		case "awaiting_review":
			return command.kind === "review_started" ? { phase: "reviewing", effects: [] } : hold;
		case "reviewing":
			if (command.kind === "review_passed") {
				return { phase: "ready_for_delivery", effects: [{ kind: "capture_result_branch" }] };
			}
			// Requested changes bounce back to implementation.
			return command.kind === "review_changes_requested" ? { phase: "implementing", effects: [] } : hold;
		case "ready_for_delivery":
			return command.kind === "delivery_requested" ? { phase: "delivering", effects: [] } : hold;
		case "delivering":
			return command.kind === "delivered" ? { phase: "completed", effects: [{ kind: "mark_done" }] } : hold;
		default:
			return hold;
	}
}
