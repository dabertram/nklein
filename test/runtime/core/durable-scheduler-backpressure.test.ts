import { describe, expect, it } from "vitest";
import {
	type BackpressureAdmissionRequest,
	type BackpressurePoolSnapshot,
	type DecideBackpressureInput,
	decideDurableSchedulerBackpressure,
} from "../../../src/core/durable-scheduler-backpressure";

/** Build a pool snapshot with sensible defaults; override any field. */
function pool(poolId: string, overrides: Partial<BackpressurePoolSnapshot> = {}): BackpressurePoolSnapshot {
	return { poolId, cap: 2, inflight: 0, queued: 0, ...overrides };
}

/** Build a request targeting a pool. */
function req(requestId: string, poolId: string): BackpressureAdmissionRequest {
	return { requestId, poolId };
}

/** Run the decision with defaults filled. */
function decide(input: Partial<DecideBackpressureInput> & Pick<DecideBackpressureInput, "pools" | "pending">) {
	return decideDurableSchedulerBackpressure({ ...input });
}

/** Convenience: the decision for a single request against one pool. */
function verdictFor(poolSnap: BackpressurePoolSnapshot, globalInflightCap?: number) {
	return decide({ pools: [poolSnap], pending: [req("r1", poolSnap.poolId)], globalInflightCap }).verdicts[0];
}

describe("decideDurableSchedulerBackpressure — basic admit", () => {
	it("admits when the pool has a free slot and there is no global cap", () => {
		const v = verdictFor(pool("a", { cap: 2, inflight: 0 }));
		expect(v.decision).toBe("admit");
		expect(v.requestId).toBe("r1");
		expect(v.poolId).toBe("a");
	});

	it("admits up to the pool cap, then defers the rest", () => {
		const res = decide({
			pools: [pool("a", { cap: 2, inflight: 0, queued: 0, maxQueueDepth: 10 })],
			pending: [req("r1", "a"), req("r2", "a"), req("r3", "a")],
		});
		expect(res.verdicts.map((x) => x.decision)).toEqual(["admit", "admit", "defer"]);
		expect(res.counts).toEqual({ admitted: 2, deferred: 1, shed: 0 });
	});

	it("counts pre-existing inflight against the cap (a nearly-full pool admits only the remaining slots)", () => {
		const res = decide({
			pools: [pool("a", { cap: 3, inflight: 2, queued: 0, maxQueueDepth: 10 })],
			pending: [req("r1", "a"), req("r2", "a")],
		});
		expect(res.verdicts.map((x) => x.decision)).toEqual(["admit", "defer"]);
	});

	it("admits nothing when the pool is already at its cap (no queue configured ⇒ unbounded defer)", () => {
		const res = decide({
			pools: [pool("a", { cap: 2, inflight: 2 })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("defer");
		expect(res.verdicts[0].decision === "defer" && res.verdicts[0].reason).toBe("pool_saturated");
	});
});

describe("decideDurableSchedulerBackpressure — global ceiling", () => {
	it("defers a request whose pool has room but the global inflight ceiling is reached", () => {
		// Pool a: cap 5, inflight 1 (room). Pool b: cap 5, inflight 2. Global inflight = 3, cap 3 ⇒ no global headroom.
		const res = decide({
			pools: [
				pool("a", { cap: 5, inflight: 1, maxQueueDepth: 10 }),
				pool("b", { cap: 5, inflight: 2, maxQueueDepth: 10 }),
			],
			pending: [req("r1", "a")],
			globalInflightCap: 3,
		});
		expect(res.verdicts[0].decision).toBe("defer");
		expect(res.verdicts[0].decision === "defer" && res.verdicts[0].reason).toBe("global_saturated");
	});

	it("global cap 0 admits nothing even with free pool slots", () => {
		const res = decide({
			pools: [pool("a", { cap: 5, inflight: 0, maxQueueDepth: 10 })],
			pending: [req("r1", "a"), req("r2", "a")],
			globalInflightCap: 0,
		});
		expect(res.counts.admitted).toBe(0);
		expect(res.verdicts.every((v) => v.decision === "defer")).toBe(true);
		for (const v of res.verdicts) {
			expect(v.decision === "defer" && v.reason).toBe("global_saturated");
		}
	});

	it("global cap spreads admits across pools until the ceiling, then holds the rest", () => {
		// Two pools, cap 2 each (4 pool slots), but global cap 3 ⇒ exactly 3 admits total.
		const res = decide({
			pools: [
				pool("a", { cap: 2, inflight: 0, maxQueueDepth: 10 }),
				pool("b", { cap: 2, inflight: 0, maxQueueDepth: 10 }),
			],
			pending: [req("r1", "a"), req("r2", "a"), req("r3", "b"), req("r4", "b")],
			globalInflightCap: 3,
		});
		expect(res.counts.admitted).toBe(3);
		expect(res.verdicts.map((x) => x.decision)).toEqual(["admit", "admit", "admit", "defer"]);
		// The 4th (pool b) had a free pool slot but the global ceiling was reached.
		expect(res.verdicts[3].decision === "defer" && res.verdicts[3].reason).toBe("global_saturated");
	});

	it("negative / non-finite global cap ⇒ unbounded (only per-pool caps apply)", () => {
		for (const globalInflightCap of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			const res = decide({
				pools: [pool("a", { cap: 100, inflight: 0 })],
				pending: [req("r1", "a"), req("r2", "a"), req("r3", "a")],
				globalInflightCap,
			});
			expect(res.counts.admitted).toBe(3);
		}
	});

	it("pool-saturated takes precedence over global-saturated in the reason (pool full AND global full ⇒ pool_saturated)", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, maxQueueDepth: 10 })],
			pending: [req("r1", "a")],
			globalInflightCap: 1,
		});
		expect(res.verdicts[0].decision === "defer" && res.verdicts[0].reason).toBe("pool_saturated");
	});
});

describe("decideDurableSchedulerBackpressure — queue depth (defer vs shed)", () => {
	it("sheds when the queue is at maxQueueDepth and the pool is saturated", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, queued: 2, maxQueueDepth: 2 })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("shed");
		expect(res.verdicts[0].decision === "shed" && res.verdicts[0].reason).toBe("queue_full");
	});

	it("defers up to the queue bound, then sheds beyond it", () => {
		// cap 1 / inflight 1 (saturated), queued 0, maxQueueDepth 2 ⇒ first 2 defers fill the queue, the 3rd sheds.
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, queued: 0, maxQueueDepth: 2 })],
			pending: [req("r1", "a"), req("r2", "a"), req("r3", "a")],
		});
		expect(res.verdicts.map((x) => x.decision)).toEqual(["defer", "defer", "shed"]);
		expect(res.counts).toEqual({ admitted: 0, deferred: 2, shed: 1 });
	});

	it("maxQueueDepth 0 ⇒ shed as soon as saturated (no queue at all)", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, queued: 0, maxQueueDepth: 0 })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("shed");
		expect(res.verdicts[0].decision === "shed" && res.verdicts[0].reason).toBe("queue_full");
	});

	it("absent maxQueueDepth ⇒ unbounded queue, never sheds for depth (always defers when saturated)", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, queued: 999 })], // no maxQueueDepth
			pending: [req("r1", "a"), req("r2", "a")],
		});
		expect(res.verdicts.every((v) => v.decision === "defer")).toBe(true);
	});

	it("negative maxQueueDepth ⇒ unbounded (treated as absent)", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, queued: 5, maxQueueDepth: -3 })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("defer");
	});

	it("admits still work when the pool has room even if its (stale) queue is over the bound", () => {
		// A free slot means admit wins BEFORE the queue check is ever consulted.
		const res = decide({
			pools: [pool("a", { cap: 2, inflight: 0, queued: 100, maxQueueDepth: 1 })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("admit");
	});
});

describe("decideDurableSchedulerBackpressure — unknown & disabled pools", () => {
	it("sheds a request targeting a pool id not in the snapshot", () => {
		const res = decide({ pools: [pool("a")], pending: [req("r1", "ghost")] });
		expect(res.verdicts[0].decision).toBe("shed");
		expect(res.verdicts[0].decision === "shed" && res.verdicts[0].reason).toBe("unknown_pool");
		expect(res.verdicts[0].poolId).toBe("ghost");
	});

	it("sheds every request targeting a disabled pool (cap ≤ 0)", () => {
		for (const cap of [0, -1]) {
			const res = decide({
				pools: [pool("a", { cap })],
				pending: [req("r1", "a"), req("r2", "a")],
			});
			expect(res.verdicts.every((v) => v.decision === "shed")).toBe(true);
			for (const v of res.verdicts) {
				expect(v.decision === "shed" && v.reason).toBe("pool_disabled");
			}
			expect(res.counts).toEqual({ admitted: 0, deferred: 0, shed: 2 });
		}
	});

	it("a non-finite cap is treated as disabled", () => {
		const v = verdictFor(pool("a", { cap: Number.NaN }));
		expect(v.decision).toBe("shed");
		expect(v.decision === "shed" && v.reason).toBe("pool_disabled");
	});
});

describe("decideDurableSchedulerBackpressure — in-tick accumulation across pools", () => {
	it("routes admits per target pool independently (a full pool defers while another still admits)", () => {
		const res = decide({
			pools: [
				pool("a", { cap: 1, inflight: 1, maxQueueDepth: 5 }), // saturated
				pool("b", { cap: 2, inflight: 0, maxQueueDepth: 5 }), // room for 2
			],
			pending: [req("r1", "a"), req("r2", "b"), req("r3", "b"), req("r4", "a")],
		});
		expect(res.verdicts.map((x) => `${x.requestId}:${x.decision}`)).toEqual([
			"r1:defer", // pool a saturated
			"r2:admit", // pool b slot 1
			"r3:admit", // pool b slot 2
			"r4:defer", // pool a still saturated
		]);
		expect(res.projectedInflightByPool).toEqual({ a: 1, b: 2 });
	});

	it("earlier requests claim the scarce slots first (order matters within a tick)", () => {
		const forward = decide({
			pools: [pool("a", { cap: 1, inflight: 0, maxQueueDepth: 5 })],
			pending: [req("first", "a"), req("second", "a")],
		});
		expect(forward.verdicts[0]).toMatchObject({ requestId: "first", decision: "admit" });
		expect(forward.verdicts[1]).toMatchObject({ requestId: "second", decision: "defer" });
	});

	it("accumulated defers count toward the queue bound within the same tick", () => {
		// queued starts 0, bound 1: the first saturated request defers (queue→1), the second sheds (queue full).
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 1, queued: 0, maxQueueDepth: 1 })],
			pending: [req("r1", "a"), req("r2", "a")],
		});
		expect(res.verdicts.map((x) => x.decision)).toEqual(["defer", "shed"]);
	});
});

describe("decideDurableSchedulerBackpressure — projections & counts", () => {
	it("projectedInflightByPool reflects only this tick's admits added to live inflight", () => {
		const res = decide({
			pools: [
				pool("a", { cap: 3, inflight: 1, maxQueueDepth: 5 }),
				pool("b", { cap: 3, inflight: 0, maxQueueDepth: 5 }),
			],
			pending: [req("r1", "a"), req("r2", "b")],
		});
		expect(res.projectedInflightByPool).toEqual({ a: 2, b: 1 });
	});

	it("projectedGlobalInflight is the sum of live inflight plus admits", () => {
		const res = decide({
			pools: [pool("a", { cap: 3, inflight: 1 }), pool("b", { cap: 3, inflight: 2 })],
			pending: [req("r1", "a"), req("r2", "b")],
		});
		// live 1 + 2 = 3, plus 2 admits ⇒ 5.
		expect(res.projectedGlobalInflight).toBe(5);
	});

	it("counts sum to the number of pending requests", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 0, queued: 0, maxQueueDepth: 1 }), pool("bad", { cap: 0 })],
			pending: [req("r1", "a"), req("r2", "a"), req("r3", "a"), req("r4", "bad"), req("r5", "ghost")],
		});
		const { admitted, deferred, shed } = res.counts;
		expect(admitted + deferred + shed).toBe(5);
		// r1 admit; r2 defer (queue→1); r3 shed (queue full); r4 shed (disabled); r5 shed (unknown).
		expect(res.counts).toEqual({ admitted: 1, deferred: 1, shed: 3 });
	});

	it("empty pending ⇒ no verdicts and a clear summary", () => {
		const res = decide({ pools: [pool("a")], pending: [] });
		expect(res.verdicts).toEqual([]);
		expect(res.counts).toEqual({ admitted: 0, deferred: 0, shed: 0 });
		expect(res.summary).toBe("No pending admissions.");
	});

	it("summary reports the admit/defer/shed split", () => {
		const res = decide({
			pools: [pool("a", { cap: 1, inflight: 0, queued: 0, maxQueueDepth: 0 })],
			pending: [req("r1", "a"), req("r2", "a")],
		});
		// r1 admit; r2 saturated with maxQueueDepth 0 ⇒ shed.
		expect(res.summary).toBe("Admitted 1/2, deferred 0, shed 1.");
	});
});

describe("decideDurableSchedulerBackpressure — input normalization", () => {
	it("floors fractional caps / inflight / queued / bounds", () => {
		const res = decide({
			pools: [pool("a", { cap: 2.9, inflight: 1.9, queued: 0.9, maxQueueDepth: 1.9 })],
			pending: [req("r1", "a"), req("r2", "a")],
		});
		// cap floors to 2, inflight floors to 1 ⇒ one free slot: r1 admit, r2 (saturated, queued 0, bound 1) defer.
		expect(res.verdicts.map((x) => x.decision)).toEqual(["admit", "defer"]);
	});

	it("negative inflight / queued clamp to 0", () => {
		const res = decide({
			pools: [pool("a", { cap: 2, inflight: -5, queued: -5, maxQueueDepth: 0 })],
			pending: [req("r1", "a"), req("r2", "a"), req("r3", "a")],
		});
		// inflight clamps to 0 ⇒ 2 admits, then saturated with maxQueueDepth 0 ⇒ shed.
		expect(res.verdicts.map((x) => x.decision)).toEqual(["admit", "admit", "shed"]);
	});

	it("a duplicate poolId uses the last occurrence (last write wins)", () => {
		const res = decide({
			// First says cap 5 (room), the last says cap 1 / inflight 1 (saturated) — the last must win.
			pools: [pool("a", { cap: 5, inflight: 0 }), pool("a", { cap: 1, inflight: 1, maxQueueDepth: 5 })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("defer");
	});

	it("non-finite inflight is treated as 0", () => {
		const res = decide({
			pools: [pool("a", { cap: 2, inflight: Number.NaN })],
			pending: [req("r1", "a")],
		});
		expect(res.verdicts[0].decision).toBe("admit");
	});
});

describe("decideDurableSchedulerBackpressure — determinism & purity", () => {
	const input: DecideBackpressureInput = {
		pools: [
			pool("a", { cap: 2, inflight: 1, queued: 1, maxQueueDepth: 2 }),
			pool("b", { cap: 1, inflight: 1, queued: 0, maxQueueDepth: 1 }),
			pool("c", { cap: 0 }),
		],
		pending: [req("r1", "a"), req("r2", "b"), req("r3", "b"), req("r4", "c"), req("r5", "ghost"), req("r6", "a")],
		globalInflightCap: 4,
	};

	it("is deterministic — identical inputs yield identical output", () => {
		const a = decideDurableSchedulerBackpressure(input);
		const b = decideDurableSchedulerBackpressure(input);
		expect(a).toEqual(b);
	});

	it("does not mutate its inputs", () => {
		const snapshot = structuredClone(input);
		decideDurableSchedulerBackpressure(input);
		expect(input).toEqual(snapshot);
	});

	it("produces exactly one verdict per pending request, in input order", () => {
		const res = decideDurableSchedulerBackpressure(input);
		expect(res.verdicts.map((v) => v.requestId)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
	});

	it("every admit reason names the pool occupancy; every hold reason is a typed enum", () => {
		const res = decideDurableSchedulerBackpressure(input);
		for (const v of res.verdicts) {
			if (v.decision === "admit") {
				expect(v.reason).toContain("pool");
			} else {
				expect(["pool_saturated", "global_saturated", "queue_full", "unknown_pool", "pool_disabled"]).toContain(
					v.reason,
				);
			}
		}
	});
});
