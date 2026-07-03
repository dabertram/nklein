/**
 * The C3 durable-scheduler LIVE-WIRING composition layer (todo §5.AF) — the single seam that ties the built-but-dark
 * durable-run substrate to the runtime, behind the `NKLEIN_DURABLE_SCHEDULER` flag (default OFF = byte-identical).
 *
 * The substrate is complete and unit-tested in isolation: the pure {@link DurableRunController} (lease/tick/reclaim
 * brain), {@link createLedgerDurableRunPorts} (persist-before-dispatch ledger bridge), {@link DurableRunRegistry}
 * (per-workspace lifecycle + summary→reaction routing), and {@link buildDurableJobGraph} (board DAG → jobs). This module
 * assembles them into a runtime-facing API — `ensureRun` (build/RESUME a run from the board + persisted ledger, then
 * lease the first ready cards), `observeSummary` (route a task-session state change into the controller), `tickAll`
 * (the timer that reclaims dead-lease workers) — with every store effect INJECTED, so the whole thing is testable with
 * fakes and adds no store imports to the hot runtime file.
 *
 * WHAT IT MAKES POSSIBLE (the C3 gap): today a decompose run's starts are driven by the foreground `autoStartTaskIds`
 * cascade and a card that was MID-RUN when the process died is lost (leaseless, no single replay). When enabled, a run
 * becomes a **lease-based, single-ledger job graph**: each ready card is leased + dispatched, a worker that dies is
 * reclaimed + retried within budget, every decision/completion is appended to the §5.AF ledger, and on boot `ensureRun`
 * REPLAYS that ledger and re-dispatches the orphaned in-flight cards — resuming the run exactly where it died.
 *
 * SAFETY: `enabled === false` makes every method a no-op (no registry, no controller, no ledger writes, no dispatch),
 * so the default runtime is byte-identical. When enabled, the controller becomes the start-driver for the run — the
 * `dispatch` port delegates to the runtime's single-card start — so the runtime short-circuits `autoStartTaskIds` for a
 * workspace with an active durable run (see the runtime-server wiring). The controller-vs-cascade interaction is the one
 * part that wants a live-Docker restart-mid-run to finalize the default-on flip; the logic ships flag-gated-off until then.
 */

import type { AgentLedgerEvent, AgentSchedulerEvent } from "../core/agent-attempt-ledger";
import { type DurableRunConfig, DurableRunController, type DurableRunPorts } from "../core/durable-run-controller";
import { createLedgerDurableRunPorts } from "../core/durable-run-ports";
import { DurableRunRegistry } from "../core/durable-run-registry";
import { buildDurableJobGraph, type DurableJobDependencyEdge } from "../core/durable-scheduler";
import { type DurableLedgerEnvelope, readDurableSchedulerLog } from "../core/durable-scheduler-ledger";
import type { RuntimeTaskSessionState } from "../core/task-session-api-contract";

/** The minimal, structural board view the wiring reads (a subset of the runtime board so the module stays store-light). */
export interface DurableRunBoardView {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<{ id: string }> }>;
	/** Board dependency edges: `fromTaskId` depends on (is blocked until) `toTaskId` — 1:1 with DurableJobDependencyEdge. */
	dependencies: readonly DurableJobDependencyEdge[];
}

/**
 * Board columns whose cards count as agent-job-SUCCEEDED when (re)building a run's graph. ONLY `completed` — a `review`
 * card is NOT terminal (the review ladder can bounce it back to `in_progress` / re-decompose it), so projecting a
 * review card as succeeded on a resume with no ledger entry would start its dependents against work review may reject.
 * The live durable ledger is the authoritative source once a run exists; this projection is only the fallback seed for a
 * fresh/first-enable resume, so it must be CONSERVATIVE (a review card resumes as `blocked`/`ready` and its own
 * `awaiting_review` summary re-reports success through the controller).
 */
const SUCCEEDED_COLUMN_IDS = new Set<string>(["completed"]);
/** Board columns whose cards are NOT part of the run (trashed cards gate nothing and never lease). */
const NON_RUN_COLUMN_IDS = new Set<string>(["trash"]);

/**
 * Project a board into the {@link buildDurableJobGraph} input (pure): every non-trash card is a job; only cards already
 * in the terminal `completed` lane are `succeededTaskIds`. Trashed cards are excluded. Dependency edges pass through
 * unchanged (same direction).
 */
export function durableJobGraphInputFromBoard(board: DurableRunBoardView): {
	taskIds: string[];
	dependencies: readonly DurableJobDependencyEdge[];
	succeededTaskIds: string[];
} {
	const taskIds: string[] = [];
	const succeededTaskIds: string[] = [];
	for (const column of board.columns) {
		if (NON_RUN_COLUMN_IDS.has(column.id)) {
			continue;
		}
		const succeeded = SUCCEEDED_COLUMN_IDS.has(column.id);
		for (const card of column.cards) {
			taskIds.push(card.id);
			if (succeeded) {
				succeededTaskIds.push(card.id);
			}
		}
	}
	return { taskIds, dependencies: board.dependencies, succeededTaskIds };
}

export interface DurableRunWiringDeps {
	/** Master switch (NKLEIN_DURABLE_SCHEDULER). When false, every method is inert and the runtime is byte-identical. */
	enabled: boolean;
	/** Append one mapped `scheduler` ledger event (the runtime's ledger-store append). Awaited before dispatch by the ports. */
	appendEvent: (event: AgentSchedulerEvent) => void | Promise<void>;
	/** Start a leased card's session (the runtime's single-card start). The controller's `dispatch` port delegates here. */
	startCard: (workspaceId: string, taskId: string) => void;
	/** Read the full agent ledger for a workspace (for boot-RESUME). Absent ⇒ never resumes (fresh run each time). */
	readLedger?: (workspaceId: string) => AgentLedgerEvent[] | Promise<AgentLedgerEvent[]>;
	/** Hash a workspace path for the ledger envelope (never the raw path — prime directive #2). */
	hashWorkspacePath: (workspacePath: string) => string;
	/** A STABLE per-workspace durable-run/workflow id (groups the run's ledger events + scopes resume). */
	workflowIdFor: (workspaceId: string) => string;
	now?: () => number;
	mintWorkerId?: () => string;
	config?: Partial<DurableRunConfig>;
}

/** Conservative defaults (align with the §5.T long-wall-time posture: slow local workers are alive, not dead). */
export const DEFAULT_DURABLE_RUN_CONFIG: DurableRunConfig = {
	maxConcurrentLeases: 3,
	leaseDurationMs: 300_000,
	maxAttempts: 3,
	reclaimBackoffMs: 30_000,
};

export interface DurableRunWiring {
	/** True when the durable scheduler is enabled AND this workspace has an active run (⇒ the runtime defers starts to it). */
	hasRun(workspaceId: string): boolean;
	/**
	 * Ensure a durable run exists for the workspace: build the job graph from the board, RESUME from the persisted ledger
	 * when present (reclaiming orphaned leases), register it, and tick once to lease + dispatch the first ready cards.
	 * Idempotent (a no-op when disabled, when a run already exists, or when the board has no runnable cards). Returns true
	 * when a run was newly created.
	 */
	ensureRun(workspaceId: string, workspacePath: string, board: DurableRunBoardView): Promise<boolean>;
	/** Route a task-session state change into the workspace's run (report completion → tick → cascade, or heartbeat). */
	observeSummary(
		workspaceId: string,
		taskId: string,
		state: RuntimeTaskSessionState,
		error?: string | null,
	): Promise<void>;
	/** Tick every active run (the timer path) — reclaims dead-lease workers and dispatches freed dependents. */
	tickAll(): Promise<void>;
	/** Workspace ids with an active run (operator overview / shutdown sweep). */
	activeWorkspaceIds(): string[];
	/** Drop a workspace's run + its serialization chain (call on workspace disposal so the registry doesn't leak). */
	dispose(workspaceId: string): void;
}

/**
 * Assemble the durable-run substrate into the runtime-facing wiring. Holds one {@link DurableRunRegistry}; all effects
 * are injected. When `enabled` is false every method returns early, so constructing this is safe on the default path.
 */
export function createDurableRunWiring(deps: DurableRunWiringDeps): DurableRunWiring {
	const registry = new DurableRunRegistry();
	const config: DurableRunConfig = { ...DEFAULT_DURABLE_RUN_CONFIG, ...(deps.config ?? {}) };

	function portsFor(workspaceId: string, workspacePath: string): DurableRunPorts {
		const envelope: DurableLedgerEnvelope = {
			workflowId: deps.workflowIdFor(workspaceId),
			workspacePathHash: deps.hashWorkspacePath(workspacePath),
		};
		return createLedgerDurableRunPorts({
			envelope,
			appendEvent: deps.appendEvent,
			enqueueStart: (dispatch) => deps.startCard(workspaceId, dispatch.jobId),
			now: deps.now,
			mintWorkerId: deps.mintWorkerId,
		});
	}

	function disposeIfComplete(workspaceId: string): void {
		const controller = registry.get(workspaceId);
		if (controller?.isComplete()) {
			registry.dispose(workspaceId);
		}
	}

	// A single controller is driven from three fire-and-forget entry points (onSummary, the tick timer, ensureRun) whose
	// `commit()` awaits a ledger append BETWEEN reading and reassigning `jobs` — so concurrent calls could clobber each
	// other (lost completions / double-leases). Serialize per workspace: every controller-touching op runs after the prior
	// one for that workspace settles. The stored tail always resolves (errors are swallowed on the CHAIN, not the caller).
	const chainByWorkspace = new Map<string, Promise<unknown>>();
	function runSerial<T>(workspaceId: string, op: () => Promise<T>): Promise<T> {
		const prior = chainByWorkspace.get(workspaceId) ?? Promise.resolve();
		const result = prior.then(op, op);
		chainByWorkspace.set(
			workspaceId,
			result.then(
				() => undefined,
				() => undefined,
			),
		);
		return result;
	}

	return {
		hasRun(workspaceId) {
			return deps.enabled && registry.has(workspaceId);
		},

		async ensureRun(workspaceId, workspacePath, board) {
			if (!deps.enabled) {
				return false;
			}
			return runSerial(workspaceId, async () => {
				if (registry.has(workspaceId)) {
					return false;
				}
				const graphInput = durableJobGraphInputFromBoard(board);
				if (graphInput.taskIds.length === 0) {
					return false;
				}
				const initialJobs = buildDurableJobGraph(graphInput);
				const ports = portsFor(workspaceId, workspacePath);
				const priorLog = deps.readLedger
					? readDurableSchedulerLog(await deps.readLedger(workspaceId), {
							workflowId: deps.workflowIdFor(workspaceId),
						})
					: [];
				const controller =
					priorLog.length > 0
						? await DurableRunController.resume(initialJobs, priorLog, config, ports)
						: new DurableRunController(initialJobs, config, ports);
				registry.register(workspaceId, controller);
				// Lease + dispatch the first ready cards (or, on resume, re-dispatch the reclaimed orphans).
				await controller.tick();
				disposeIfComplete(workspaceId);
				return true;
			});
		},

		async observeSummary(workspaceId, taskId, state, error) {
			if (!deps.enabled) {
				return;
			}
			await runSerial(workspaceId, () => registry.reactToTaskSummary(workspaceId, taskId, state, error));
		},

		async tickAll() {
			if (!deps.enabled) {
				return;
			}
			await Promise.all(
				registry.activeWorkspaceIds().map((workspaceId) =>
					runSerial(workspaceId, async () => {
						const controller = registry.get(workspaceId);
						if (controller) {
							await controller.tick();
							disposeIfComplete(workspaceId);
						}
					}),
				),
			);
		},

		activeWorkspaceIds() {
			return registry.activeWorkspaceIds();
		},

		dispose(workspaceId) {
			registry.dispose(workspaceId);
			chainByWorkspace.delete(workspaceId);
		},
	};
}
