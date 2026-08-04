import { type AgentLedgerEvent, type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
import {
	applyWorkflowCommand,
	isTerminalWorkflowPhase,
	type WorkflowCommand,
	type WorkflowEffect,
	type WorkflowPhase,
} from "./workflow-kernel.js";

/**
 * F1.27 (§5.AF) — the workflow-kernel/DURABLE-QUEUE interface: the typed command/event seam CLI/tRPC/UI adapters
 * and schedulers share, landed over the existing pure kernel (`applyWorkflowCommand`) so workflow state
 * transitions live in ONE place instead of each adapter mutating stores directly.
 *
 *  - **dispatch** — adapters submit a {@link WorkflowCommand} for a task. The kernel reducer decides the
 *    transition; a command the current phase doesn't expect is HELD (applied: false, phase unchanged — safe for
 *    duplicates/out-of-order deliveries by construction), never an exception.
 *  - **durable** — every APPLIED command is appended to the §5.AF ledger as a `transition` event
 *    (`wf:<phase> → wf:<nextPhase>`, reason = the command kind), so a fresh process REPLAYS the log
 *    ({@link replayWorkflowPhaseFromLedger}) and resumes each task's phase exactly. Persist-before-notify.
 *  - **events** — subscribers (schedulers, agents, the board bridge) observe every applied transition with its
 *    kernel {@link WorkflowEffect}s, instead of polling stores.
 *
 * The queue holds only the in-memory phase mirror; all effects are the subscriber's/adapter's (the kernel names
 * WHAT must happen — `start_session`, `run_acceptance` — and the runtime's proven implementations do it). Adapter
 * call-site migration onto `dispatch` is the F1.27b+ follow-up; this lands the seam + replay + audit.
 */

const WORKFLOW_PHASE_PREFIX = "wf:";
const WORKFLOW_QUEUE_DECISION = "workflow_kernel";

export interface WorkflowQueueTransition {
	taskId: string;
	command: WorkflowCommand;
	fromPhase: WorkflowPhase;
	phase: WorkflowPhase;
	effects: WorkflowEffect[];
	at: number;
}

export type WorkflowDispatchOutcome =
	| { applied: true; transition: WorkflowQueueTransition }
	| { applied: false; phase: WorkflowPhase; reason: "held" | "terminal" | "persist_failed" };

export interface WorkflowCommandQueueOptions {
	workflowId: string;
	workspacePathHash: string;
	/** Durable append (the ledger store). Awaited BEFORE subscribers see the transition (persist-before-notify). */
	appendEvent?: (event: AgentTransitionEvent) => Promise<void>;
	/** Seed phases recovered at boot (from {@link replayWorkflowPhaseFromLedger}). */
	seedPhases?: ReadonlyMap<string, WorkflowPhase>;
	/** Seed redrive-window flags recovered at boot (from {@link replayWorkflowRedriveFromLedger}). */
	seedRedrives?: ReadonlyMap<string, boolean>;
	now?: () => number;
}

export interface WorkflowCommandQueue {
	dispatch(taskId: string, command: WorkflowCommand): Promise<WorkflowDispatchOutcome>;
	phaseOf(taskId: string): WorkflowPhase;
	/**
	 * P24.1 / decision 3 (2026-08-04): is this card inside a REDRIVE WINDOW — `reopened` fired from a live
	 * phase and `begin_implementation` has not yet re-arrived? During that window the LANE deliberately stays
	 * put (review / in_progress) while the phase replays the admission ladder, so the board shows a
	 * "restarting" badge instead of the card jumping lanes, and the phase↔lane shadow treats the disagreement
	 * as expected rather than as a bypassing writer.
	 */
	redriveInFlightOf(taskId: string): boolean;
	subscribe(listener: (transition: WorkflowQueueTransition) => void | Promise<void>): () => void;
}

/**
 * The redrive-window fold, PURE — one step per APPLIED transition. Derivable entirely from the command
 * sequence the queue already persists (`reason` = command kind), so boot replay recovers it exactly:
 *  - `reopened` from a non-idle phase OPENS the window (the card had visible work state to hold);
 *  - `begin_implementation` CLOSES it (the session is genuinely running again — lane and phase re-agree);
 *  - reaching a terminal phase closes it too (a redrive that ends in failed/cancelled is no longer restarting).
 * A fresh card's ordinary ladder never opens the window: its `reopened` (if any) fires from idle.
 */
export function nextRedriveInFlight(
	current: boolean,
	transition: { command: WorkflowCommand; fromPhase: WorkflowPhase; phase: WorkflowPhase },
): boolean {
	if (transition.command.kind === "reopened" && transition.fromPhase !== "idle") {
		return true;
	}
	if (transition.command.kind === "begin_implementation" || isTerminalWorkflowPhase(transition.phase)) {
		return false;
	}
	return current;
}

export function createWorkflowCommandQueue(options: WorkflowCommandQueueOptions): WorkflowCommandQueue {
	const phases = new Map<string, WorkflowPhase>(options.seedPhases ?? []);
	const redrives = new Map<string, boolean>(options.seedRedrives ?? []);
	const listeners = new Set<(transition: WorkflowQueueTransition) => void | Promise<void>>();
	const chainByTaskId = new Map<string, Promise<unknown>>();
	const now = options.now ?? (() => Date.now());

	const dispatchSerialized = async (taskId: string, command: WorkflowCommand): Promise<WorkflowDispatchOutcome> => {
		const fromPhase = phases.get(taskId) ?? "idle";
		const next = applyWorkflowCommand(fromPhase, command);
		if (next.phase === fromPhase && next.effects.length === 0) {
			// The kernel held the phase — a duplicate/out-of-order command (or any command at a terminal phase
			// except `reopened`, which the reducer honors); safe, silent, replay-proof.
			return {
				applied: false,
				phase: fromPhase,
				reason: isTerminalWorkflowPhase(fromPhase) ? "terminal" : "held",
			};
		}
		const transition: WorkflowQueueTransition = {
			taskId,
			command,
			fromPhase,
			phase: next.phase,
			effects: next.effects,
			at: now(),
		};
		// Persist BEFORE mutating the mirror or notifying — a crash after the append replays to the same state.
		// A FAILED append is a typed non-applied outcome (no state change, no event), never a thrown rejection.
		try {
			await options.appendEvent?.(
				buildTransitionEvent({
					workflowId: options.workflowId,
					taskId,
					workspacePathHash: options.workspacePathHash,
					from: `${WORKFLOW_PHASE_PREFIX}${fromPhase}`,
					to: `${WORKFLOW_PHASE_PREFIX}${next.phase}`,
					reason: command.kind,
					controllerDecision: WORKFLOW_QUEUE_DECISION,
					recordedAt: transition.at,
				}),
			);
		} catch {
			return { applied: false, phase: fromPhase, reason: "persist_failed" };
		}
		phases.set(taskId, next.phase);
		redrives.set(taskId, nextRedriveInFlight(redrives.get(taskId) ?? false, transition));
		// P24.1 step 3 REVERTED (2026-08-04 evening, full-nightly evidence): the awaited async subscriber —
		// the lane reconciler calling mutateWorkspaceState — DEADLOCKS when a dispatch happens inside a
		// workspace-state transaction: the reconciler waits on the lock the dispatching transaction holds.
		// The sixth inventory raised exactly this as H1 and refuted it on a thin run; the first 42-card
		// full-scale run through this code CONFIRMED it — 23 delivered cards hung silently between merge and
		// completion (zero error rows; the receipted-delivery recovery healed all but two before the drain's
		// stall wall). Subscribers are fire-and-forget again: the sampler race step 3 targeted is owned by the
		// validated two-strike debounce, and a rejecting subscriber still never breaks the command path.
		for (const listener of listeners) {
			try {
				const result = listener(transition) as unknown;
				if (result && typeof (result as Promise<unknown>).then === "function") {
					void (result as Promise<unknown>).catch(() => undefined);
				}
			} catch {
				// A subscriber must never break the command path.
			}
		}
		return { applied: true, transition };
	};

	return {
		dispatch(taskId, command) {
			// Per-task serialization: same-card commands apply strictly in arrival order; different cards run
			// concurrently. A rejected/failed predecessor never blocks the next command.
			const prior = chainByTaskId.get(taskId) ?? Promise.resolve();
			const next = prior.catch(() => undefined).then(() => dispatchSerialized(taskId, command));
			const tail = next
				.catch(() => undefined)
				.finally(() => {
					if (chainByTaskId.get(taskId) === tail) {
						chainByTaskId.delete(taskId);
					}
				});
			chainByTaskId.set(taskId, tail);
			return next;
		},
		phaseOf(taskId) {
			return phases.get(taskId) ?? "idle";
		},
		redriveInFlightOf(taskId) {
			return redrives.get(taskId) ?? false;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * Boot replay: fold a task's persisted workflow transitions (the queue's own `wf:* → wf:*` events, in recorded
 * order) back into its current phase. Non-queue transitions are ignored; a malformed phase string degrades to
 * skipping that event (never throws). The FOLD trusts the recorded `to` phase directly — the reducer already
 * validated it at dispatch time, and re-validating would break on legitimately-evolved reducer rules.
 */
export function replayWorkflowPhaseFromLedger(events: readonly AgentLedgerEvent[], taskId: string): WorkflowPhase {
	let phase: WorkflowPhase = "idle";
	for (const event of selectWorkflowQueueTransitions(events, taskId)) {
		phase = event.to.slice(WORKFLOW_PHASE_PREFIX.length) as WorkflowPhase;
	}
	return phase;
}

/**
 * Boot replay for the redrive-window flag: fold {@link nextRedriveInFlight} over the same persisted
 * transitions the phase replay reads — `reason` carries the command kind and `from`/`to` carry the phases,
 * so the fold recovers the exact in-memory flag a live queue would hold. Same trust rule as the phase
 * replay: recorded values are not re-validated.
 */
export function replayWorkflowRedriveFromLedger(events: readonly AgentLedgerEvent[], taskId: string): boolean {
	let redriveInFlight = false;
	for (const event of selectWorkflowQueueTransitions(events, taskId)) {
		redriveInFlight = nextRedriveInFlight(redriveInFlight, {
			command: { kind: event.reason } as WorkflowCommand,
			// `from` is nullable on the generic transition shape; the queue always records it, and a missing one
			// degrades to "idle" — which merely declines to open the window (fail-closed for the badge).
			fromPhase: (event.from ?? `${WORKFLOW_PHASE_PREFIX}idle`).slice(WORKFLOW_PHASE_PREFIX.length) as WorkflowPhase,
			phase: event.to.slice(WORKFLOW_PHASE_PREFIX.length) as WorkflowPhase,
		});
	}
	return redriveInFlight;
}

/** The queue's own persisted transitions for one task, in recorded order (shared by both boot replays). */
function selectWorkflowQueueTransitions(events: readonly AgentLedgerEvent[], taskId: string): AgentTransitionEvent[] {
	return events
		.filter(
			(event): event is AgentTransitionEvent =>
				event.kind === "transition" &&
				event.taskId === taskId &&
				event.controllerDecision === WORKFLOW_QUEUE_DECISION &&
				event.to.startsWith(WORKFLOW_PHASE_PREFIX),
		)
		.sort((left, right) => left.recordedAt - right.recordedAt);
}
