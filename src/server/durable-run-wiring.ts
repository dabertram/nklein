/**
 * The C3 durable-scheduler LIVE-WIRING composition layer (todo §5.AF) — the single seam that ties the built-but-dark
 * durable-run substrate to the runtime, gated by `NKLEIN_DURABLE_SCHEDULER`.
 *
 * ⚠️ **THAT FLAG IS DEFAULT-ON, NOT OPT-IN.** It is read with `isEnabledByDefaultEnv`, so an UNSET variable means
 * ENABLED; only an explicit `0`/`false`/`no`/`off` turns the scheduler off. It was promoted deliberately in
 * `cda009684` ("durable scheduler DEFAULT-ON — live restart-mid-run validation complete") and this header went on
 * saying "default OFF = byte-identical" for months afterwards. That phrase is the one a reviewer relies on to
 * conclude a change here cannot affect a normal run, and on this subsystem it was exactly backwards.
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
import { type DispatchReservationLedger, reservationAwarePools } from "../core/dispatch-reservations";
import { type AdmissionPoolState, planDurableAdmission } from "../core/durable-admission";
import type { DurableRunLeaseIdentity } from "../core/durable-lease-idempotency";
import { type DurableRunConfig, DurableRunController, type DurableRunPorts } from "../core/durable-run-controller";
import { createLedgerDurableRunPorts } from "../core/durable-run-ports";
import { DurableRunRegistry } from "../core/durable-run-registry";
import { buildDurableJobGraph, type DurableJobDependencyEdge } from "../core/durable-scheduler";
import { type DurableLedgerEnvelope, readDurableSchedulerLog } from "../core/durable-scheduler-ledger";
import type { RuntimeTaskSessionState } from "../core/task-session-api-contract";
import type { DurableSchedulerClaim, DurableSchedulerClaimResult } from "../state/durable-scheduler-claim";

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

/** Board lanes whose cards count as WAITING for the mid-run reconcile's reopen rule (mirrors the ready sweep's set). */
const WAITING_COLUMN_IDS = new Set<string>(["backlog", "planning", "ready"]);

/** Project the ids of waiting-lane cards (the reopen rule's gate — see `reconcileDurableJobsWithBoard`). */
export function waitingTaskIdsFromBoard(board: DurableRunBoardView): Set<string> {
	const waiting = new Set<string>();
	for (const column of board.columns) {
		if (!WAITING_COLUMN_IDS.has(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			waiting.add(card.id);
		}
	}
	return waiting;
}

export interface DurableRunWiringDeps {
	/**
	 * Master switch. When false every method is inert; the runtime server derives it from
	 * `NKLEIN_DURABLE_SCHEDULER`, which is **DEFAULT-ON** — unset means enabled. See the header.
	 */
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
	/**
	 * N7d: record an admission EXCLUSION. Optional so the wiring stays inert without it, but its absence is why a
	 * whole class of stall was invisible — `planDurableAdmission` can exclude a job and, before this, the decision
	 * was returned and never written down. A component that declines work without recording the decision leaves a
	 * card whose ONLY trace in the log is the sweep declining to start it.
	 */
	warn?: (message: string) => void;
	now?: () => number;
	mintWorkerId?: () => string;
	config?: Partial<DurableRunConfig>;
	/**
	 * F1.19b saturation-aware admission: a SYNC live pool view (occupancy + caps) and the endpoint/pool a task
	 * would start on. `null` (or absent) ⇒ the controller's depth-priority default — fail-open, byte-identical.
	 */
	getAdmissionState?: (workspaceId: string) => {
		pools: AdmissionPoolState[];
		poolKeyForTask: (taskId: string) => string | null;
	} | null;
	/**
	 * F1.24 dispatch reservations: a hold is taken at dispatch and released on the task's FIRST observed summary
	 * (the live occupancy view owns it from there) — closing the dispatch→session-appears window the admission
	 * planner cannot otherwise see. With no declared capacities the ledger never blocks (pure bookkeeping folded
	 * into the admission view via `reservationAwarePools`); a shortfall never vetoes a granted lease (fail-open —
	 * the runtime's own endpoint gates still apply downstream).
	 */
	reservations?: DispatchReservationLedger;
	/**
	 * P21.5b: take EXCLUSIVE scheduler ownership of the workspace's ledger before building a run.
	 *
	 * Optional so every existing construction stays byte-identical — but the runtime server supplies it, so the
	 * fence is live in production. **Absent means UNFENCED, which is the pre-P21.5b behaviour**, not a safe default:
	 * two orchestrators replaying one ledger each build their own job graph and can both lease the same job.
	 */
	claimLedger?: (input: { workspaceId: string; workspacePathHash: string }) => Promise<DurableSchedulerClaimResult>;
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
	 *
	 * `resumeOnly` (boot path): proceed ONLY when a persisted ledger already exists for this workspace — i.e. resume a run
	 * that was in flight before a restart, never build a FRESH run. This is the service-creation seam: a fresh workspace's
	 * board is only the decompose SEED at that point, so building then would freeze the run to a seed-only graph and the
	 * later decompose's cards would never be leased. The fresh run is built at decompose-apply (`resumeOnly` false) when
	 * the full DAG is known.
	 */
	ensureRun(
		workspaceId: string,
		workspacePath: string,
		board: DurableRunBoardView,
		options?: {
			resumeOnly?: boolean;
			/** Cap this run's concurrent leases (review #5): align with the board's `maxConcurrentTasks` so the controller
			 *  never leases more cards than the board will start — over-leasing hits `concurrency_limit` and orphans a lease. */
			maxConcurrentLeases?: number;
		},
	): Promise<boolean>;
	/**
	 * Audit 2026-08-12 F1: reconcile a LIVE run with the current board — absorb cards born mid-run (re-decompose
	 * children, reshard replacements, trigger-seeded cards) and reopen failed jobs the board re-opened (an
	 * integration-converted parent, with refreshed child edges + a fresh attempt budget). Ticks once when anything
	 * changed so absorbed/reopened ready jobs lease immediately. No-op (false) when the workspace has no run.
	 */
	absorbBoardCards(
		workspaceId: string,
		board: DurableRunBoardView,
	): Promise<{ absorbedJobIds: string[]; reopenedJobIds: string[] } | false>;
	/** Route a task-session state change into the workspace's run (report completion → tick → cascade, or heartbeat). */
	observeSummary(
		workspaceId: string,
		taskId: string,
		state: RuntimeTaskSessionState,
		error?: string | null,
	): Promise<void>;
	/** F1.18: the task's DELIVERY completed — the only dependency-releasing success (review alone never releases). */
	observeDelivered(workspaceId: string, taskId: string): Promise<void>;
	/** A review-level park: settle the job failed (parked-for-operator) and release its lease. */
	observeParked(workspaceId: string, taskId: string, reason: string | null): Promise<void>;
	/**
	 * G6.8a v15b: the runtime's bounded rescue decided these startable-but-sessionless cards deserve a dispatch —
	 * make the handover REAL by reviving their failed jobs and ticking (previously a warn the controller never saw:
	 * "If the controller does not dispatch them, nothing will" — and it didn't, livelocking the board). Returns the
	 * task ids actually revived; candidates in any non-failed job state are untouched.
	 */
	redispatchCandidates(workspaceId: string, taskIds: readonly string[]): Promise<string[]>;
	/**
	 * Tick every active run (the timer path) — reclaims dead-lease workers and dispatches freed dependents. `liveTaskIdsFor`
	 * (when supplied) reports which of a workspace's leased cards STILL have a live session; those leases are HEARTBEATED
	 * before the tick so a slow-but-alive worker (whose sparse summaries don't fire `observeSummary` within the lease window)
	 * is not spuriously reclaimed. Only a lease with no live session ages out to a reclaim.
	 */
	tickAll(liveTaskIdsFor?: (workspaceId: string) => readonly string[]): Promise<void>;
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
		const ports = createLedgerDurableRunPorts({
			envelope,
			appendEvent: deps.appendEvent,
			enqueueStart: (dispatch) => {
				// F1.24: take the dispatch hold BEFORE the start; released on the task's first observed summary.
				if (deps.reservations) {
					const poolKey = deps.getAdmissionState?.(workspaceId)?.poolKeyForTask(dispatch.jobId) ?? null;
					if (poolKey) {
						deps.reservations.tryReserve(dispatch.jobId, [{ kind: "endpoint_slot", key: poolKey, amount: 1 }]);
					}
				}
				deps.startCard(workspaceId, dispatch.jobId);
			},
			now: deps.now,
			mintWorkerId: deps.mintWorkerId,
		});
		if (deps.getAdmissionState) {
			// Track when each job ENTERED its current ready spell — the fairness/starvation age basis.
			const readySinceByJobId = new Map<string, number>();
			ports.planAdmission = (jobs, now) => {
				const state = deps.getAdmissionState?.(workspaceId);
				if (!state) {
					return {};
				}
				const ready = jobs.filter((job) => job.state === "ready");
				for (const job of ready) {
					if (!readySinceByJobId.has(job.jobId)) {
						readySinceByJobId.set(job.jobId, now);
					}
				}
				for (const jobId of [...readySinceByJobId.keys()]) {
					if (!ready.some((job) => job.jobId === jobId)) {
						readySinceByJobId.delete(jobId);
					}
				}
				const pools = deps.reservations ? reservationAwarePools(state.pools, deps.reservations) : state.pools;
				const plan = planDurableAdmission({
					candidates: ready.map((job) => ({
						jobId: job.jobId,
						poolKey: state.poolKeyForTask(job.jobId),
						readySinceMs: readySinceByJobId.get(job.jobId) ?? now,
					})),
					pools,
					now,
				});
				// N7d: the silent drop, made loud. 14 cards in a real run had exactly ONE log line each — the sweep's
				// handover — because the exclusion that followed was never recorded anywhere.
				if (plan.excludedJobIds.length > 0) {
					deps.warn?.(
						`Durable admission EXCLUDED ${plan.excludedJobIds.length} ready job(s) [${plan.excludedJobIds.slice(0, 5).join(", ")}${plan.excludedJobIds.length > 5 ? ", …" : ""}] for ${workspaceId}. Excluded jobs are not dispatched this tick; if they are never re-admitted they strand with no further trace.`,
					);
				}
				return { readyOrder: plan.readyOrder, excludedJobIds: plan.excludedJobIds };
			};
		}
		return ports;
	}

	/**
	 * P21.5b claims, held for the LIFETIME of a run and released on every disposal path.
	 *
	 * A claim that outlived its run would fence the ledger against the very restart meant to recover it — the
	 * failure mode is a board that never resumes, which is worse than the double-scheduling this prevents because
	 * nothing about it looks wrong. Every `registry.dispose` below is paired with a release for that reason.
	 */
	const claimByWorkspace = new Map<string, DurableSchedulerClaim>();

	function releaseClaim(workspaceId: string): void {
		const claim = claimByWorkspace.get(workspaceId);
		if (!claim) {
			return;
		}
		claimByWorkspace.delete(workspaceId);
		void claim.release();
	}

	function disposeIfComplete(workspaceId: string): void {
		const controller = registry.get(workspaceId);
		if (controller?.isComplete()) {
			registry.dispose(workspaceId);
			releaseClaim(workspaceId);
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

		async ensureRun(workspaceId, workspacePath, board, options) {
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
				// Boot path: only RESUME a run that was already in flight (a persisted ledger). Never build a FRESH run at
				// service creation — the board is only the decompose seed then, and a seed-only run would freeze out the
				// decompose's real cards. The fresh run is built at decompose-apply (resumeOnly false), full DAG in hand.
				if (options?.resumeOnly && priorLog.length === 0) {
					return false;
				}
				// P21.5b: take exclusive ownership BEFORE replaying the ledger into a controller. Placed after every
				// early return so a call that was never going to build a run does not take a lock, and before the
				// replay so a second scheduler never constructs a job graph it has no right to drive.
				if (deps.claimLedger && !claimByWorkspace.has(workspaceId)) {
					const claimed = await deps.claimLedger({
						workspaceId,
						workspacePathHash: deps.hashWorkspacePath(workspacePath),
					});
					if (!claimed.ok) {
						// Refusing is the POINT, so it is logged rather than swallowed: a runtime that silently
						// schedules nothing is indistinguishable from one with no work to do.
						deps.warn?.(`Durable scheduler NOT started for ${workspaceId} — ${claimed.message}`);
						return false;
					}
					claimByWorkspace.set(workspaceId, claimed.claim);
				}
				// Review #5: align this run's lease cap with the board's own concurrency cap when the caller supplies it, so
				// the controller never leases more cards than the runtime will actually start (over-leasing → concurrency_limit).
				const runConfig: DurableRunConfig =
					typeof options?.maxConcurrentLeases === "number" && Number.isFinite(options.maxConcurrentLeases)
						? { ...config, maxConcurrentLeases: Math.max(1, Math.trunc(options.maxConcurrentLeases)) }
						: config;
				// §5.AF at-most-once: the run-level identity a lease's idempotency key is derived against (run-wide
				// workflow + workspace hash; per-job model/endpoint left unset ⇒ the key is the workflow×task×attempt).
				const identity: DurableRunLeaseIdentity = {
					workflowId: deps.workflowIdFor(workspaceId),
					workspacePathHash: deps.hashWorkspacePath(workspacePath),
				};
				const controller =
					priorLog.length > 0
						? await DurableRunController.resume(initialJobs, priorLog, runConfig, ports, identity)
						: new DurableRunController(initialJobs, runConfig, ports, identity);
				// Audit 2026-08-12 F1: a resumed run replays OLD failure entries over the fresh board graph — a
				// parent the board has since re-opened (integration conversion, operator move) would fold back to
				// `failed` and dam its subtree again after every restart. The same board-driven reconcile the live
				// absorb path uses re-derives the reopen here, keeping restart and live behavior identical.
				if (priorLog.length > 0) {
					const reopened = controller.reconcileWithBoardGraph(initialJobs, waitingTaskIdsFromBoard(board));
					if (reopened.reopenedJobIds.length > 0) {
						deps.warn?.(
							`Durable resume for ${workspaceId}: reopened ${reopened.reopenedJobIds.length} board-reopened failed job(s) (${reopened.reopenedJobIds.join(", ")}).`,
						);
					}
				}
				registry.register(workspaceId, controller);
				// Lease + dispatch the first ready cards (or, on resume, re-dispatch the reclaimed orphans).
				await controller.tick();
				disposeIfComplete(workspaceId);
				return true;
			});
		},

		async absorbBoardCards(workspaceId, board) {
			if (!deps.enabled) {
				return false;
			}
			return runSerial(workspaceId, async () => {
				const controller = registry.get(workspaceId);
				if (!controller) {
					return false;
				}
				const boardGraph = buildDurableJobGraph(durableJobGraphInputFromBoard(board));
				const result = controller.reconcileWithBoardGraph(boardGraph, waitingTaskIdsFromBoard(board));
				if (result.absorbedJobIds.length > 0 || result.reopenedJobIds.length > 0) {
					deps.warn?.(
						`Durable run for ${workspaceId}: absorbed ${result.absorbedJobIds.length} mid-run card(s)` +
							`${result.reopenedJobIds.length > 0 ? `, reopened ${result.reopenedJobIds.length} board-reopened job(s)` : ""} — ticking.`,
					);
					await controller.tick();
					disposeIfComplete(workspaceId);
				}
				return result;
			});
		},

		async observeSummary(workspaceId, taskId, state, error) {
			if (!deps.enabled) {
				return;
			}
			// F1.24: the session now shows in live occupancy — the dispatch hold has done its job.
			deps.reservations?.release(taskId);
			await runSerial(workspaceId, () => registry.reactToTaskSummary(workspaceId, taskId, state, error));
		},
		async observeDelivered(workspaceId, taskId) {
			if (!deps.enabled) {
				return;
			}
			deps.reservations?.release(taskId);
			await runSerial(workspaceId, () => registry.reportDelivered(workspaceId, taskId));
		},

		async observeParked(workspaceId, taskId, reason) {
			if (!deps.enabled) {
				return;
			}
			deps.reservations?.release(taskId);
			await runSerial(workspaceId, () => registry.reportParked(workspaceId, taskId, reason));
		},

		async redispatchCandidates(workspaceId, taskIds) {
			if (!deps.enabled || taskIds.length === 0) {
				return [];
			}
			return await runSerial(workspaceId, () => registry.redispatchCandidates(workspaceId, taskIds));
		},

		async tickAll(liveTaskIdsFor) {
			if (!deps.enabled) {
				return;
			}
			await Promise.all(
				registry.activeWorkspaceIds().map((workspaceId) =>
					runSerial(workspaceId, async () => {
						const controller = registry.get(workspaceId);
						if (!controller) {
							return;
						}
						// Heartbeat every lease whose session is STILL ALIVE so a slow-but-alive worker (sparse summaries)
						// is not spuriously reclaimed; only a lease with no live session ages out to a reclaim on the tick.
						if (liveTaskIdsFor) {
							for (const taskId of liveTaskIdsFor(workspaceId)) {
								controller.heartbeat(taskId);
							}
						}
						await controller.tick();
						disposeIfComplete(workspaceId);
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
			releaseClaim(workspaceId);
		},
	};
}
