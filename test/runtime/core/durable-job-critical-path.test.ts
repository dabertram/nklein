import { describe, expect, it } from "vitest";
import { analyzeDurableJobCriticalPath } from "../../../src/core/durable-job-critical-path";
import type { DurableJob } from "../../../src/core/durable-scheduler";

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

/** Map of jobId → downstreamDepth for compact assertions. */
function depths(jobs: readonly DurableJob[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const info of analyzeDurableJobCriticalPath(jobs).jobs) {
		out[info.jobId] = info.downstreamDepth;
	}
	return out;
}

describe("analyzeDurableJobCriticalPath", () => {
	it("returns an empty, clearly-summarised result for an empty graph", () => {
		const result = analyzeDurableJobCriticalPath([]);
		expect(result.jobs).toEqual([]);
		expect(result.criticalPath).toEqual([]);
		expect(result.remainingDepth).toBe(0);
		expect(result.hasCycle).toBe(false);
		expect(result.counts).toEqual({ remaining: 0, onCriticalPath: 0, onCycle: 0 });
		expect(result.summary).toBe("No remaining work — the run's critical path is empty.");
	});

	it("a single job is a leaf: depth 0, on the critical path, remainingDepth 0", () => {
		const result = analyzeDurableJobCriticalPath([job("only")]);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs[0]).toMatchObject({
			jobId: "only",
			downstreamDepth: 0,
			directDependents: 0,
			onCycle: false,
			onCriticalPath: true,
		});
		expect(result.criticalPath).toEqual(["only"]);
		expect(result.remainingDepth).toBe(0);
	});

	describe("downstream depth (longest remaining chain)", () => {
		it("counts depth in job-hops down a linear chain a←b←c←d (d depends on c … a is the deepest prerequisite)", () => {
			// Edges: b depends on a, c on b, d on c. So `a` gates the longest chain (a→b→c→d = 3 hops).
			const jobs = [
				job("a"),
				job("b", { state: "blocked", dependsOn: ["a"] }),
				job("c", { state: "blocked", dependsOn: ["b"] }),
				job("d", { state: "blocked", dependsOn: ["c"] }),
			];
			expect(depths(jobs)).toEqual({ a: 3, b: 2, c: 1, d: 0 });
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.criticalPath).toEqual(["a", "b", "c", "d"]);
			expect(result.remainingDepth).toBe(3);
		});

		it("takes the LONGEST branch when a job gates chains of unequal length (a diamond+tail)", () => {
			// root gates two branches: root→short (1) and root→long1→long2→leaf (3). Depth(root) = 3.
			const jobs = [
				job("root"),
				job("short", { state: "blocked", dependsOn: ["root"] }),
				job("long1", { state: "blocked", dependsOn: ["root"] }),
				job("long2", { state: "blocked", dependsOn: ["long1"] }),
				job("leaf", { state: "blocked", dependsOn: ["long2"] }),
			];
			expect(depths(jobs)).toEqual({ root: 3, short: 0, long1: 2, long2: 1, leaf: 0 });
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.criticalPath).toEqual(["root", "long1", "long2", "leaf"]);
			expect(result.remainingDepth).toBe(3);
		});

		it("depth reflects the deepest chain even when a shallow branch has MORE direct dependents (the ready-order blind spot)", () => {
			// `deep` has 1 direct dependent but heads a 3-deep chain; `wide` has 3 direct dependents but all leaves (depth 1).
			// orderReadyJobs (immediate fan-out) would favour `wide`; the critical path is `deep`.
			const jobs = [
				job("deep"),
				job("mid", { state: "blocked", dependsOn: ["deep"] }),
				job("mid2", { state: "blocked", dependsOn: ["mid"] }),
				job("deepleaf", { state: "blocked", dependsOn: ["mid2"] }),
				job("wide"),
				job("w1", { state: "blocked", dependsOn: ["wide"] }),
				job("w2", { state: "blocked", dependsOn: ["wide"] }),
				job("w3", { state: "blocked", dependsOn: ["wide"] }),
			];
			const d = depths(jobs);
			expect(d.deep).toBe(3);
			expect(d.wide).toBe(1);
			const result = analyzeDurableJobCriticalPath(jobs);
			// Deepest first ⇒ `deep` leads and is on the critical path; `wide` (depth 1) is not the head.
			expect(result.jobs[0]?.jobId).toBe("deep");
			expect(result.criticalPath[0]).toBe("deep");
			// But `wide`'s wider immediate fan-out is still exposed for the caller.
			const wide = result.jobs.find((info) => info.jobId === "wide");
			expect(wide?.directDependents).toBe(3);
		});
	});

	describe("direct dependents (immediate fan-out)", () => {
		it("counts only REMAINING jobs that directly depend on a job", () => {
			const jobs = [
				job("hub"),
				job("d1", { state: "blocked", dependsOn: ["hub"] }),
				job("d2", { state: "blocked", dependsOn: ["hub"] }),
				job("indirect", { state: "blocked", dependsOn: ["d1"] }), // depends on hub only transitively
			];
			const hub = analyzeDurableJobCriticalPath(jobs).jobs.find((info) => info.jobId === "hub");
			expect(hub?.directDependents).toBe(2);
		});
	});

	describe("succeeded jobs are excluded and no longer gate", () => {
		it("omits succeeded jobs from `jobs` and does not count them as remaining", () => {
			const jobs = [job("done", { state: "succeeded" }), job("live")];
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.jobs.map((info) => info.jobId)).toEqual(["live"]);
			expect(result.counts.remaining).toBe(1);
		});

		it("a succeeded prerequisite no longer contributes depth (its dependent becomes a remaining leaf)", () => {
			// a is done ⇒ b no longer waits on remaining work through a; b's depth is only via c.
			const jobs = [
				job("a", { state: "succeeded" }),
				job("b", { dependsOn: ["a"] }), // ready now (dep done); still gates c
				job("c", { state: "blocked", dependsOn: ["b"] }),
			];
			expect(depths(jobs)).toEqual({ b: 1, c: 0 });
			// a is gone from the analysis, so the critical path starts at b.
			expect(analyzeDurableJobCriticalPath(jobs).criticalPath).toEqual(["b", "c"]);
		});

		it("a fully-completed run reports no remaining work", () => {
			const result = analyzeDurableJobCriticalPath([
				job("a", { state: "succeeded" }),
				job("b", { state: "succeeded" }),
			]);
			expect(result.jobs).toEqual([]);
			expect(result.remainingDepth).toBe(0);
		});
	});

	describe("cycles are surfaced, never looped", () => {
		it("reports depth 0 + onCycle for a 2-node cycle and flags hasCycle", () => {
			const jobs = [
				job("x", { state: "blocked", dependsOn: ["y"] }),
				job("y", { state: "blocked", dependsOn: ["x"] }),
			];
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.hasCycle).toBe(true);
			expect(result.counts.onCycle).toBe(2);
			for (const info of result.jobs) {
				expect(info.onCycle).toBe(true);
				expect(info.downstreamDepth).toBe(0);
			}
			// No acyclic head ⇒ the critical path is empty (never looped).
			expect(result.criticalPath).toEqual([]);
			expect(result.remainingDepth).toBe(0);
		});

		it("taints jobs UPSTREAM of a cycle (their longest path runs through undefined depth) but leaves an independent chain finite", () => {
			// feeder → a ⇄ b (cycle). feeder is upstream of the cycle ⇒ tainted. `clean`→`cleanleaf` is independent + finite.
			const jobs = [
				job("feeder"),
				job("a", { state: "blocked", dependsOn: ["feeder", "b"] }),
				job("b", { state: "blocked", dependsOn: ["a"] }),
				job("clean"),
				job("cleanleaf", { state: "blocked", dependsOn: ["clean"] }),
			];
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.hasCycle).toBe(true);
			const byId = new Map(result.jobs.map((info) => [info.jobId, info]));
			expect(byId.get("feeder")?.onCycle).toBe(true);
			expect(byId.get("a")?.onCycle).toBe(true);
			expect(byId.get("b")?.onCycle).toBe(true);
			// The independent, acyclic chain is measured normally and becomes the critical path.
			expect(byId.get("clean")?.onCycle).toBe(false);
			expect(byId.get("clean")?.downstreamDepth).toBe(1);
			expect(result.criticalPath).toEqual(["clean", "cleanleaf"]);
		});

		it("a self-loop edge is ignored (not a cycle) — a self-dependent job is a plain leaf", () => {
			const result = analyzeDurableJobCriticalPath([job("solo", { dependsOn: ["solo"] })]);
			expect(result.hasCycle).toBe(false);
			expect(result.jobs[0]).toMatchObject({ jobId: "solo", downstreamDepth: 0, onCycle: false });
		});
	});

	describe("dangling / duplicate / self edges", () => {
		it("ignores an edge to a job that is not in the set (an absent prerequisite does not gate)", () => {
			// b depends on `ghost` (absent) and on a. Only the real `a` edge counts.
			const jobs = [job("a"), job("b", { state: "blocked", dependsOn: ["ghost", "a"] })];
			expect(depths(jobs)).toEqual({ a: 1, b: 0 });
			const b = analyzeDurableJobCriticalPath(jobs).jobs.find((info) => info.jobId === "b");
			expect(b?.directDependents).toBe(0);
		});

		it("de-duplicates a repeated dependency edge (fan-out is counted once)", () => {
			const jobs = [job("a"), job("b", { state: "blocked", dependsOn: ["a", "a", "a"] })];
			const a = analyzeDurableJobCriticalPath(jobs).jobs.find((info) => info.jobId === "a");
			expect(a?.directDependents).toBe(1);
		});

		it("uses the LAST occurrence's fields for a duplicate jobId", () => {
			// The second `dup` (blocked, depends on base) wins; so base gates dup ⇒ depth(base)=1.
			const jobs = [
				job("base"),
				job("dup", { state: "ready", dependsOn: [] }),
				job("dup", { state: "blocked", dependsOn: ["base"] }),
			];
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.jobs.find((info) => info.jobId === "base")?.downstreamDepth).toBe(1);
			// Only one row per id.
			expect(result.jobs.filter((info) => info.jobId === "dup")).toHaveLength(1);
		});
	});

	describe("ordering + tie-breaks", () => {
		it("sorts deepest first, then most direct dependents, then jobId ascending", () => {
			// Two depth-1 jobs: `wide` (2 direct dependents) must precede `narrow` (1). A depth-0 leaf sorts last.
			const jobs = [
				job("narrow"),
				job("nleaf", { state: "blocked", dependsOn: ["narrow"] }),
				job("wide"),
				job("wa", { state: "blocked", dependsOn: ["wide"] }),
				job("wb", { state: "blocked", dependsOn: ["wide"] }),
				job("zleaf"),
			];
			const ordered = analyzeDurableJobCriticalPath(jobs).jobs.map((info) => info.jobId);
			// depth-1 wide (2 deps) → depth-1 narrow (1 dep) → then the depth-0 rows (its dependents + the lone leaf).
			expect(ordered.indexOf("wide")).toBeLessThan(ordered.indexOf("narrow"));
			expect(ordered.indexOf("narrow")).toBeLessThan(ordered.indexOf("zleaf"));
		});

		it("breaks a critical-path reconstruction tie by jobId ascending at each hop", () => {
			// root gates two equal-length (depth-2) branches via `apple`/`banana`; `apple` wins the head-of-branch tie.
			const jobs = [
				job("root"),
				job("banana", { state: "blocked", dependsOn: ["root"] }),
				job("bleaf", { state: "blocked", dependsOn: ["banana"] }),
				job("apple", { state: "blocked", dependsOn: ["root"] }),
				job("aleaf", { state: "blocked", dependsOn: ["apple"] }),
			];
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.criticalPath).toEqual(["root", "apple", "aleaf"]);
			expect(result.remainingDepth).toBe(2);
		});
	});

	describe("summary", () => {
		it("names the remaining depth and the critical-path head", () => {
			const jobs = [
				job("a"),
				job("b", { state: "blocked", dependsOn: ["a"] }),
				job("c", { state: "blocked", dependsOn: ["b"] }),
			];
			const result = analyzeDurableJobCriticalPath(jobs);
			expect(result.summary).toBe("3 job(s) remaining; critical path is 2 hop(s) deep starting at a.");
		});

		it("notes cycles in the summary", () => {
			const result = analyzeDurableJobCriticalPath([
				job("x", { state: "blocked", dependsOn: ["y"] }),
				job("y", { state: "blocked", dependsOn: ["x"] }),
			]);
			expect(result.summary).toContain("2 job(s) on a dependency cycle");
		});
	});

	describe("purity + determinism", () => {
		it("does not mutate the input jobs or their dependsOn arrays", () => {
			const deps = ["a"];
			const jobs = [job("a"), job("b", { state: "blocked", dependsOn: deps })];
			const snapshot = JSON.parse(JSON.stringify(jobs));
			analyzeDurableJobCriticalPath(jobs);
			expect(jobs).toEqual(snapshot);
			expect(deps).toEqual(["a"]); // the shared array reference is untouched
		});

		it("is deterministic: input order does not change depths, path, or the sorted result", () => {
			const base = [
				job("a"),
				job("b", { state: "blocked", dependsOn: ["a"] }),
				job("c", { state: "blocked", dependsOn: ["b"] }),
				job("side"),
				job("sleaf", { state: "blocked", dependsOn: ["side"] }),
			];
			const shuffled = [base[4], base[1], base[3], base[0], base[2]] as DurableJob[];
			const first = analyzeDurableJobCriticalPath(base);
			const second = analyzeDurableJobCriticalPath(shuffled);
			expect(second.jobs).toEqual(first.jobs);
			expect(second.criticalPath).toEqual(first.criticalPath);
			expect(second.remainingDepth).toEqual(first.remainingDepth);
			expect(second.summary).toEqual(first.summary);
		});
	});

	it("handles a broad shallow graph (many leaves) with remainingDepth 1", () => {
		const jobs = [
			job("hub"),
			...Array.from({ length: 12 }, (_, i) => job(`leaf-${i}`, { state: "blocked", dependsOn: ["hub"] })),
		];
		const result = analyzeDurableJobCriticalPath(jobs);
		expect(result.jobs.find((info) => info.jobId === "hub")?.downstreamDepth).toBe(1);
		expect(result.remainingDepth).toBe(1);
		expect(result.criticalPath[0]).toBe("hub");
		expect(result.criticalPath).toHaveLength(2);
	});
});
