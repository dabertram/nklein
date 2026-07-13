import { describe, expect, it } from "vitest";
import { createDispatchReservationLedger, reservationAwarePools } from "../../../src/core/dispatch-reservations";
import { planDurableAdmission } from "../../../src/core/durable-admission";

/**
 * F1.24 — dispatch resource reservations: all-or-nothing grants, per-task idempotency, blind-safe release on
 * every terminal path, fail-open unknown counters, and the fold into the F1.19 admission pool view.
 */

describe("createDispatchReservationLedger", () => {
	it("grants within capacity, refuses with a precise shortfall, and is all-or-nothing", () => {
		const ledger = createDispatchReservationLedger([
			{ kind: "endpoint_slot", key: "m5max", capacity: 2 },
			{ kind: "sandbox_slot", key: "global", capacity: 1 },
		]);
		expect(
			ledger.tryReserve("t-1", [
				{ kind: "endpoint_slot", key: "m5max", amount: 1 },
				{ kind: "sandbox_slot", key: "global", amount: 1 },
			]),
		).toEqual({ ok: true });
		// t-2 fits the endpoint but NOT the sandbox — all-or-nothing means the endpoint slot is not held either.
		const refused = ledger.tryReserve("t-2", [
			{ kind: "endpoint_slot", key: "m5max", amount: 1 },
			{ kind: "sandbox_slot", key: "global", amount: 1 },
		]);
		expect(refused).toEqual({
			ok: false,
			shortfall: { kind: "sandbox_slot", key: "global", requested: 1, available: 0 },
		});
		expect(ledger.reserved("endpoint_slot", "m5max")).toBe(1); // only t-1's hold
		// Releasing t-1 frees both counters; releasing again (or an unknown task) is a no-op.
		ledger.release("t-1");
		ledger.release("t-1");
		ledger.release("never-reserved");
		expect(ledger.reserved("endpoint_slot", "m5max")).toBe(0);
		expect(ledger.tryReserve("t-2", [{ kind: "sandbox_slot", key: "global", amount: 1 }])).toEqual({ ok: true });
	});

	it("re-reserving the same task REPLACES its holds (a retry never double-counts)", () => {
		const ledger = createDispatchReservationLedger([{ kind: "kv_bytes", key: "m5max", capacity: 100 }]);
		expect(ledger.tryReserve("t-1", [{ kind: "kv_bytes", key: "m5max", amount: 80 }])).toEqual({ ok: true });
		// The retry asks for 90 — evaluated WITHOUT t-1's prior 80, so it fits and replaces.
		expect(ledger.tryReserve("t-1", [{ kind: "kv_bytes", key: "m5max", amount: 90 }])).toEqual({ ok: true });
		expect(ledger.reserved("kv_bytes", "m5max")).toBe(90);
		// A failed re-reserve keeps the PRIOR holds intact.
		const refused = ledger.tryReserve("t-1", [{ kind: "kv_bytes", key: "m5max", amount: 101 }]);
		expect(refused.ok).toBe(false);
		expect(ledger.reserved("kv_bytes", "m5max")).toBe(90);
		expect(ledger.holders()).toEqual(["t-1"]);
	});

	it("undeclared counters are unlimited (fail open — the live gates still apply)", () => {
		const ledger = createDispatchReservationLedger();
		expect(ledger.tryReserve("t-1", [{ kind: "disk_bytes", key: "legion", amount: 10_000_000 }])).toEqual({
			ok: true,
		});
	});
});

describe("reservationAwarePools", () => {
	it("folds endpoint holds into the admission pool view so the saturation planner sees committed load", () => {
		const ledger = createDispatchReservationLedger([{ kind: "endpoint_slot", key: "m5max", capacity: 2 }]);
		ledger.tryReserve("t-1", [{ kind: "endpoint_slot", key: "m5max", amount: 1 }]);
		const pools = reservationAwarePools([{ poolKey: "m5max", capacity: 2, inUse: 1 }], ledger);
		expect(pools).toEqual([{ poolKey: "m5max", capacity: 2, inUse: 2 }]); // 1 live + 1 reserved = saturated
		// The F1.19 planner now excludes the pool's candidates this wake.
		const plan = planDurableAdmission({
			now: 1_000_000,
			pools,
			candidates: [{ jobId: "j-1", poolKey: "m5max", readySinceMs: 0 }],
		});
		expect(plan.excludedJobIds).toEqual(["j-1"]);
	});
});
