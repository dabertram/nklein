/**
 * §5.AI durable background-eval runner CORE — the brain of the always-on dev-test rail, with every effect INJECTED so
 * the control flow is pure + fully testable. A real process layers thin glue on top: a timer that calls `tick()`, and
 * deps that read live runtime signals / start+stop sandboxed runs / persist the lease checkpoint (to the §5.AF ledger).
 *
 * Each `tick()`:
 *   1. reaps leases that COMPLETED naturally (run no longer active → just drop) or EXPIRED past their deadline
 *      (force-stop the overrun), so a stuck run never holds a slot forever;
 *   2. reads live signals + asks the idle-aware admission gate ({@link decideBackgroundEvalAdmission}) whether to start
 *      another run — which ALWAYS yields to interactive/targeted work, so the rail never starves a real task;
 *   3. if admitted AND there's a project to run, starts it and records a lease;
 *   4. checkpoints the lease set so a crash/restart can `recover()` exactly what was in flight.
 *
 * This is deliberately NOT a fragile foreground loop: state is durable (checkpoint/recover) and the loop is a thin
 * driver over this pure tick.
 */

import { decideBackgroundEvalAdmission } from "./background-eval-admission.js";

export interface BackgroundEvalLease {
	runId: string;
	project: string;
	/** The sandbox workspace once created (null if the start didn't yield one). */
	workspaceId: string | null;
	startedAt: number;
	/** Force-stop the run once `now >= deadlineAt` (a secondary safety net beyond the run's own guardrails). */
	deadlineAt: number;
}

export interface BackgroundEvalRunnerSignals {
	hasInteractiveWork: boolean;
	loadedModelIdle: boolean;
	resourceHeadroom: boolean;
}

export interface BackgroundEvalRunnerDeps {
	/** Max concurrent background-eval runs (the admission cap). */
	maxConcurrentEvals: number;
	/** Read the live runtime signals the admission gate needs. */
	getSignals: () => Promise<BackgroundEvalRunnerSignals>;
	/** Pick the next project id to evaluate, or null when there's nothing to run (sync or async — F1.32b's live
	 *  fitness-aware picker reads loaded models + persisted run history). */
	selectNextProject: () => string | null | Promise<string | null>;
	/** Start a sandboxed run for a project; resolves with its lease identity. */
	startRun: (project: string) => Promise<{ runId: string; workspaceId: string | null; deadlineAt: number }>;
	/** Whether a recorded run is still active (false once it reached a terminal state). */
	isRunActive: (lease: BackgroundEvalLease) => Promise<boolean>;
	/** Force-stop an overrunning run whose deadline passed. */
	stopRun: (lease: BackgroundEvalLease) => Promise<void>;
	/** Load the persisted lease set on startup (durable recovery). */
	loadCheckpoint: () => Promise<BackgroundEvalLease[]>;
	/** Persist the current lease set after every tick. */
	saveCheckpoint: (leases: readonly BackgroundEvalLease[]) => Promise<void>;
	now: () => number;
}

export type BackgroundEvalTickReason =
	| "admitted"
	| "yield_to_interactive"
	| "no_idle_loaded_model"
	| "background_cap_reached"
	| "no_resource_headroom"
	| "no_project_to_run";

export interface BackgroundEvalTickOutcome {
	admitted: BackgroundEvalLease | null;
	reaped: BackgroundEvalLease[];
	reason: BackgroundEvalTickReason;
	activeLeases: number;
}

export interface BackgroundEvalRunner {
	/** Restore in-flight leases from the durable checkpoint (call once on startup before ticking). */
	recover: () => Promise<void>;
	/** Advance the scheduler one step: reap finished/expired runs, then admit one new run if allowed. */
	tick: () => Promise<BackgroundEvalTickOutcome>;
	getLeases: () => readonly BackgroundEvalLease[];
}

export function createBackgroundEvalRunner(deps: BackgroundEvalRunnerDeps): BackgroundEvalRunner {
	let leases: BackgroundEvalLease[] = [];

	const reapFinishedAndExpired = async (now: number): Promise<BackgroundEvalLease[]> => {
		const surviving: BackgroundEvalLease[] = [];
		const reaped: BackgroundEvalLease[] = [];
		for (const lease of leases) {
			if (now >= lease.deadlineAt) {
				await deps.stopRun(lease); // overran its deadline — force-stop so it can't hold a slot forever
				reaped.push(lease);
				continue;
			}
			if (await deps.isRunActive(lease)) {
				surviving.push(lease);
			} else {
				reaped.push(lease); // completed naturally (terminal state) — just drop the lease
			}
		}
		leases = surviving;
		return reaped;
	};

	return {
		async recover(): Promise<void> {
			leases = [...(await deps.loadCheckpoint())];
		},

		async tick(): Promise<BackgroundEvalTickOutcome> {
			const now = deps.now();
			const reaped = await reapFinishedAndExpired(now);

			const signals = await deps.getSignals();
			const decision = decideBackgroundEvalAdmission({
				hasInteractiveWork: signals.hasInteractiveWork,
				loadedModelIdle: signals.loadedModelIdle,
				resourceHeadroom: signals.resourceHeadroom,
				runningBackgroundEvals: leases.length,
				maxBackgroundEvals: deps.maxConcurrentEvals,
			});

			let admitted: BackgroundEvalLease | null = null;
			let reason: BackgroundEvalTickReason;
			if (!decision.admit) {
				reason = decision.reason;
			} else {
				const project = await deps.selectNextProject();
				if (project === null) {
					reason = "no_project_to_run";
				} else {
					const started = await deps.startRun(project);
					admitted = {
						runId: started.runId,
						project,
						workspaceId: started.workspaceId,
						startedAt: now,
						deadlineAt: started.deadlineAt,
					};
					leases.push(admitted);
					reason = "admitted";
				}
			}

			await deps.saveCheckpoint(leases);
			return { admitted, reaped, reason, activeLeases: leases.length };
		},

		getLeases(): readonly BackgroundEvalLease[] {
			return leases;
		},
	};
}
