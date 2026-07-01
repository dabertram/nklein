import { describe, expect, it } from "vitest";
import type { DurableJob } from "../../../src/core/durable-scheduler";
import { type OrderReadyJobsInput, orderReadyJobs } from "../../../src/core/durable-scheduler-ready-order";

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

/** Convenience: ordered job ids after prioritizing. */
function orderedIds(input: OrderReadyJobsInput): string[] {
	return orderReadyJobs(input).ordered.map((row) => row.jobId);
}

const NOW = 1_000_000;

describe("orderReadyJobs", () => {
	it("orders ONLY ready jobs, ignoring every other state", () => {
		const result = orderReadyJobs({
			jobs: [
				job("blocked-1", { state: "blocked", dependsOn: ["done-1"] }),
				job("ready-1"),
				job("leased-1", { state: "leased", lease: { workerId: "w", expiresAt: NOW + 1 } }),
				job("done-1", { state: "succeeded" }),
				job("failed-1", { state: "failed" }),
				job("ready-2"),
			],
			now: NOW,
		});
		expect(result.ordered.map((row) => row.jobId).sort()).toEqual(["ready-1", "ready-2"]);
		expect(result.counts.ready).toBe(2);
	});

	it("returns an empty result (and a clear summary) when there are no ready jobs", () => {
		const result = orderReadyJobs({
			jobs: [
				job("a", { state: "succeeded" }),
				job("b", { state: "leased", lease: { workerId: "w", expiresAt: 1 } }),
			],
			now: NOW,
		});
		expect(result.ordered).toEqual([]);
		expect(result.selected).toEqual([]);
		expect(result.counts).toEqual({ ready: 0, selected: 0, withDependents: 0, prioritized: 0, aged: 0 });
		expect(result.summary).toBe("No ready jobs to order.");
	});

	it("with no signals at all, falls back to a stable jobId-ascending order", () => {
		expect(orderedIds({ jobs: [job("c"), job("a"), job("b")], now: NOW })).toEqual(["a", "b", "c"]);
	});

	describe("fan-out (critical-unblock) signal", () => {
		it("ranks a high-fan-out prerequisite ahead of an independent leaf", () => {
			// hub is depended on by 3 blocked jobs; leaf unblocks nothing.
			const jobs = [
				job("leaf"),
				job("hub"),
				job("d1", { state: "blocked", dependsOn: ["hub"] }),
				job("d2", { state: "blocked", dependsOn: ["hub"] }),
				job("d3", { state: "blocked", dependsOn: ["hub"] }),
			];
			const result = orderReadyJobs({ jobs, now: NOW });
			expect(result.ordered[0]?.jobId).toBe("hub");
			expect(result.ordered[0]?.signals.fanOut).toBe(3);
			expect(result.ordered[1]?.jobId).toBe("leaf");
			expect(result.ordered[1]?.signals.fanOut).toBe(0);
		});

		it("counts a dependent at each of its prerequisites (fan-out is per-prerequisite)", () => {
			const jobs = [job("p1"), job("p2"), job("child", { state: "blocked", dependsOn: ["p1", "p2"] })];
			const result = orderReadyJobs({ jobs, now: NOW });
			expect(result.ordered.find((row) => row.jobId === "p1")?.signals.fanOut).toBe(1);
			expect(result.ordered.find((row) => row.jobId === "p2")?.signals.fanOut).toBe(1);
		});

		it("does NOT count an already-succeeded dependent (it adds no unblock value)", () => {
			const jobs = [
				job("hub"),
				job("still-waiting", { state: "blocked", dependsOn: ["hub"] }),
				job("already-done", { state: "succeeded", dependsOn: ["hub"] }),
			];
			const result = orderReadyJobs({ jobs, now: NOW });
			// Only the not-yet-succeeded dependent counts.
			expect(result.ordered.find((row) => row.jobId === "hub")?.signals.fanOut).toBe(1);
		});

		it("caps fan-out at fanOutCap so one hub cannot dominate unboundedly", () => {
			const dependents = Array.from({ length: 10 }, (_, i) =>
				job(`d${i}`, { state: "blocked", dependsOn: ["hub"] }),
			);
			const result = orderReadyJobs({
				jobs: [job("hub"), ...dependents],
				now: NOW,
				weights: { fanOutCap: 3 },
			});
			expect(result.ordered.find((row) => row.jobId === "hub")?.signals.fanOut).toBe(3);
		});

		it("counts withDependents correctly", () => {
			const jobs = [job("hub"), job("leaf"), job("d", { state: "blocked", dependsOn: ["hub"] })];
			expect(orderReadyJobs({ jobs, now: NOW }).counts.withDependents).toBe(1);
		});
	});

	describe("explicit priority signal", () => {
		it("ranks a caller-prioritized job ahead of an unprioritized one", () => {
			const jobs = [job("normal"), job("urgent")];
			const result = orderReadyJobs({ jobs, now: NOW, meta: { urgent: { priority: 5 } } });
			expect(result.ordered[0]?.jobId).toBe("urgent");
			expect(result.ordered[0]?.signals.prioritized).toBe(true);
			expect(result.ordered[1]?.signals.prioritized).toBe(false);
			expect(result.counts.prioritized).toBe(1);
		});

		it("a negative priority pushes a job DOWN (below a neutral one)", () => {
			const jobs = [job("neutral"), job("deprioritized")];
			const result = orderReadyJobs({ jobs, now: NOW, meta: { deprioritized: { priority: -5 } } });
			expect(result.ordered[0]?.jobId).toBe("neutral");
			expect(result.ordered[1]?.jobId).toBe("deprioritized");
			// A negative priority is not "prioritized" (positive-only flag).
			expect(result.ordered.find((row) => row.jobId === "deprioritized")?.signals.prioritized).toBe(false);
		});

		it("ignores a non-finite priority (treats it as 0)", () => {
			const jobs = [job("a"), job("b")];
			const result = orderReadyJobs({ jobs, now: NOW, meta: { b: { priority: Number.NaN } } });
			// NaN priority => 0 => falls back to jobId order, and NOT flagged prioritized.
			expect(result.ordered.map((row) => row.jobId)).toEqual(["a", "b"]);
			expect(result.counts.prioritized).toBe(0);
		});
	});

	describe("starvation / anti-starvation signals", () => {
		it("boosts a repeatedly-retried (reclaimed) job over a fresh one", () => {
			const jobs = [job("fresh", { attempts: 0 }), job("retried", { attempts: 3 })];
			const result = orderReadyJobs({ jobs, now: NOW });
			expect(result.ordered[0]?.jobId).toBe("retried");
			expect(result.ordered[0]?.signals.attempts).toBe(3);
		});

		it("caps the attempt boost at attemptCap", () => {
			const result = orderReadyJobs({
				jobs: [job("hammered", { attempts: 99 })],
				now: NOW,
				weights: { attemptCap: 2 },
			});
			expect(result.ordered[0]?.signals.attempts).toBe(2);
		});

		it("gives an aged job the anti-starvation boost once it has waited long enough", () => {
			const jobs = [job("recent"), job("old")];
			const result = orderReadyJobs({
				jobs,
				now: NOW,
				meta: {
					recent: { readySince: NOW - 1_000 }, // 1s ago — not aged
					old: { readySince: NOW - 120_000 }, // 2 min ago — aged
				},
				weights: { ageBoostAfterMs: 60_000 },
			});
			expect(result.ordered[0]?.jobId).toBe("old");
			expect(result.ordered[0]?.signals.aged).toBe(true);
			expect(result.ordered.find((row) => row.jobId === "recent")?.signals.aged).toBe(false);
			expect(result.counts.aged).toBe(1);
		});

		it("the aged boost is a single bounded step (not a runaway ramp) — a huge fan-out still outranks a merely-aged leaf", () => {
			const dependents = Array.from({ length: 5 }, (_, i) => job(`d${i}`, { state: "blocked", dependsOn: ["hub"] }));
			const result = orderReadyJobs({
				jobs: [job("hub"), job("aged-leaf"), ...dependents],
				now: NOW,
				meta: { "aged-leaf": { readySince: NOW - 10_000_000 } }, // ancient, but still one flat boost
				weights: { fanOut: 40, agedBoost: 30 },
			});
			// hub: 5*40 = 200 vs aged-leaf: 30 — fan-out wins.
			expect(result.ordered[0]?.jobId).toBe("hub");
		});

		it("does not age a job whose readySince is unknown", () => {
			const result = orderReadyJobs({ jobs: [job("no-ts")], now: NOW });
			expect(result.ordered[0]?.signals.aged).toBe(false);
			expect(result.ordered[0]?.readySince).toBeNull();
		});

		it("a non-finite now disables the aged boost (no crash)", () => {
			const result = orderReadyJobs({
				jobs: [job("x")],
				now: Number.NaN,
				meta: { x: { readySince: 0 } },
			});
			expect(result.ordered[0]?.signals.aged).toBe(false);
		});
	});

	describe("deterministic tie-breaks", () => {
		it("equal score → FEWER remaining (not-yet-succeeded) dependencies first", () => {
			// Both jobs have fan-out 0 (score 0). `near` has 1 remaining (not-yet-succeeded) dep, `far` has 2 → near first.
			// (A ready job with an unsatisfied dep is contrived, but the count is still computed faithfully for the tie-break.)
			const jobs = [
				job("far", { dependsOn: ["s1", "p1", "p2"] }),
				job("near", { dependsOn: ["s1", "p1"] }),
				job("s1", { state: "succeeded" }),
				job("p1", { state: "blocked" }),
				job("p2", { state: "blocked" }),
			];
			const result = orderReadyJobs({ jobs, now: NOW });
			const ready = result.ordered.map((row) => row.jobId);
			expect(ready.indexOf("near")).toBeLessThan(ready.indexOf("far"));
			expect(result.ordered.find((row) => row.jobId === "near")?.remainingDeps).toBe(1);
			expect(result.ordered.find((row) => row.jobId === "far")?.remainingDeps).toBe(2);
		});

		it("remainingDeps counts only NOT-yet-succeeded dependencies", () => {
			const jobs = [
				job("j", { dependsOn: ["done-a", "done-b"] }),
				job("done-a", { state: "succeeded" }),
				job("done-b", { state: "succeeded" }),
			];
			// All deps succeeded => 0 remaining (that is why j is ready).
			expect(orderReadyJobs({ jobs, now: NOW }).ordered[0]?.remainingDeps).toBe(0);
		});

		it("equal score + equal remaining deps → EARLIER readySince (FIFO) first", () => {
			const jobs = [job("newer"), job("older")];
			const result = orderReadyJobs({
				jobs,
				now: NOW,
				// Both below the age threshold, so no boost — this only exercises the FIFO tie-break.
				meta: { newer: { readySince: NOW - 100 }, older: { readySince: NOW - 500 } },
				weights: { ageBoostAfterMs: 10_000 },
			});
			expect(result.ordered.map((row) => row.jobId)).toEqual(["older", "newer"]);
		});

		it("a known readySince sorts before an unknown one on the FIFO tie-break", () => {
			const jobs = [job("unknown"), job("known")];
			const result = orderReadyJobs({
				jobs,
				now: NOW,
				meta: { known: { readySince: NOW - 100 } },
				weights: { ageBoostAfterMs: 10_000 },
			});
			expect(result.ordered.map((row) => row.jobId)).toEqual(["known", "unknown"]);
		});

		it("fully-tied jobs fall through to jobId ascending (total order guarantee)", () => {
			const jobs = [job("c"), job("a"), job("b")];
			expect(orderedIds({ jobs, now: NOW })).toEqual(["a", "b", "c"]);
		});
	});

	describe("limit / selection", () => {
		it("selects only the highest-priority prefix under limit", () => {
			const jobs = [
				job("leaf-a"),
				job("leaf-b"),
				job("hub"),
				job("d1", { state: "blocked", dependsOn: ["hub"] }),
				job("d2", { state: "blocked", dependsOn: ["hub"] }),
			];
			const result = orderReadyJobs({ jobs, now: NOW, limit: 1 });
			expect(result.ordered).toHaveLength(3); // all ready jobs still ordered
			expect(result.selected.map((row) => row.jobId)).toEqual(["hub"]); // only the top one selected
			expect(result.counts.selected).toBe(1);
		});

		it("limit 0 selects nothing (no free slots)", () => {
			const result = orderReadyJobs({ jobs: [job("a"), job("b")], now: NOW, limit: 0 });
			expect(result.selected).toEqual([]);
			expect(result.ordered).toHaveLength(2);
		});

		it("a non-finite / negative limit orders ALL ready jobs (bound ignored)", () => {
			const jobs = [job("a"), job("b"), job("c")];
			expect(orderReadyJobs({ jobs, now: NOW, limit: Number.NaN }).selected).toHaveLength(3);
			expect(orderReadyJobs({ jobs, now: NOW, limit: -1 }).selected).toHaveLength(3);
		});

		it("a limit larger than the ready set selects everything", () => {
			expect(orderReadyJobs({ jobs: [job("a"), job("b")], now: NOW, limit: 10 }).selected).toHaveLength(2);
		});
	});

	describe("combined policy + explanation surface", () => {
		it("blends fan-out + priority + retry into one order and explains each row", () => {
			const jobs = [
				job("plain"),
				job("hub"),
				job("retried", { attempts: 2 }),
				job("urgent"),
				job("d1", { state: "blocked", dependsOn: ["hub"] }),
				job("d2", { state: "blocked", dependsOn: ["hub"] }),
			];
			const result = orderReadyJobs({
				jobs,
				now: NOW,
				meta: { urgent: { priority: 10 } },
				weights: { fanOut: 40, explicitPriority: 25, attempt: 15 },
			});
			// urgent: 10*25 = 250; hub: 2*40 = 80; retried: 2*15 = 30; plain: 0.
			expect(result.ordered.map((row) => row.jobId)).toEqual(["urgent", "hub", "retried", "plain"]);
			expect(result.ordered.find((row) => row.jobId === "hub")?.reason).toBe("unblocks 2 dependent(s)");
			expect(result.ordered.find((row) => row.jobId === "urgent")?.reason).toBe("priority 10");
			expect(result.ordered.find((row) => row.jobId === "retried")?.reason).toBe("retried x2");
			expect(result.ordered.find((row) => row.jobId === "plain")?.reason).toBe("no priority signal");
			expect(result.summary).toContain("Lease 4/4 ready job(s) next");
		});

		it("weight overrides re-shape the policy (raising attempt weight flips the order)", () => {
			const jobs = [job("hub"), job("retried", { attempts: 5 }), job("d", { state: "blocked", dependsOn: ["hub"] })];
			// Default fanOut 40 vs attempt 15: hub (40) beats retried (5*15 capped at 4 => 60)? cap=4 => 60 > 40.
			const boosted = orderReadyJobs({ jobs, now: NOW, weights: { fanOut: 40, attempt: 15, attemptCap: 4 } });
			expect(boosted.ordered[0]?.jobId).toBe("retried");
			// Now make fan-out dominate.
			const fanFirst = orderReadyJobs({ jobs, now: NOW, weights: { fanOut: 200, attempt: 15, attemptCap: 4 } });
			expect(fanFirst.ordered[0]?.jobId).toBe("hub");
		});
	});

	describe("dedup + robustness", () => {
		it("dedups a re-listed ready job by id (scored once, last row wins) but every edge still feeds fan-out", () => {
			const jobs = [
				job("hub", { attempts: 0 }),
				job("hub", { attempts: 4 }), // last write wins for hub's OWN row
				job("d1", { state: "blocked", dependsOn: ["hub"] }),
				job("d2", { state: "blocked", dependsOn: ["hub"] }),
			];
			const result = orderReadyJobs({ jobs, now: NOW });
			const hubRows = result.ordered.filter((row) => row.jobId === "hub");
			expect(hubRows).toHaveLength(1);
			expect(hubRows[0]?.signals.attempts).toBe(4); // last-listed attempts
			expect(hubRows[0]?.signals.fanOut).toBe(2); // both dependents counted
		});

		it("is a PURE function — does not mutate the input jobs or meta", () => {
			const jobs = [job("hub"), job("d", { state: "blocked", dependsOn: ["hub"] })];
			const snapshot = structuredClone(jobs);
			const meta = { hub: { priority: 3, readySince: NOW - 1 } };
			const metaSnapshot = structuredClone(meta);
			orderReadyJobs({ jobs, now: NOW, meta });
			expect(jobs).toEqual(snapshot);
			expect(meta).toEqual(metaSnapshot);
		});

		it("is deterministic — the same inputs yield an identical result (replay-stable)", () => {
			const jobs = [
				job("hub"),
				job("urgent"),
				job("retried", { attempts: 2 }),
				job("d1", { state: "blocked", dependsOn: ["hub"] }),
			];
			const input: OrderReadyJobsInput = { jobs, now: NOW, meta: { urgent: { priority: 4 } } };
			expect(orderReadyJobs(input)).toEqual(orderReadyJobs(input));
		});

		it("handles an empty graph", () => {
			const result = orderReadyJobs({ jobs: [], now: NOW });
			expect(result.ordered).toEqual([]);
			expect(result.summary).toBe("No ready jobs to order.");
		});
	});
});
