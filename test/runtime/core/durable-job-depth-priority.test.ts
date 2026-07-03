import { describe, expect, it } from "vitest";
import { withCriticalPathPriority } from "../../../src/core/durable-job-depth-priority";
import type { DurableJob } from "../../../src/core/durable-scheduler";
import { orderReadyJobs } from "../../../src/core/durable-scheduler-ready-order";

/** Build a `DurableJob` with sensible ready defaults; override any field. */
function job(jobId: string, overrides: Partial<DurableJob> = {}): DurableJob {
	return {
		jobId,
		state: "ready",
		dependsOn: [],
		lease: null,
		attempts: 0,
		nextEligibleAt: 0,
		...overrides,
	};
}

/**
 * The blind-spot graph: `deep` is READY with ONE direct dependent that heads a 5-hop chain; `wide` is READY with
 * THREE shallow leaf dependents. To the immediate fan-out signal `wide` (3 dependents) looks more important than
 * `deep` (1 dependent) — but `deep` actually gates the run's longest remaining chain.
 */
function blindSpotGraph(): DurableJob[] {
	return [
		job("deep"),
		job("d1", { state: "blocked", dependsOn: ["deep"] }),
		job("d2", { state: "blocked", dependsOn: ["d1"] }),
		job("d3", { state: "blocked", dependsOn: ["d2"] }),
		job("d4", { state: "blocked", dependsOn: ["d3"] }),
		job("d5", { state: "blocked", dependsOn: ["d4"] }),
		job("wide"),
		job("w1", { state: "blocked", dependsOn: ["wide"] }),
		job("w2", { state: "blocked", dependsOn: ["wide"] }),
		job("w3", { state: "blocked", dependsOn: ["wide"] }),
	];
}

describe("withCriticalPathPriority (§5.AF depth-aware ready ordering)", () => {
	it("folds each remaining job's downstreamDepth into the explicit priority (depthWeight 1 by default)", () => {
		const meta = withCriticalPathPriority({ jobs: blindSpotGraph() });
		// deep heads a 5-hop remaining chain → priority 5; wide heads a 1-hop chain → priority 1.
		expect(meta.deep?.priority).toBe(5);
		expect(meta.wide?.priority).toBe(1);
		// a remaining LEAF (depth 0) with no existing meta is omitted — a priority:0 entry adds nothing.
		expect(meta.w1).toBeUndefined();
		expect(meta.d5).toBeUndefined();
	});

	it("FIXES the fan-out blind spot: wide leads without depth, deep leads once depth is folded in", () => {
		const jobs = blindSpotGraph();
		const now = 1_000_000;

		// Without depth, the shallow-but-wide prerequisite wins the slot on raw fan-out.
		const naive = orderReadyJobs({ jobs, now });
		expect(naive.ordered.map((j) => j.jobId)).toEqual(["wide", "deep"]);

		// Folding the critical-path depth into the priority flips it — the run's true bottleneck leases first.
		const meta = withCriticalPathPriority({ jobs });
		const depthAware = orderReadyJobs({ jobs, now, meta });
		expect(depthAware.ordered.map((j) => j.jobId)).toEqual(["deep", "wide"]);
	});

	it("SUMS the depth boost with an operator-supplied priority and preserves readySince", () => {
		const jobs = blindSpotGraph();
		const meta = withCriticalPathPriority({
			jobs,
			meta: { deep: { priority: 2, readySince: 1000 } },
		});
		expect(meta.deep?.priority).toBe(7); // operator 2 + depth 5
		expect(meta.deep?.readySince).toBe(1000);
	});

	it("scales the boost by depthWeight", () => {
		const meta = withCriticalPathPriority({ jobs: blindSpotGraph(), depthWeight: 10 });
		expect(meta.deep?.priority).toBe(50);
		expect(meta.wide?.priority).toBe(10);
	});

	it("gives no depth entry to a succeeded job (it gates nothing) and shortens the chain behind it", () => {
		const jobs = blindSpotGraph().map((j) => (j.jobId === "deep" ? { ...j, state: "succeeded" as const } : j));
		const meta = withCriticalPathPriority({ jobs });
		expect(meta.deep).toBeUndefined();
		// with deep done, d1 now heads the remaining 4-hop chain (d1→d2→d3→d4→d5).
		expect(meta.d1?.priority).toBe(4);
	});

	it("gives no boost to a job on a dependency cycle (its depth is undefined → 0)", () => {
		// a→b→a is a 2-cycle; both report depth 0 and, with no existing meta, are omitted.
		const jobs = [job("a", { state: "blocked", dependsOn: ["b"] }), job("b", { state: "blocked", dependsOn: ["a"] })];
		const meta = withCriticalPathPriority({ jobs });
		expect(meta.a).toBeUndefined();
		expect(meta.b).toBeUndefined();
	});

	it("still preserves meta for a cycle job that carried operator metadata (priority stays, no depth added)", () => {
		const jobs = [job("a", { state: "blocked", dependsOn: ["b"] }), job("b", { state: "blocked", dependsOn: ["a"] })];
		const meta = withCriticalPathPriority({ jobs, meta: { a: { priority: 3, readySince: 42 } } });
		expect(meta.a).toEqual({ priority: 3, readySince: 42 });
	});
});
