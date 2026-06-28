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
	replayDurableJobs,
} from "./durable-scheduler";

/** The lease a `dispatch` carries — enough for the runtime to start the card and bound its heartbeat. */
export interface DurableDispatch {
	jobId: string;
	workerId: string;
	/** Epoch ms the lease expires (the heartbeat deadline); the worker must finish or renew before this. */
	expiresAt: number;
}

/** The effects the controller needs from the runtime. Kept minimal + synchronous-friendly so the loop stays testable. */
export interface DurableRunPorts {
	/** Current wall clock (epoch ms). */
	now(): number;
	/** Mint a worker id for a new lease (e.g. a uuid). */
	mintWorkerId(): string;
	/** Persist one durable-log entry (the runtime maps it to a `scheduler` ledger event + appends — see durable-scheduler-ledger). */
	appendLog(entry: DurableSchedulerLogEntry): void;
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
	static resume(
		initialJobs: readonly DurableJob[],
		log: readonly DurableSchedulerLogEntry[],
		config: DurableRunConfig,
		ports: DurableRunPorts,
	): DurableRunController {
		const replayed = replayDurableJobs(initialJobs, log, { reclaimBackoffMs: config.reclaimBackoffMs });
		const controller = new DurableRunController(replayed, config, ports);
		controller.reclaimOrphanedLeases();
		return controller;
	}

	/**
	 * Reclaim every still-`leased` job as orphaned (its worker died with the process) — a `reclaim` if it has attempt
	 * budget left, else a `fail`. Appends + applies each so the log stays the source of truth. Called by `resume`; safe
	 * to call again (a no-op when nothing is leased).
	 */
	reclaimOrphanedLeases(): void {
		const now = this.ports.now();
		const actions: DurableSchedulerAction[] = this.jobs
			.filter((job) => job.state === "leased")
			.map((job) =>
				job.attempts >= Math.max(1, Math.trunc(this.config.maxAttempts))
					? { type: "fail", jobId: job.jobId, reason: "max_attempts" }
					: { type: "reclaim", jobId: job.jobId, reason: "lease_expired" },
			);
		this.commit(actions, now);
	}

	/**
	 * One scheduling tick: decide the next actions against the current state + clock, persist each, apply them, and
	 * dispatch newly-leased jobs. Returns the actions taken (`[]` when nothing is due). The runtime calls this on a timer
	 * and right after `reportCompletion` to cascade unblocked dependents.
	 */
	tick(): DurableSchedulerAction[] {
		const now = this.ports.now();
		const actions = decideDurableSchedulerActions({
			jobs: this.jobs,
			now,
			maxConcurrentLeases: this.config.maxConcurrentLeases,
			leaseDurationMs: this.config.leaseDurationMs,
			maxAttempts: this.config.maxAttempts,
			reclaimBackoffMs: this.config.reclaimBackoffMs,
			mintWorkerId: this.ports.mintWorkerId,
		});
		this.commit(actions, now);
		return actions;
	}

	/**
	 * Record a worker's terminal report for its leased job (`succeeded` / `failed`) — persist a `completed` entry and
	 * apply it. A no-op for an unknown/terminal job. The runtime should `tick()` afterwards to schedule freed dependents.
	 */
	reportCompletion(jobId: string, outcome: "succeeded" | "failed"): void {
		const job = this.jobs.find((candidate) => candidate.jobId === jobId);
		if (!job || job.state === "succeeded" || job.state === "failed") {
			return;
		}
		this.ports.appendLog({ kind: "completed", jobId, outcome });
		this.jobs = markDurableJob(this.jobs, jobId, outcome);
	}

	/** Append + apply a set of actions at a single captured clock, dispatching any new leases. */
	private commit(actions: readonly DurableSchedulerAction[], now: number): void {
		for (const action of actions) {
			this.ports.appendLog({ kind: "scheduled", now, action });
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
