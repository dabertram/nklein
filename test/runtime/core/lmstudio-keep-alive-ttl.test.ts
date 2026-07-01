import { describe, expect, it } from "vitest";
import { suggestModelKeepAliveTtl } from "../../../src/core/lmstudio-keep-alive-ttl";

describe("suggestModelKeepAliveTtl", () => {
	it("suggests a short self-evict TTL for a one-off sweep probe", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "sweep_probe" });
		expect(s.ttlSeconds).toBe(60);
		expect(s.reason).toMatch(/sweep probe/);
	});

	it("keeps an active session warm with a long TTL", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "active_session" });
		expect(s.ttlSeconds).toBe(1800);
		expect(s.reason).toMatch(/active session/);
	});

	it("keeps a queued batch warm with a medium-long TTL", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "batch_queue" });
		expect(s.ttlSeconds).toBe(900);
		expect(s.reason).toMatch(/queue/);
	});

	it("uses the neutral default for an idle model with no other signal", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "idle" });
		expect(s.ttlSeconds).toBe(300);
		expect(s.reason).toMatch(/neutral default/);
	});

	it("lengthens an idle keep-alive when the model was expensive to load (amortize the reload)", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "idle", loadCostSeconds: 45 });
		expect(s.ttlSeconds).toBe(1800);
		expect(s.reason).toMatch(/expensive to load/);
	});

	it("does NOT lengthen an idle keep-alive for a cheap load at the threshold (strictly greater required)", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "idle", loadCostSeconds: 20 });
		expect(s.ttlSeconds).toBe(300);
	});

	it("treats an unknown load cost as inexpensive (no lengthening)", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "idle" });
		expect(s.ttlSeconds).toBe(300);
	});

	it("suggests NO --ttl (null) for an explicit unbounded keep-alive under low pressure", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "active_session", unbounded: true });
		expect(s.ttlSeconds).toBeNull();
		expect(s.reason).toMatch(/unbounded/);
	});

	it("downgrades an unbounded request under memory pressure to the pressure cap (safety wins)", () => {
		const s = suggestModelKeepAliveTtl({
			usagePattern: "active_session",
			unbounded: true,
			memoryPressure: "high",
		});
		expect(s.ttlSeconds).toBe(120);
		expect(s.reason).toMatch(/downgraded under memory pressure/);
	});

	it("caps a long active-session TTL downward under memory pressure (never lengthens)", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "active_session", memoryPressure: "high" });
		expect(s.ttlSeconds).toBe(120);
		expect(s.reason).toMatch(/capped under memory pressure/);
	});

	it("caps a batch-queue TTL downward under memory pressure", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "batch_queue", memoryPressure: "high" });
		expect(s.ttlSeconds).toBe(120);
	});

	it("does NOT touch a TTL already below the pressure cap (only caps downward)", () => {
		// sweep_probe base (60s) is already under the 120s pressure cap — pressure must not raise it.
		const s = suggestModelKeepAliveTtl({ usagePattern: "sweep_probe", memoryPressure: "high" });
		expect(s.ttlSeconds).toBe(60);
		expect(s.reason).not.toMatch(/capped/);
	});

	it("an expensive idle load is also capped downward under memory pressure", () => {
		const s = suggestModelKeepAliveTtl({
			usagePattern: "idle",
			loadCostSeconds: 45,
			memoryPressure: "high",
		});
		expect(s.ttlSeconds).toBe(120);
		expect(s.reason).toMatch(/expensive to load/);
		expect(s.reason).toMatch(/capped under memory pressure/);
	});

	it("explicit low memory pressure behaves like the default (no cap)", () => {
		const s = suggestModelKeepAliveTtl({ usagePattern: "active_session", memoryPressure: "low" });
		expect(s.ttlSeconds).toBe(1800);
	});

	it("always returns a whole number of seconds when non-null", () => {
		for (const usagePattern of ["sweep_probe", "active_session", "batch_queue", "idle"] as const) {
			const s = suggestModelKeepAliveTtl({ usagePattern });
			expect(s.ttlSeconds).not.toBeNull();
			expect(Number.isInteger(s.ttlSeconds)).toBe(true);
		}
	});

	it("keeps every bounded suggestion within [30, 3600] seconds", () => {
		const cases = [
			{ usagePattern: "sweep_probe" as const },
			{ usagePattern: "active_session" as const },
			{ usagePattern: "batch_queue" as const },
			{ usagePattern: "idle" as const, loadCostSeconds: 9999 },
			{ usagePattern: "active_session" as const, memoryPressure: "high" as const },
		];
		for (const c of cases) {
			const ttl = suggestModelKeepAliveTtl(c).ttlSeconds;
			expect(ttl).not.toBeNull();
			expect(ttl as number).toBeGreaterThanOrEqual(30);
			expect(ttl as number).toBeLessThanOrEqual(3600);
		}
	});

	it("never suggests loading or unloading — it only ever returns a number or null (suggestion-only contract)", () => {
		// The return shape is the whole contract: a value to hand to `buildLmsLoadArgs({ ttlSeconds })`, nothing more.
		const s = suggestModelKeepAliveTtl({ usagePattern: "idle" });
		expect(Object.keys(s).sort()).toEqual(["reason", "ttlSeconds"]);
		expect(typeof s.reason).toBe("string");
		expect(s.ttlSeconds === null || typeof s.ttlSeconds === "number").toBe(true);
	});
});
