import { describe, expect, it } from "vitest";
import { decideRefinementStallRecovery, type RefinementStallInputs } from "./refinement-stall";

// The stall this steers: a refinable `--no-plan` work card whose turn cleanly ended in review without ever calling
// begin_implementation, so it sits in Planning producing no terminal outcome (live: qwen3.8-27b wandered 24 turns).
const STALLED: RefinementStallInputs = {
	isRefinableWorkCard: true,
	begunImplementation: false,
	state: "awaiting_review",
	reviewReason: "hook",
	endedOnQuestion: false,
	nudgeCount: 0,
	nudgeLimit: 1,
};

describe("decideRefinementStallRecovery", () => {
	it("nudges a refinable card that ended a turn without promoting to In Progress", () => {
		const decision = decideRefinementStallRecovery(STALLED);
		expect(decision.action).toBe("begin_implementation");
	});

	it("does nothing for a plan-mode / non-refinable card (the decomposition nudger owns that)", () => {
		expect(decideRefinementStallRecovery({ ...STALLED, isRefinableWorkCard: false }).action).toBe("none");
	});

	it("does nothing once the card has already promoted to In Progress", () => {
		expect(decideRefinementStallRecovery({ ...STALLED, begunImplementation: true }).action).toBe("none");
	});

	it("does nothing when the turn ended on a clarifying question (waiting on the operator, not stalled)", () => {
		expect(decideRefinementStallRecovery({ ...STALLED, endedOnQuestion: true }).action).toBe("none");
	});

	it("stops after the nudge budget is spent (one nudge per card, then it parks on its own)", () => {
		expect(decideRefinementStallRecovery({ ...STALLED, nudgeCount: 1, nudgeLimit: 1 }).action).toBe("none");
	});

	it("never re-drives a failed, interrupted, or operator-parked card", () => {
		expect(decideRefinementStallRecovery({ ...STALLED, state: "failed" }).action).toBe("none");
		expect(decideRefinementStallRecovery({ ...STALLED, state: "interrupted" }).action).toBe("none");
		expect(decideRefinementStallRecovery({ ...STALLED, reviewReason: "attention" }).action).toBe("none");
	});
});
