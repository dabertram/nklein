import { describe, expect, it } from "vitest";
import { createDispatchReservationLedger, reservationAwarePools } from "../../../src/core/dispatch-reservations";
import { planDurableAdmission } from "../../../src/core/durable-admission";

/**
 * F1.24 — dispatch resource reservations: all-or-nothing grants, per-task idempotency, blind-safe release on
 * every terminal path, fail-open unknown counters, and the fold into the F1.19 admission pool view.
 */

describe("createDispatchReservationLedger", () => {
	it("refuses a NaN/negative/non-integer amount instead of poisoning the pool (audit 2026-08-25)", () => {
		const ledger = createDispatchReservationLedger([{ kind: "endpoint_slot", key: "m5max", capacity: 4 }]);
		for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
			expect(ledger.tryReserve("t-bad", [{ kind: "endpoint_slot", key: "m5max", amount: bad }]).ok).toBe(false);
		}
		// The pool is UNCORRUPTED: a real request of the full capacity still succeeds afterward.
		expect(ledger.tryReserve("t-ok", [{ kind: "endpoint_slot", key: "m5max", amount: 4 }])).toEqual({ ok: true });
	});

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

	it("returns a defensive telemetry snapshot that cannot mutate live holds", () => {
		const ledger = createDispatchReservationLedger();
		ledger.tryReserve("t-1", [{ kind: "kv_bytes", key: "m5max", amount: 42 }]);
		const snapshot = ledger.snapshot();
		const clonedHold = snapshot[0];
		const clonedRequest = clonedHold?.requests[0];
		if (!clonedHold || !clonedRequest) throw new Error("expected cloned reservation hold");
		clonedHold.requests.push({ kind: "disk_bytes", key: "local", amount: 99 });
		clonedRequest.amount = 0;
		expect(ledger.snapshot()).toEqual([
			{ taskId: "t-1", requests: [{ kind: "kv_bytes", key: "m5max", amount: 42 }] },
		]);
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

/**
 * F1.34c-drift / F1.24 — a leaked dispatch hold used to freeze the runtime permanently.
 *
 * The wiring released on exactly two paths (first observed summary, delivery). A dispatch whose session died
 * BEFORE any summary never released, `dispose` did not release, and nothing expired. And it was not harmless:
 * `tryReserve` fails OPEN on an undeclared capacity but still RECORDS the hold, and `reservationAwarePools` adds
 * `reserved()` to `inUse` unconditionally — so every leak permanently shrank the pool admission could see.
 */
describe("hold expiry — the permanent-freeze fix", () => {
	function ledgerAt(clock: { t: number }, holdTtlMs = 1_000) {
		return createDispatchReservationLedger([], { holdTtlMs, now: () => clock.t });
	}

	it("a hold that is never released EXPIRES instead of holding forever", () => {
		const clock = { t: 0 };
		const ledger = ledgerAt(clock);
		ledger.tryReserve("dead-session", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		expect(ledger.reserved("endpoint_slot", "pool-a")).toBe(1);
		clock.t += 1_001;
		expect(ledger.reserved("endpoint_slot", "pool-a"), "the leaked hold must not survive its window").toBe(0);
		expect(ledger.holders()).toEqual([]);
	});

	it("stops a leak from permanently shrinking the ADMISSION view — the actual freeze", () => {
		// reservationAwarePools adds reserved() to inUse unconditionally. Before expiry, a pool of capacity 2 with
		// two dead dispatches read as fully occupied forever and nothing ever started again.
		const clock = { t: 0 };
		const ledger = ledgerAt(clock);
		ledger.tryReserve("dead-1", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		ledger.tryReserve("dead-2", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		const pools = [{ poolKey: "pool-a", capacity: 2, inUse: 0 }] as never;
		expect(reservationAwarePools(pools, ledger)[0]?.inUse, "saturated by the leak").toBe(2);
		clock.t += 1_001;
		expect(reservationAwarePools(pools, ledger)[0]?.inUse, "recovered once the holds expired").toBe(0);
	});

	it("does NOT expire a hold that is still inside its window", () => {
		// The failure direction that matters in the other direction: expiring a live hold re-opens the TOCTOU
		// window the reservation exists to close.
		const clock = { t: 0 };
		const ledger = ledgerAt(clock);
		ledger.tryReserve("live", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		clock.t += 999;
		expect(ledger.reserved("endpoint_slot", "pool-a")).toBe(1);
	});

	it("RESTARTS the clock on an idempotent re-reserve — the dispatch is still in flight", () => {
		const clock = { t: 0 };
		const ledger = ledgerAt(clock);
		ledger.tryReserve("t", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		clock.t += 900;
		ledger.tryReserve("t", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		clock.t += 900;
		expect(ledger.reserved("endpoint_slot", "pool-a"), "re-reserved at 900, so still live at 1800").toBe(1);
	});

	it("expires on a READ, not only on the next write", () => {
		// reservationAwarePools only ever READS. Expiring on writes alone would leave the admission view shrunk
		// until some unrelated dispatch happened to come along.
		const clock = { t: 0 };
		const ledger = ledgerAt(clock);
		ledger.tryReserve("dead", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		clock.t += 5_000;
		expect(ledger.snapshot()).toEqual([]);
	});

	it("releases explicitly without waiting for the TTL", () => {
		const clock = { t: 0 };
		const ledger = ledgerAt(clock);
		ledger.tryReserve("t", [{ kind: "endpoint_slot", key: "pool-a", amount: 1 }]);
		ledger.release("t");
		expect(ledger.reserved("endpoint_slot", "pool-a")).toBe(0);
	});

	it("keeps a declared capacity honest across an expiry", () => {
		const clock = { t: 0 };
		const ledger = createDispatchReservationLedger([{ kind: "endpoint_slot", key: "p", capacity: 1 }], {
			holdTtlMs: 1_000,
			now: () => clock.t,
		});
		expect(ledger.tryReserve("a", [{ kind: "endpoint_slot", key: "p", amount: 1 }]).ok).toBe(true);
		expect(ledger.tryReserve("b", [{ kind: "endpoint_slot", key: "p", amount: 1 }]).ok, "capacity 1 is full").toBe(
			false,
		);
		clock.t += 1_001;
		expect(ledger.tryReserve("b", [{ kind: "endpoint_slot", key: "p", amount: 1 }]).ok, "a's hold leaked out").toBe(
			true,
		);
	});
});
