/**
 * The durable multi-card run controller (todo §5.AF; the C3 "unattended + restart-survivable" milestone) — the
 * injectable orchestrator that ties the pure {@link ./durable-scheduler} brain to the runtime via PORTS, so the
 * tick-loop logic is fully testable with fakes before the hot-path wiring (mirrors substrate-first: the brain
 * `durable-scheduler`, the persistence bridge `durable-scheduler-ledger`, now the loop).
 *
 * What it adds over today's pipeline: the existing `runtime-task-start-queue` already retries + persists pending starts,
 * and `completeTaskAndGetReadyLinkedTaskIds` already unblocks dependents on completion — but a card that was *mid-run*
 * when the process died is lost (leaseless), and progress is spread across stores with no single replay. This controller
 * makes a run a **lease-based, single-log job graph**: each `lease` action dispatches a card's session start; a worker
 * that dies (lease expiry, missed heartbeat) is reclaimed + retried within budget; every decision/completion is appended
 * to the §5.AF ledger (via the `appendLog` port) so a fresh process replays it and resumes exactly.
 *
 * Effects are injected ({@link DurableRunPorts}); the controller itself holds only the in-memory job mirror + config and
 * is otherwise pure + deterministic given its ports. The runtime supplies real ports — `dispatch` = enqueue the card's
 * `RuntimeTaskSessionStartRequest`; `appendLog` = map the entry to a `scheduler` ledger event + append; `now`/
 * `mintWorkerId` = wall clock + uuid — and drives `tick()` on a timer + `reportCompletion()` when a session finishes.
 */

import {
	applyDurableSchedulerActions,
	type DurableJob,
	type DurableSchedulerAction,
	type DurableSchedulerLogEntry,
	decideDurableSchedulerActions,
	isDurableRunComplete,
	markDurableJob,
	renewDurableLease,
	replayDurableJobs,
} from "./durable-scheduler";
import { orderReadyJobs } from "./durable-scheduler-ready-order";
import { isTruthyEnv } from "./env-flag";
import { isTransientNetworkError } from "./transient-error";

/**
 * §5.AF OPT-IN (default OFF): when set, `tick()` leases ready jobs in DEPTH/FAN-OUT priority order (via the tested
 * {@link module:core/durable-scheduler-ready-order#orderReadyJobs}) instead of raw input order — so under a scarce
 * concurrency cap a high-fan-out prerequisite that unblocks many dependents wins the slot ahead of a cheap leaf. Default
 * OFF ⇒ `readyOrder` is left undefined ⇒ the scheduler leases in raw input order, byte-identical to today.
 */
const DEPTH_PRIORITY_FLAG = "DURABLE_DEPTH_PRIORITY";

/** The lease a `dispatch` carries — enough for the runtime to start the card and bound its heartbeat. */
export interface DurableDispatch {
	jobId: string;
	workerId: string;
	/** Epoch ms the lease expires (the heartbeat deadline); the worker must finish or renew before this. */
	expiresAt: number;
}

/** The effects the controller needs from the runtime. Kept minimal so the loop stays testable. */
export interface DurableRunPorts {
	/** Current wall clock (epoch ms). */
	now(): number;
	/** Mint a worker id for a new lease (e.g. a uuid). */
	mintWorkerId(): string;
	/**
	 * Durably persist one log entry (the runtime maps it to a `scheduler` ledger event + appends — see
	 * durable-scheduler-ledger). **Awaited before the matching `dispatch`** so a crash can never leave a card running
	 * (or enqueued) without its lease on record — the restart-survivability invariant (a leased-but-unlogged card would
	 * be lost: never reclaimed, never rerun). May be sync (tests) or async (real ledger I/O).
	 */
	appendLog(entry: DurableSchedulerLogEntry): void | Promise<void>;
	/** Start running a leased job (enqueue the card's session start). Fire-and-forget; completion returns via `reportCompletion`. */
	dispatch(dispatch: DurableDispatch): void;
}

/** The run's scheduling policy (the same knobs the pure decider takes, minus the per-tick clock/mint). */
export interface DurableRunConfig {
	maxConcurrentLeases: number;
	leaseDurationMs: number;
	maxAttempts: number;
	reclaimBackoffMs: number;
}

export class DurableRunController {
	private jobs: DurableJob[];

	constructor(
		initialJobs: readonly DurableJob[],
		private readonly config: DurableRunConfig,
		private readonly ports: DurableRunPorts,
	) {
		this.jobs = initialJobs.map((job) => ({ ...job }));
	}

	/**
	 * Resume a run from its persisted log (boot-replay): fold the log over the initial graph, then — because a process
	 * restart kills every in-flight worker — **reclaim any still-`leased` job** so the next `tick()` re-dispatches it
	 * (rather than waiting out a lease that no live worker holds). The reclaims are appended to the log too, keeping it
	 * consistent. Use {@link replayDurableJobs} + this constructor directly if you want the raw replayed state instead.
	 */
	static async resume(
		initialJobs: readonly DurableJob[],
		log: readonly DurableSchedulerLogEntry[],
		config: DurableRunConfig,
		ports: DurableRunPorts,
	): Promise<DurableRunController> {
		const replayed = replayDurableJobs(initialJobs, log, {
			reclaimBackoffMs: config.reclaimBackoffMs,
			maxAttempts: config.maxAttempts,
		});
		const controller = new DurableRunController(replayed, config, ports);
		await controller.reclaimOrphanedLeases();
		return controller;
	}

	/**
	 * Reclaim every still-`leased` job as orphaned (its worker died with the process) — a `reclaim` if it has attempt
	 * budget left, else a `fail`. Appends + applies each so the log stays the source of truth. Called by `resume`; safe
	 * to call again (a no-op when nothing is leased).
	 */
	async reclaimOrphanedLeases(): Promise<void> {
		const now = this.ports.now();
		// NaN guard: `Math.max(1, Math.trunc(NaN))` is NaN and `attempts >= NaN` is always false, which would reclaim an
		// orphaned lease FOREVER (never fail) on a misconfigured `maxAttempts`. Treat any non-finite value as the floor 1.
		const maxAttempts = Number.isFinite(this.config.maxAttempts)
			? Math.max(1, Math.trunc(this.config.maxAttempts))
			: 1;
		const actions: DurableSchedulerAction[] = this.jobs
			.filter((job) => job.state === "leased")
			.map((job) =>
				job.attempts >= maxAttempts
					? { type: "fail", jobId: job.jobId, reason: "max_attempts" }
					: { type: "reclaim", jobId: job.jobId, reason: "lease_expired" },
			);
		await this.commit(actions, now);
	}

	/**
	 * One scheduling tick: decide the next actions against the current state + clock, persist each, apply them, and
	 * dispatch newly-leased jobs. Returns the actions taken (`[]` when nothing is due). The runtime calls this on a timer
	 * and right after `reportCompletion` to cascade unblocked dependents.
	 */
	async tick(): Promise<DurableSchedulerAction[]> {
		const now = this.ports.now();
		// §5.AF depth/fan-out lease priority (opt-in). Default OFF ⇒ readyOrder undefined ⇒ the scheduler leases in raw
		// input order (byte-identical). When enabled, rank the READY jobs by unblock value + anti-starvation so a
		// high-fan-out prerequisite wins a scarce slot ahead of a cheap leaf; the scheduler still owns every eligibility
		// gate — this only reorders which eligible job it considers first.
		const readyOrder = isTruthyEnv(process.env[DEPTH_PRIORITY_FLAG])
			? orderReadyJobs({ jobs: this.jobs, now }).ordered.map((job) => job.jobId)
			: undefined;
		const actions = decideDurableSchedulerActions({
			jobs: this.jobs,
			now,
			maxConcurrentLeases: this.config.maxConcurrentLeases,
			leaseDurationMs: this.config.leaseDurationMs,
			maxAttempts: this.config.maxAttempts,
			reclaimBackoffMs: this.config.reclaimBackoffMs,
			mintWorkerId: this.ports.mintWorkerId,
			readyOrder,
		});
		await this.commit(actions, now);
		return actions;
	}

	/**
	 * Record a worker's report for its leased job — persist a `completed` entry and apply it. A no-op for an
	 * unknown/terminal job. The runtime should `tick()` afterwards to schedule freed dependents. §5.AF: when a `failed`
	 * report carries a TRANSIENT error (`isTransientNetworkError` — a body/headers timeout / connection blip / 5xx),
	 * it is recorded as `transient_retry` so the job retries (back to `ready`, one attempt burnt) instead of parking —
	 * the lease-layer survivability for the SWARM/agent path, whose SDK model call can't itself be wrapped (#4).
	 */
	async reportCompletion(jobId: string, outcome: "succeeded" | "failed", error?: unknown): Promise<void> {
		const job = this.jobs.find((candidate) => candidate.jobId === jobId);
		if (!job || job.state === "succeeded" || job.state === "failed") {
			return;
		}
		const effectiveOutcome = outcome === "failed" && isTransientNetworkError(error) ? "transient_retry" : outcome;
		await this.ports.appendLog({ kind: "completed", jobId, outcome: effectiveOutcome });
		this.jobs = markDurableJob(this.jobs, jobId, effectiveOutcome, this.config.maxAttempts);
	}

	/**
	 * Heartbeat a running card: extend its lease by `leaseDurationMs` from now so the scheduler doesn't reclaim a
	 * worker that is alive but slow (the §5.AF lease-expiry guard is for DEAD workers, not slow ones). In-memory only
	 * (not logged) — a restart orphans the lease anyway and `resume` reclaims it. A no-op for a non-leased job.
	 */
	heartbeat(jobId: string): void {
		this.jobs = renewDurableLease(this.jobs, jobId, this.ports.now() + this.config.leaseDurationMs);
	}

	/**
	 * Persist + apply a set of actions at a single captured clock, then dispatch any new leases. Every log entry is
	 * **awaited before any dispatch** — the persist-before-side-effect ordering that makes the run restart-survivable
	 * (a dispatched-but-unlogged lease would be lost on crash). Entries are appended in decision order.
	 */
	private async commit(actions: readonly DurableSchedulerAction[], now: number): Promise<void> {
		// CONTRACT — on a mid-commit append failure (an `appendLog` rejecting after earlier appends in this batch
		// persisted) the caller MUST discard this controller and `resume()` from the log: the in-memory mirror is
		// intentionally NOT advanced (apply + dispatch are skipped), so it can lag its own persisted prefix until a
		// restart replays the log. Continuing to tick this same instance would decide against a stale snapshot.
		for (const action of actions) {
			await this.ports.appendLog({ kind: "scheduled", now, action });
		}
		this.jobs = applyDurableSchedulerActions(this.jobs, actions, {
			now,
			reclaimBackoffMs: this.config.reclaimBackoffMs,
		});
		for (const action of actions) {
			if (action.type === "lease") {
				this.ports.dispatch({ jobId: action.jobId, workerId: action.workerId, expiresAt: action.expiresAt });
			}
		}
	}

	/** A read-only snapshot of the current job states (for board projection / tests / operator UX). */
	jobsSnapshot(): readonly DurableJob[] {
		return this.jobs.map((job) => ({ ...job }));
	}

	/** True when every job is terminal — the run is finished and the runtime can stop ticking it. */
	isComplete(): boolean {
		return isDurableRunComplete(this.jobs);
	}
}
