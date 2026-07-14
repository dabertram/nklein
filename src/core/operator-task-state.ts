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

export type OperatorColumnId = "backlog" | "planning" | "ready" | "in_progress" | "review" | "completed" | "trash";

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
	/**
	 * F2.17: a delivery is held because the result touched a PROTECTED PATH outside the card's declared write
	 * boundary (§5.L F1.9b/F1.21). Distinct from `deliveryGateHeld` — the remediation is "allow/deny this
	 * protected write", not "approve the delivery" — so it is its own inbox source.
	 */
	protectedPathHeld: boolean;
	/** A clarifying question is pending the operator's answer (§5.S). */
	clarifyingQuestionPending: boolean;
	/** The run is parked / making no progress / was loop-salvaged (§5.AA). */
	noProgressOrLoop: boolean;
	/** The run is at/over the warn fraction of its tightest budget/iteration/timeout ceiling (§5.AG run-attention). */
	approachingBudgetCeiling: boolean;
	/** The card was PARKED by the review ladder or ESCALATED to the user — it needs an operator decision (§5.AB/§5.AW). */
	escalatedToOperator: boolean;
}

export function classifyOperatorTaskState(signals: OperatorTaskSignals): OperatorTaskState {
	// RISKY — needs the operator's attention NOW: an unsafe action to ack, a held delivery, a card parked/escalated for
	// the operator, or the sandbox unavailable.
	if (
		signals.awaitingHostActionAck ||
		signals.deliveryGateHeld ||
		signals.protectedPathHeld ||
		signals.escalatedToOperator ||
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
	// STUCK — blocked/parked but not urgent: dead/parked run, paused, lost heartbeat, no-progress/loop, nearing a budget
	// ceiling (attention before the hard stop), a pending clarification, or a non-urgent start blocker.
	if (
		signals.sessionState === "failed" ||
		signals.sessionState === "interrupted" ||
		signals.paused ||
		signals.heartbeatLost ||
		signals.noProgressOrLoop ||
		signals.approachingBudgetCeiling ||
		signals.clarifyingQuestionPending ||
		signals.blockedKind !== null
	) {
		return "stuck";
	}
	// HEALTHY — running/queued/idle and otherwise fine: progressing.
	return "healthy";
}

export interface OperatorInboxTask {
	taskId: string;
	signals: OperatorTaskSignals;
}

/**
 * The §5.AG risk + approval inbox — the things that BLOCK autonomy, grouped by what the operator must do, so unblocking
 * is one place instead of a board hunt. Each list holds the task ids needing that action; `total` is the distinct count
 * of tasks needing ANY action (a task can appear in more than one list).
 */
export interface OperatorInbox {
	/** Unsafe/host actions awaiting an explicit acknowledgement (§5.M G3b). */
	unsafeActionAcks: string[];
	/** Clarifying questions awaiting an answer (§5.S). */
	clarifyingQuestions: string[];
	/** Deliveries (commit/PR) held pending the operator (§5.L gate). */
	heldDeliveries: string[];
	/** F2.17: deliveries held because the result touched a protected path outside its write boundary (§5.L F1.9b). */
	protectedWrites: string[];
	/** Cards blocked on setup before they can run (needs-decomposition / local-model-required / sandbox-unavailable). */
	blockedOnSetup: string[];
	/** Cards parked by the review ladder or escalated to the user — needing an operator decision (§5.AB/§5.AW). */
	escalatedToOperator: string[];
	/** Distinct tasks needing ANY operator action. */
	total: number;
}

export function collectOperatorInbox(tasks: readonly OperatorInboxTask[]): OperatorInbox {
	const unsafeActionAcks: string[] = [];
	const clarifyingQuestions: string[] = [];
	const heldDeliveries: string[] = [];
	const protectedWrites: string[] = [];
	const blockedOnSetup: string[] = [];
	const escalatedToOperator: string[] = [];
	const needingAction = new Set<string>();
	for (const task of tasks) {
		if (task.signals.awaitingHostActionAck) {
			unsafeActionAcks.push(task.taskId);
			needingAction.add(task.taskId);
		}
		if (task.signals.clarifyingQuestionPending) {
			clarifyingQuestions.push(task.taskId);
			needingAction.add(task.taskId);
		}
		if (task.signals.deliveryGateHeld) {
			heldDeliveries.push(task.taskId);
			needingAction.add(task.taskId);
		}
		if (task.signals.protectedPathHeld) {
			protectedWrites.push(task.taskId);
			needingAction.add(task.taskId);
		}
		if (task.signals.blockedKind !== null) {
			blockedOnSetup.push(task.taskId);
			needingAction.add(task.taskId);
		}
		if (task.signals.escalatedToOperator) {
			escalatedToOperator.push(task.taskId);
			needingAction.add(task.taskId);
		}
	}
	return {
		unsafeActionAcks,
		clarifyingQuestions,
		heldDeliveries,
		protectedWrites,
		blockedOnSetup,
		escalatedToOperator,
		total: needingAction.size,
	};
}

/**
 * §5.AG board-level rollup — the at-a-glance board-health summary the board header / `nklein` status surface renders:
 * the count + task-id list per operator state, plus the risk/approval inbox. Composes `classifyOperatorTaskState`
 * (per task) and `collectOperatorInbox` (board) so the header is one tested query, not a re-implementation.
 */
export interface OperatorBoardSummary {
	counts: Record<OperatorTaskState, number>;
	byState: Record<OperatorTaskState, string[]>;
	inbox: OperatorInbox;
	total: number;
}

export function buildOperatorBoardSummary(tasks: readonly OperatorInboxTask[]): OperatorBoardSummary {
	const counts: Record<OperatorTaskState, number> = { healthy: 0, stuck: 0, risky: 0, done: 0 };
	const byState: Record<OperatorTaskState, string[]> = { healthy: [], stuck: [], risky: [], done: [] };
	for (const task of tasks) {
		const state = classifyOperatorTaskState(task.signals);
		counts[state] += 1;
		byState[state].push(task.taskId);
	}
	return { counts, byState, inbox: collectOperatorInbox(tasks), total: tasks.length };
}

/**
 * The minimal session-summary shape the signal map reads. Structurally a subset of the runtime's
 * `RuntimeTaskSessionSummary` (same `state` enum, optional `paused`/`heartbeatStatus`), so a caller can pass a full
 * summary directly — kept inline so this module stays dependency-free (todo §5.AG: the map is the seam, not a contract
 * import).
 */
export interface OperatorSessionSummaryView {
	state: OperatorSessionState;
	paused?: boolean | null;
	heartbeatStatus?: "healthy" | "stale" | "lost" | null;
	/** F2.17b: the session's review reason — `"protected_write"` marks a delivery held on a protected/out-of-bounds
	 *  path (the F1.9b boundary gate), which the mapping surfaces as `protectedPathHeld`. */
	reviewReason?: string | null;
}

/**
 * The signals that DON'T come from the session summary — they originate in other subsystems (§5.L delivery gate, §5.M
 * G3b risk ack, §5.S clarify, §5.A start blockers, §5.AA loop salvage). The caller supplies whatever it has; each
 * defaults to the safe "not blocking" value so a summary-only call still classifies healthy/stuck/done correctly
 * (it just can't surface `risky` until these are wired in).
 */
export interface OperatorSignalOverrides {
	blockedKind?: OperatorTaskSignals["blockedKind"];
	awaitingHostActionAck?: boolean;
	deliveryGateHeld?: boolean;
	protectedPathHeld?: boolean;
	clarifyingQuestionPending?: boolean;
	noProgressOrLoop?: boolean;
	approachingBudgetCeiling?: boolean;
	escalatedToOperator?: boolean;
}

/**
 * §5.AG signal map — the bridge from what !Klein already emits (a session summary + the card's column) onto the
 * normalized `OperatorTaskSignals` the classifier + inbox read. Session state and column id pass through (identical
 * enums); `paused`/`heartbeatLost` are derived from the summary; everything else comes from the caller's overrides.
 */
export function mapSessionSummaryToOperatorSignals(
	summary: OperatorSessionSummaryView,
	columnId: OperatorColumnId,
	overrides: OperatorSignalOverrides = {},
): OperatorTaskSignals {
	return {
		sessionState: summary.state,
		columnId,
		paused: summary.paused ?? false,
		heartbeatLost: summary.heartbeatStatus === "lost",
		blockedKind: overrides.blockedKind ?? null,
		awaitingHostActionAck: overrides.awaitingHostActionAck ?? false,
		deliveryGateHeld: overrides.deliveryGateHeld ?? false,
		// F2.17b: a `protected_write` review reason IS a protected-path hold (the boundary gate stamped it on stop);
		// an explicit override still wins for callers that compute it another way.
		protectedPathHeld: overrides.protectedPathHeld ?? summary.reviewReason === "protected_write",
		clarifyingQuestionPending: overrides.clarifyingQuestionPending ?? false,
		noProgressOrLoop: overrides.noProgressOrLoop ?? false,
		approachingBudgetCeiling: overrides.approachingBudgetCeiling ?? false,
		escalatedToOperator: overrides.escalatedToOperator ?? false,
	};
}
