import { describe, expect, it } from "vitest";
import {
	applyDurableSchedulerActions,
	buildDurableJobGraph,
	type DurableJob,
	type DurableSchedulerInput,
	type DurableSchedulerLogEntry,
	decideDurableSchedulerActions,
	isDurableRunComplete,
	markDurableJob,
	replayDurableJobs,
	summarizeDurableRun,
} from "../../../src/core/durable-scheduler";

function job(over: Partial<DurableJob> & { jobId: string }): DurableJob {
	return {
		state: "ready",
		dependsOn: [],
		lease: null,
		attempts: 0,
		nextEligibleAt: 0,
		...over,
	};
}

function input(jobs: DurableJob[], over: Partial<DurableSchedulerInput> = {}): DurableSchedulerInput {
	let counter = 0;
	return {
		jobs,
		now: 1000,
		maxConcurrentLeases: 2,
		leaseDurationMs: 100,
		maxAttempts: 3,
		reclaimBackoffMs: 50,
		mintWorkerId: () => `w${++counter}`,
		...over,
	};
}

describe("decideDurableSchedulerActions", () => {
	it("leases ready jobs up to the concurrency cap, oldest-first", () => {
		const jobs = [job({ jobId: "a" }), job({ jobId: "b" }), job({ jobId: "c" })];
		const actions = decideDurableSchedulerActions(input(jobs, { maxConcurrentLeases: 2 }));
		const leased = actions.filter((a) => a.type === "lease");
		expect(leased).toHaveLength(2);
		expect(leased.map((a) => a.jobId)).toEqual(["a", "b"]);
		expect(leased[0]).toMatchObject({ workerId: "w1", expiresAt: 1100 });
	});

	it("does not lease past the cap when leases are already held", () => {
		const jobs = [
			job({ jobId: "a", state: "leased", lease: { workerId: "x", expiresAt: 9999 }, attempts: 1 }),
			job({ jobId: "b" }),
		];
		const actions = decideDurableSchedulerActions(input(jobs, { maxConcurrentLeases: 1 }));
		expect(actions.filter((a) => a.type === "lease")).toHaveLength(0);
	});

	it("reclaims an expired lease and re-leases it the same tick when a slot is free", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 1 })];
		const actions = decideDurableSchedulerActions(input(jobs, { now: 1000, maxConcurrentLeases: 1 }));
		expect(actions.find((a) => a.type === "reclaim")).toMatchObject({ jobId: "a", reason: "lease_expired" });
		// reclaim freed the only slot; with zero backoff it can re-lease this tick.
		const reclaimedThenLeased = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, reclaimBackoffMs: 0 }),
		);
		expect(reclaimedThenLeased.find((a) => a.type === "lease")).toMatchObject({ jobId: "a" });
	});

	it("respects reclaim backoff (no re-lease until past nextEligibleAt)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 1 })];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, reclaimBackoffMs: 50 }),
		);
		expect(actions.find((a) => a.type === "reclaim")).toBeDefined();
		// With a 50ms backoff the reclaimed job is eligible at 1050, not now → no lease this tick.
		expect(actions.find((a) => a.type === "lease")).toBeUndefined();
	});

	it("fails a job whose lease expired after exhausting the attempt budget", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 3 })];
		const actions = decideDurableSchedulerActions(input(jobs, { now: 1000, maxAttempts: 3 }));
		expect(actions.find((a) => a.type === "fail")).toMatchObject({ jobId: "a", reason: "max_attempts" });
		expect(actions.find((a) => a.type === "reclaim")).toBeUndefined();
	});

	it("unblocks a blocked job once its dependencies all succeed", () => {
		const jobs = [
			job({ jobId: "dep", state: "succeeded" }),
			job({ jobId: "a", state: "blocked", dependsOn: ["dep"] }),
		];
		const actions = decideDurableSchedulerActions(input(jobs));
		expect(actions.find((a) => a.type === "unblock")).toMatchObject({ jobId: "a" });
		// unblocked this tick → also leased this tick (a slot is free, deps met).
		expect(actions.find((a) => a.type === "lease")).toMatchObject({ jobId: "a" });
	});

	it("keeps a job blocked while any dependency is unfinished", () => {
		const jobs = [
			job({ jobId: "dep", state: "leased", lease: { workerId: "x", expiresAt: 9999 }, attempts: 1 }),
			job({ jobId: "a", state: "blocked", dependsOn: ["dep"] }),
		];
		const actions = decideDurableSchedulerActions(input(jobs));
		expect(actions.find((a) => a.jobId === "a")).toBeUndefined();
	});

	it("fails a job whose dependency failed (it can never run)", () => {
		const jobs = [job({ jobId: "dep", state: "failed" }), job({ jobId: "a", state: "blocked", dependsOn: ["dep"] })];
		const actions = decideDurableSchedulerActions(input(jobs));
		expect(actions.find((a) => a.type === "fail")).toMatchObject({ jobId: "a", reason: "dependency_failed" });
	});

	it("returns no actions when everything is terminal", () => {
		const jobs = [job({ jobId: "a", state: "succeeded" }), job({ jobId: "b", state: "failed" })];
		expect(decideDurableSchedulerActions(input(jobs))).toEqual([]);
	});
});

describe("applyDurableSchedulerActions + markDurableJob + isDurableRunComplete", () => {
	it("applies lease/reclaim/unblock/fail transitions", () => {
		let jobs: DurableJob[] = [job({ jobId: "a" })];
		jobs = applyDurableSchedulerActions(jobs, [{ type: "lease", jobId: "a", workerId: "w1", expiresAt: 1100 }], {
			now: 1000,
			reclaimBackoffMs: 50,
		});
		expect(jobs[0]).toMatchObject({ state: "leased", attempts: 1, lease: { workerId: "w1", expiresAt: 1100 } });
		jobs = applyDurableSchedulerActions(jobs, [{ type: "reclaim", jobId: "a", reason: "lease_expired" }], {
			now: 2000,
			reclaimBackoffMs: 50,
		});
		expect(jobs[0]).toMatchObject({ state: "ready", lease: null, nextEligibleAt: 2050, attempts: 1 });
	});

	it("markDurableJob records external completion and ignores terminal jobs", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 1 })];
		const done = markDurableJob(jobs, "a", "succeeded");
		expect(done[0]).toMatchObject({ state: "succeeded", lease: null });
		expect(markDurableJob(done, "a", "failed")[0]?.state).toBe("succeeded"); // already terminal → unchanged
	});

	it("buildDurableJobGraph maps a decompose DAG to jobs (fromTaskId depends on toTaskId)", () => {
		// b depends on a; c depends on b. Edge {from,to} = {dependent, prerequisite}.
		const jobs = buildDurableJobGraph({
			taskIds: ["a", "b", "c"],
			dependencies: [
				{ fromTaskId: "b", toTaskId: "a" },
				{ fromTaskId: "c", toTaskId: "b" },
			],
		});
		expect(jobs.find((j) => j.jobId === "a")).toMatchObject({ state: "ready", dependsOn: [] });
		expect(jobs.find((j) => j.jobId === "b")).toMatchObject({ state: "blocked", dependsOn: ["a"] });
		expect(jobs.find((j) => j.jobId === "c")).toMatchObject({ state: "blocked", dependsOn: ["b"] });
		expect(jobs.map((j) => j.jobId)).toEqual(["a", "b", "c"]); // order preserved
	});

	it("buildDurableJobGraph marks completed cards succeeded and readies their freed dependents; ignores foreign/self edges", () => {
		const jobs = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [
				{ fromTaskId: "b", toTaskId: "a" },
				{ fromTaskId: "a", toTaskId: "a" }, // self-edge ignored
				{ fromTaskId: "b", toTaskId: "ghost" }, // foreign edge ignored
			],
			succeededTaskIds: ["a"],
		});
		expect(jobs.find((j) => j.jobId === "a")?.state).toBe("succeeded");
		// b's only in-graph dep (a) is succeeded → ready.
		expect(jobs.find((j) => j.jobId === "b")).toMatchObject({ state: "ready", dependsOn: ["a"] });
	});

	it("drives a small dependency graph to completion across ticks (restart-survivable shape)", () => {
		// a → b → c (chain); simulate lease → succeed → unblock next, deterministically.
		let jobs: DurableJob[] = [
			job({ jobId: "a" }),
			job({ jobId: "b", state: "blocked", dependsOn: ["a"] }),
			job({ jobId: "c", state: "blocked", dependsOn: ["b"] }),
		];
		const opts = { now: 0, reclaimBackoffMs: 0 };
		let guard = 0;
		while (!isDurableRunComplete(jobs) && guard++ < 20) {
			const actions = decideDurableSchedulerActions(input(jobs, { now: 0, maxConcurrentLeases: 2 }));
			if (actions.length === 0) {
				// nothing schedulable → complete the oldest leased job (the worker reports success).
				const leased = jobs.find((j) => j.state === "leased");
				if (!leased) {
					break;
				}
				jobs = markDurableJob(jobs, leased.jobId, "succeeded");
				continue;
			}
			jobs = applyDurableSchedulerActions(jobs, actions, opts);
		}
		expect(isDurableRunComplete(jobs)).toBe(true);
		expect(jobs.every((j) => j.state === "succeeded")).toBe(true);
	});

	it("replayDurableJobs reconstructs mid-run state from the log (boot-replay resumes exactly)", () => {
		const initial = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [{ fromTaskId: "b", toTaskId: "a" }],
		});
		// Live run up to a crash point: lease a, a succeeds, b unblocks + is leased.
		const log: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 100 } },
			{ kind: "completed", jobId: "a", outcome: "succeeded" },
			{ kind: "scheduled", now: 110, action: { type: "unblock", jobId: "b" } },
			{ kind: "scheduled", now: 110, action: { type: "lease", jobId: "b", workerId: "w2", expiresAt: 210 } },
		];
		const resumed = replayDurableJobs(initial, log, { reclaimBackoffMs: 50 });
		expect(resumed.find((j) => j.jobId === "a")).toMatchObject({ state: "succeeded" });
		expect(resumed.find((j) => j.jobId === "b")).toMatchObject({
			state: "leased",
			attempts: 1,
			lease: { workerId: "w2", expiresAt: 210 },
		});
		// Re-deciding from the replayed state continues identically (b is leased & live → nothing new to do).
		const next = decideDurableSchedulerActions(input(resumed, { now: 150, maxConcurrentLeases: 2 }));
		expect(next).toEqual([]);
	});

	it("replay is deterministic — same log yields the same state", () => {
		const initial = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const log: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 100 } },
			{ kind: "scheduled", now: 200, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
		];
		const a = replayDurableJobs(initial, log, { reclaimBackoffMs: 50 });
		const b = replayDurableJobs(initial, log, { reclaimBackoffMs: 50 });
		expect(a).toEqual(b);
		expect(a[0]).toMatchObject({ state: "ready", lease: null, nextEligibleAt: 250, attempts: 1 });
	});
});

describe("summarizeDurableRun", () => {
	it("counts by state, lists in-flight leases + parked failures, and reports progress", () => {
		const jobs = [
			job({ jobId: "a", state: "succeeded" }),
			job({ jobId: "b", state: "leased", lease: { workerId: "w7", expiresAt: 1234 }, attempts: 1 }),
			job({ jobId: "c", state: "blocked", dependsOn: ["b"] }),
			job({ jobId: "d", state: "failed" }),
		];
		const summary = summarizeDurableRun(jobs);
		expect(summary.total).toBe(4);
		expect(summary.byState).toMatchObject({ succeeded: 1, leased: 1, blocked: 1, failed: 1, ready: 0 });
		expect(summary.leased).toEqual([{ jobId: "b", workerId: "w7", expiresAt: 1234 }]);
		expect(summary.failed).toEqual(["d"]);
		expect(summary.progress).toBe(0.25);
		expect(summary.complete).toBe(false);
	});

	it("is empty-safe (no jobs → zero progress, not complete-by-vacuous-truth ambiguity handled)", () => {
		const summary = summarizeDurableRun([]);
		expect(summary).toMatchObject({ total: 0, progress: 0, complete: true, leased: [], failed: [] });
	});
});
