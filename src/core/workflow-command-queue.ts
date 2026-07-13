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
	now?: () => number;
}

export interface WorkflowCommandQueue {
	dispatch(taskId: string, command: WorkflowCommand): Promise<WorkflowDispatchOutcome>;
	phaseOf(taskId: string): WorkflowPhase;
	subscribe(listener: (transition: WorkflowQueueTransition) => void): () => void;
}

export function createWorkflowCommandQueue(options: WorkflowCommandQueueOptions): WorkflowCommandQueue {
	const phases = new Map<string, WorkflowPhase>(options.seedPhases ?? []);
	const listeners = new Set<(transition: WorkflowQueueTransition) => void>();
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
		for (const listener of listeners) {
			try {
				listener(transition);
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
	const transitions = events
		.filter(
			(event): event is AgentTransitionEvent =>
				event.kind === "transition" &&
				event.taskId === taskId &&
				event.controllerDecision === WORKFLOW_QUEUE_DECISION &&
				event.to.startsWith(WORKFLOW_PHASE_PREFIX),
		)
		.sort((left, right) => left.recordedAt - right.recordedAt);
	for (const event of transitions) {
		phase = event.to.slice(WORKFLOW_PHASE_PREFIX.length) as WorkflowPhase;
	}
	return phase;
}
