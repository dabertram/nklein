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
	renewDurableLease,
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

	// Group A — input sanitization (:100-103)
	it("T01 clamps maxConcurrentLeases to 1 when below 1", () => {
		const jobs = [job({ jobId: "a" }), job({ jobId: "b" })];
		const actions = decideDurableSchedulerActions(input(jobs, { maxConcurrentLeases: 0 }));
		const leased = actions.filter((a) => a.type === "lease");
		expect(leased).toHaveLength(1);
		expect(leased[0]).toMatchObject({ jobId: "a" });
	});

	it("T02 truncates a non-integer maxConcurrentLeases", () => {
		const jobs = [job({ jobId: "a" }), job({ jobId: "b" }), job({ jobId: "c" })];
		const actions = decideDurableSchedulerActions(input(jobs, { maxConcurrentLeases: 2.9 }));
		const leased = actions.filter((a) => a.type === "lease");
		expect(leased.map((a) => a.jobId)).toEqual(["a", "b"]);
	});

	it("T03 clamps leaseDurationMs below 1 to 1 (expiresAt = now + 1)", () => {
		const jobs = [job({ jobId: "a" })];
		const actions = decideDurableSchedulerActions(input(jobs, { now: 1000, leaseDurationMs: 0.5 }));
		expect(actions.find((a) => a.type === "lease")).toMatchObject({ jobId: "a", expiresAt: 1001 });
	});

	it("T04 clamps a negative reclaimBackoffMs to 0 so a reclaim re-leases the same tick", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 1 })];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, reclaimBackoffMs: -100 }),
		);
		expect(actions.find((a) => a.type === "reclaim")).toMatchObject({ jobId: "a" });
		expect(actions.find((a) => a.type === "lease")).toMatchObject({ jobId: "a" });
	});

	it("T05 truncates a non-integer maxAttempts and still fails at the floor", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 3 })];
		const actions = decideDurableSchedulerActions(input(jobs, { now: 1000, maxAttempts: 3.9 }));
		expect(actions.find((a) => a.type === "fail")).toMatchObject({ jobId: "a", reason: "max_attempts" });
	});

	it("T06 truncates a non-integer reclaimBackoffMs when computing re-lease eligibility", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 1 })];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, reclaimBackoffMs: 50.9 }),
		);
		// trunc → 50 ⇒ eligibleAt = 1050 > 1000 ⇒ reclaim but no re-lease this tick.
		expect(actions.find((a) => a.type === "reclaim")).toBeDefined();
		expect(actions.find((a) => a.type === "lease")).toBeUndefined();
	});

	it("T07 (regression, B1 NaN fix) fails a budget-spent expired lease instead of reclaiming it forever", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "dead", expiresAt: 500 }, attempts: 99 })];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, maxAttempts: Number.NaN }),
		);
		// Fixed contract: NaN maxAttempts is floored to 1, so attempts(99) >= 1 ⇒ fail, never reclaim/lease.
		expect(actions.find((a) => a.type === "fail")).toMatchObject({ jobId: "a", reason: "max_attempts" });
		expect(actions.find((a) => a.type === "reclaim")).toBeUndefined();
		expect(actions.find((a) => a.type === "lease")).toBeUndefined();
	});

	// Group B — dependency + lease logic
	it("T08 fails a ready job behind a failed dep and does not lease it (failedThisTick guard)", () => {
		const jobs = [job({ jobId: "dep", state: "failed" }), job({ jobId: "a", state: "ready", dependsOn: ["dep"] })];
		const actions = decideDurableSchedulerActions(input(jobs));
		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({ type: "fail", jobId: "a", reason: "dependency_failed" });
	});

	it("T09 skips leasing when a dependency has not yet succeeded", () => {
		const jobs = [
			job({ jobId: "dep", state: "leased", lease: { workerId: "x", expiresAt: 9999 }, attempts: 1 }),
			job({ jobId: "a", state: "ready", dependsOn: ["dep"] }),
		];
		expect(decideDurableSchedulerActions(input(jobs))).toEqual([]);
	});

	it("T10 reclaims at the exact expiresAt === now boundary (strict >)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "d", expiresAt: 1000 }, attempts: 1 })];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, reclaimBackoffMs: 0 }),
		);
		expect(actions.find((a) => a.type === "reclaim")).toMatchObject({ jobId: "a" });
		expect(actions.find((a) => a.type === "lease")).toMatchObject({ jobId: "a" });
	});

	it("T11 leases at the exact nextEligibleAt === now boundary (strict >)", () => {
		const jobs = [job({ jobId: "a", state: "ready", nextEligibleAt: 1000 })];
		const actions = decideDurableSchedulerActions(input(jobs, { now: 1000 }));
		expect(actions.find((a) => a.type === "lease")).toMatchObject({ jobId: "a" });
	});

	it("T12 reclaims/fails mixed expired leases and reuses freed slots in input order", () => {
		const jobs = [
			job({ jobId: "a", state: "leased", lease: { workerId: "d", expiresAt: 500 }, attempts: 1 }),
			job({ jobId: "b", state: "leased", lease: { workerId: "d", expiresAt: 500 }, attempts: 3 }),
			job({ jobId: "c", state: "leased", lease: { workerId: "d", expiresAt: 500 }, attempts: 1 }),
		];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 3, maxAttempts: 3, reclaimBackoffMs: 0 }),
		);
		expect(actions).toEqual([
			{ type: "reclaim", jobId: "a", reason: "lease_expired" },
			{ type: "fail", jobId: "b", reason: "max_attempts" },
			{ type: "reclaim", jobId: "c", reason: "lease_expired" },
			{ type: "lease", jobId: "a", workerId: "w1", expiresAt: 1100 },
			{ type: "lease", jobId: "c", workerId: "w2", expiresAt: 1100 },
		]);
	});

	it("T12b re-leases only one job when a single freed slot is contested", () => {
		const jobs = [
			job({ jobId: "a", state: "leased", lease: { workerId: "d", expiresAt: 500 }, attempts: 1 }),
			job({ jobId: "b", state: "leased", lease: { workerId: "d", expiresAt: 500 }, attempts: 1 }),
		];
		const actions = decideDurableSchedulerActions(
			input(jobs, { now: 1000, maxConcurrentLeases: 1, reclaimBackoffMs: 0 }),
		);
		expect(actions).toEqual([
			{ type: "reclaim", jobId: "a", reason: "lease_expired" },
			{ type: "reclaim", jobId: "b", reason: "lease_expired" },
			{ type: "lease", jobId: "a", workerId: "w1", expiresAt: 1100 },
		]);
	});

	it("T13 fails (does not unblock) a blocked job with a mix of failed and succeeded deps", () => {
		const jobs = [
			job({ jobId: "d1", state: "failed" }),
			job({ jobId: "d2", state: "succeeded" }),
			job({ jobId: "a", state: "blocked", dependsOn: ["d1", "d2"] }),
		];
		const actions = decideDurableSchedulerActions(input(jobs));
		const forA = actions.filter((a) => a.jobId === "a");
		expect(forA).toEqual([{ type: "fail", jobId: "a", reason: "dependency_failed" }]);
	});

	it("T14 never touches terminal jobs and they do not consume concurrency slots", () => {
		const jobs = [
			job({ jobId: "s", state: "succeeded" }),
			job({ jobId: "f", state: "failed" }),
			job({ jobId: "a", state: "ready" }),
		];
		const actions = decideDurableSchedulerActions(input(jobs, { maxConcurrentLeases: 2 }));
		expect(actions).toEqual([{ type: "lease", jobId: "a", workerId: "w1", expiresAt: 1100 }]);
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

	// Group C — applyDurableSchedulerActions arms in isolation
	it("T15a applies the unblock arm (blocked → ready, lease untouched)", () => {
		const jobs = [job({ jobId: "a", state: "blocked", dependsOn: ["x"] })];
		const out = applyDurableSchedulerActions(jobs, [{ type: "unblock", jobId: "a" }], {
			now: 1000,
			reclaimBackoffMs: 50,
		});
		expect(out[0]).toMatchObject({ state: "ready", dependsOn: ["x"], lease: null, attempts: 0 });
	});

	it("T15b applies the fail arm (leased → failed, lease dropped, attempts kept)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 3 })];
		const out = applyDurableSchedulerActions(jobs, [{ type: "fail", jobId: "a", reason: "max_attempts" }], {
			now: 1000,
			reclaimBackoffMs: 50,
		});
		expect(out[0]).toMatchObject({ state: "failed", lease: null, attempts: 3 });
	});

	it("T15c skips an action whose jobId is unknown (snapshot unchanged)", () => {
		const jobs = [job({ jobId: "a", state: "ready" })];
		const out = applyDurableSchedulerActions(
			jobs,
			[{ type: "lease", jobId: "ghost", workerId: "w1", expiresAt: 100 }],
			{ now: 1000, reclaimBackoffMs: 50 },
		);
		expect(out).toEqual([job({ jobId: "a" })]);
	});

	it("T15d clamps a negative reclaimBackoffMs to now on the reclaim arm", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 1 })];
		const out = applyDurableSchedulerActions(jobs, [{ type: "reclaim", jobId: "a", reason: "lease_expired" }], {
			now: 2000,
			reclaimBackoffMs: -500,
		});
		expect(out[0]).toMatchObject({ state: "ready", lease: null, nextEligibleAt: 2000, attempts: 1 });
	});

	it("T15e truncates a non-integer reclaimBackoffMs on the reclaim arm", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 1 })];
		const out = applyDurableSchedulerActions(jobs, [{ type: "reclaim", jobId: "a", reason: "lease_expired" }], {
			now: 2000,
			reclaimBackoffMs: 50.9,
		});
		expect(out[0]).toMatchObject({ nextEligibleAt: 2050 });
	});

	// Group D — markDurableJob non-transient transitions
	it("T16 leaves an unknown jobId as the same reference (no-op)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 1 })];
		const out = markDurableJob(jobs, "ghost", "succeeded");
		expect(out[0]).toBe(jobs[0]);
	});

	// SUSPECTED S2: markDurableJob only guards succeeded/failed, so a non-leased (blocked/ready) job is mutated by an
	// external completion. PIN-CURRENT-BEHAVIOR (contract: external completion is state-agnostic); no source change.
	it("T17 marks a blocked (non-leased) job succeeded (SUSPECTED S2 — pins current behavior)", () => {
		const jobs = [job({ jobId: "a", state: "blocked", dependsOn: ["x"] })];
		const out = markDurableJob(jobs, "a", "succeeded");
		expect(out[0]).toMatchObject({ state: "succeeded", lease: null, dependsOn: ["x"] });
	});

	// SUSPECTED S2: a not-yet-leased `ready` job is accepted as a terminal completion. PIN-CURRENT-BEHAVIOR.
	it("T18 marks a ready (non-leased) job failed (SUSPECTED S2 — pins current behavior)", () => {
		const jobs = [job({ jobId: "a", state: "ready" })];
		const out = markDurableJob(jobs, "a", "failed");
		expect(out[0]).toMatchObject({ state: "failed", lease: null });
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

	it("T26 counts a leased job with a null lease but yields no lease row (defensive)", () => {
		const summary = summarizeDurableRun([job({ jobId: "a", state: "leased", lease: null, attempts: 1 })]);
		expect(summary.byState.leased).toBe(1);
		expect(summary.leased).toEqual([]);
		expect(summary.failed).toEqual([]);
		expect(summary.progress).toBe(0);
		expect(summary.complete).toBe(false);
	});

	it("T27 preserves input order for the leased and failed lists across interleaved jobs", () => {
		const jobs = [
			job({ jobId: "f1", state: "failed" }),
			job({ jobId: "L1", state: "leased", lease: { workerId: "w1", expiresAt: 11 }, attempts: 1 }),
			job({ jobId: "f2", state: "failed" }),
			job({ jobId: "L2", state: "leased", lease: { workerId: "w2", expiresAt: 22 }, attempts: 1 }),
		];
		const summary = summarizeDurableRun(jobs);
		expect(summary.failed).toEqual(["f1", "f2"]);
		expect(summary.leased.map((r) => r.jobId)).toEqual(["L1", "L2"]);
	});

	it("T28 reports progress 1 and complete when every job has succeeded", () => {
		const summary = summarizeDurableRun([
			job({ jobId: "a", state: "succeeded" }),
			job({ jobId: "b", state: "succeeded" }),
		]);
		expect(summary.progress).toBe(1);
		expect(summary.complete).toBe(true);
		expect(summary.byState.succeeded).toBe(2);
	});
});

describe("markDurableJob — transient_retry (§5.AF)", () => {
	it("returns a leased job to ready (one attempt burnt) when budget remains", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9999 }, attempts: 1 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry", 3);
		expect(a).toMatchObject({ state: "ready", lease: null, attempts: 2, nextEligibleAt: 0 });
	});

	it("FAILS the job instead of retrying once the attempt would reach maxAttempts (bounds a flaky endpoint)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9999 }, attempts: 2 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry", 3); // attempts+1 = 3 >= 3 → fail
		expect(a).toMatchObject({ state: "failed", lease: null });
	});

	it("replays deterministically: a transient_retry log entry folds to the same state with the same maxAttempts", () => {
		const initial = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9999 }, attempts: 1 })];
		const log = [{ kind: "completed" as const, jobId: "a", outcome: "transient_retry" as const }];
		const once = replayDurableJobs(initial, log, { reclaimBackoffMs: 100, maxAttempts: 3 });
		const twice = replayDurableJobs(initial, log, { reclaimBackoffMs: 100, maxAttempts: 3 });
		expect(once).toEqual(twice);
		expect(once[0]).toMatchObject({ state: "ready", attempts: 2 });
	});

	// SUSPECTED S1: on the transient → fail branch the returned job keeps its PRE-increment attempts (the incremented
	// `attempts` local is only spread on the ready branch). PIN-CURRENT-BEHAVIOR (terminal ⇒ attempts is cosmetic); no
	// source change — a reader expecting the tripping attempt recorded is the open question.
	it("T19 keeps the pre-increment attempts on the transient fail branch (SUSPECTED S1 — pins current behavior)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 2 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry", 3);
		expect(a).toMatchObject({ state: "failed", lease: null, attempts: 2 });
	});

	it("T20 (regression, B2 NaN fix) fails a transient retry with NaN maxAttempts instead of looping to ready", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 99 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry", Number.NaN);
		// Fixed contract: NaN budget floored to 1, so attempts(99)+1 >= 1 ⇒ failed, never ready.
		expect(a).toMatchObject({ state: "failed", lease: null });
	});

	it("T21 clamps a transient maxAttempts below 1 to 1 (fails on the first attempt)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 0 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry", 0);
		expect(a).toMatchObject({ state: "failed", lease: null });
	});

	it("T22 returns to ready under the default MAX_SAFE_INTEGER maxAttempts", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 5 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry");
		expect(a).toMatchObject({ state: "ready", lease: null, attempts: 6, nextEligibleAt: 0 });
	});

	it("T23 truncates a non-integer transient maxAttempts before the budget check", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 2 })];
		const [a] = markDurableJob(jobs, "a", "transient_retry", 3.9);
		// trunc → 3 ⇒ attempts(2)+1 = 3 >= 3 ⇒ failed.
		expect(a).toMatchObject({ state: "failed", lease: null });
	});
});

describe("renewDurableLease (heartbeat)", () => {
	it("extends a leased job's expiry; leaves a non-leased job untouched", () => {
		const jobs = [
			job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 100 }, attempts: 1 }),
			job({ jobId: "b", state: "ready" }),
		];
		expect(renewDurableLease(jobs, "a", 500)[0]?.lease?.expiresAt).toBe(500);
		expect(renewDurableLease(jobs, "b", 500)[1]).toEqual(jobs[1]); // ready ⇒ no-op
	});

	it("T24 leaves an unknown jobId as the same reference (no-op)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 100 }, attempts: 1 })];
		const out = renewDurableLease(jobs, "ghost", 500);
		expect(out[0]).toBe(jobs[0]);
	});

	it("T25 leaves a leased job whose lease is null untouched (defensive lease !== null)", () => {
		const jobs = [job({ jobId: "a", state: "leased", lease: null, attempts: 1 })];
		const out = renewDurableLease(jobs, "a", 500);
		expect(out[0]).toBe(jobs[0]);
	});
});

describe("isDurableRunComplete", () => {
	it("T29 is false when any job is still non-terminal", () => {
		const jobs = [job({ jobId: "a", state: "succeeded" }), job({ jobId: "b", state: "ready" })];
		expect(isDurableRunComplete(jobs)).toBe(false);
	});

	it("T30 is true for the empty array and for all-terminal mixed states", () => {
		expect(isDurableRunComplete([])).toBe(true);
		expect(
			isDurableRunComplete([job({ jobId: "a", state: "succeeded" }), job({ jobId: "b", state: "failed" })]),
		).toBe(true);
	});
});

describe("buildDurableJobGraph — cycles, ghost-succeeded, diamond, multi-dep", () => {
	it("T31 leaves both jobs of a 2-cycle blocked (surfaces the bad graph, does not loop)", () => {
		const jobs = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [
				{ fromTaskId: "a", toTaskId: "b" },
				{ fromTaskId: "b", toTaskId: "a" },
			],
		});
		expect(jobs.find((j) => j.jobId === "a")).toMatchObject({ state: "blocked", dependsOn: ["b"] });
		expect(jobs.find((j) => j.jobId === "b")).toMatchObject({ state: "blocked", dependsOn: ["a"] });
		expect(jobs.map((j) => j.jobId)).toEqual(["a", "b"]);
	});

	// SUSPECTED S3: a succeededTaskIds entry NOT in taskIds never becomes a job; an edge to it is foreign and dropped,
	// so the dependent loses its prerequisite and goes ready. PIN-CURRENT-BEHAVIOR (foreign edges ignored by contract).
	it("T32 readies a dependent whose only edge points at a ghost succeeded id (SUSPECTED S3 — pins current behavior)", () => {
		const jobs = buildDurableJobGraph({
			taskIds: ["a", "b"],
			dependencies: [{ fromTaskId: "b", toTaskId: "ghost" }],
			succeededTaskIds: ["ghost"],
		});
		expect(jobs.find((j) => j.jobId === "b")).toMatchObject({ state: "ready", dependsOn: [] });
		expect(jobs.find((j) => j.jobId === "a")).toMatchObject({ state: "ready" });
	});

	it("T33 maps a diamond graph (b,c depend on a; d depends on b,c) preserving order", () => {
		const jobs = buildDurableJobGraph({
			taskIds: ["a", "b", "c", "d"],
			dependencies: [
				{ fromTaskId: "b", toTaskId: "a" },
				{ fromTaskId: "c", toTaskId: "a" },
				{ fromTaskId: "d", toTaskId: "b" },
				{ fromTaskId: "d", toTaskId: "c" },
			],
		});
		expect(jobs.find((j) => j.jobId === "a")).toMatchObject({ state: "ready", dependsOn: [] });
		expect(jobs.find((j) => j.jobId === "b")).toMatchObject({ state: "blocked", dependsOn: ["a"] });
		expect(jobs.find((j) => j.jobId === "c")).toMatchObject({ state: "blocked", dependsOn: ["a"] });
		expect(jobs.find((j) => j.jobId === "d")).toMatchObject({ state: "blocked", dependsOn: ["b", "c"] });
		expect(jobs.map((j) => j.jobId)).toEqual(["a", "b", "c", "d"]);
	});

	it("T34 readies a multi-dep job only when ALL deps are pre-succeeded, else blocks it", () => {
		const allMet = buildDurableJobGraph({
			taskIds: ["a", "b", "c"],
			dependencies: [
				{ fromTaskId: "c", toTaskId: "a" },
				{ fromTaskId: "c", toTaskId: "b" },
			],
			succeededTaskIds: ["a", "b"],
		});
		expect(allMet.find((j) => j.jobId === "c")).toMatchObject({ state: "ready", dependsOn: ["a", "b"] });
		const someMet = buildDurableJobGraph({
			taskIds: ["a", "b", "c"],
			dependencies: [
				{ fromTaskId: "c", toTaskId: "a" },
				{ fromTaskId: "c", toTaskId: "b" },
			],
			succeededTaskIds: ["a"],
		});
		expect(someMet.find((j) => j.jobId === "c")).toMatchObject({ state: "blocked" });
	});
});

describe("replayDurableJobs — skip/identity/backoff/budget", () => {
	it("T35 skips a scheduled action whose jobId is absent from the initial jobs (no ghost row)", () => {
		const initial = [job({ jobId: "a", state: "ready" })];
		const log: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "ghost", workerId: "w1", expiresAt: 100 } },
		];
		const out = replayDurableJobs(initial, log, { reclaimBackoffMs: 50 });
		expect(out).toEqual([job({ jobId: "a", state: "ready" })]);
	});

	it("T36 is the identity for an empty log, cloning rather than sharing the initial jobs", () => {
		const initial = [job({ jobId: "a", state: "ready", attempts: 2 })];
		const out = replayDurableJobs(initial, [], { reclaimBackoffMs: 50 });
		expect(out).toEqual(initial);
		expect(out[0]).not.toBe(initial[0]);
	});

	it("T37 anchors a reclaim's backoff window to the logged clock, not the live now", () => {
		const initial = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 1 })];
		const log: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 2000, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
		];
		const out = replayDurableJobs(initial, log, { reclaimBackoffMs: 50 });
		expect(out.find((j) => j.jobId === "a")).toMatchObject({
			state: "ready",
			lease: null,
			nextEligibleAt: 2050,
			attempts: 1,
		});
	});

	it("T38 threads options.maxAttempts into a replayed transient_retry's fail/ready decision", () => {
		const initial = [job({ jobId: "a", state: "leased", lease: { workerId: "w", expiresAt: 9 }, attempts: 2 })];
		const log: DurableSchedulerLogEntry[] = [{ kind: "completed", jobId: "a", outcome: "transient_retry" }];
		const failed = replayDurableJobs(initial, log, { reclaimBackoffMs: 100, maxAttempts: 3 });
		expect(failed.find((j) => j.jobId === "a")).toMatchObject({ state: "failed" });
		const retried = replayDurableJobs(initial, log, { reclaimBackoffMs: 100, maxAttempts: 5 });
		expect(retried.find((j) => j.jobId === "a")).toMatchObject({ state: "ready", attempts: 3 });
	});
});
