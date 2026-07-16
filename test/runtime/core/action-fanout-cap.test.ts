import { describe, expect, it } from "vitest";
import {
	type ActionFanoutState,
	checkActionFanout,
	emptyActionFanoutState,
	hasAnyFanoutLimit,
	recordAction,
} from "../../../src/core/action-fanout-cap";

describe("action-fanout-cap", () => {
	it("empty limits never constrain (byte-identical no-op)", () => {
		let state = emptyActionFanoutState();
		for (let i = 0; i < 1000; i++) {
			expect(checkActionFanout(state, `issue-${i}`, {}).allow).toBe(true);
			state = recordAction(state, `issue-${i}`);
		}
		expect(hasAnyFanoutLimit({})).toBe(false);
	});

	it("enforces the total action cap", () => {
		const limits = { maxTotal: 2 };
		let state = emptyActionFanoutState();
		expect(checkActionFanout(state, "a", limits).allow).toBe(true);
		state = recordAction(state, "a");
		expect(checkActionFanout(state, "b", limits).allow).toBe(true);
		state = recordAction(state, "b");
		const verdict = checkActionFanout(state, "c", limits);
		expect(verdict.allow).toBe(false);
		expect(verdict.reason).toContain("total action cap (2)");
	});

	it("enforces the per-target cap (anti-hammering) without blocking other targets", () => {
		const limits = { maxPerTarget: 2 };
		let state = emptyActionFanoutState();
		state = recordAction(state, "issue-7");
		state = recordAction(state, "issue-7");
		const hammered = checkActionFanout(state, "issue-7", limits);
		expect(hammered.allow).toBe(false);
		expect(hammered.reason).toContain('per-target action cap (2) for "issue-7"');
		// A different target is still allowed.
		expect(checkActionFanout(state, "issue-8", limits).allow).toBe(true);
	});

	it("enforces the distinct-target cap (anti-fan-out breadth)", () => {
		const limits = { maxDistinctTargets: 2 };
		let state = emptyActionFanoutState();
		state = recordAction(state, "a");
		state = recordAction(state, "b");
		// A THIRD distinct target is refused...
		expect(checkActionFanout(state, "c", limits).allow).toBe(false);
		// ...but acting again on an ALREADY-seen target does not grow the breadth, so it's allowed.
		expect(checkActionFanout(state, "a", limits).allow).toBe(true);
	});

	it("recordAction is immutable and counts per target + total", () => {
		const s0: ActionFanoutState = emptyActionFanoutState();
		const s1 = recordAction(s0, "x");
		const s2 = recordAction(s1, "x");
		expect(s0).toEqual({ total: 0, perTarget: {} }); // original untouched
		expect(s2).toEqual({ total: 2, perTarget: { x: 2 } });
	});

	it("normalizes a blank target", () => {
		const state = recordAction(emptyActionFanoutState(), "   ");
		expect(state.perTarget["unknown target"]).toBe(1);
	});

	it("hasAnyFanoutLimit detects a configured ceiling", () => {
		expect(hasAnyFanoutLimit({ maxTotal: 5 })).toBe(true);
		expect(hasAnyFanoutLimit({ maxDistinctTargets: 3 })).toBe(true);
	});
});
