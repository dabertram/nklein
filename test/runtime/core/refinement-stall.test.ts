import { describe, expect, it } from "vitest";

import { decideRefinementStallRecovery, type RefinementStallInputs } from "../../../src/core/refinement-stall";

/**
 * A clean refinement turn-end on a refinable `--no-plan` work card that stopped without promoting to In Progress
 * and still has nudge budget — the exact live-observed stall (qwen3.8-27b, `cli-parser-medium --no-plan`,
 * `.real-runs/20260827-015045`: 24 tool calls, wandered to `ls /`, never called begin_implementation).
 */
const CLEAN_STALL: RefinementStallInputs = {
	isRefinableWorkCard: true,
	begunImplementation: false,
	state: "awaiting_review",
	reviewReason: "hook",
	endedOnQuestion: false,
	nudgeCount: 0,
	nudgeLimit: 1,
};

describe("decideRefinementStallRecovery", () => {
	it("re-prompts a refinable card that ended a turn without begin_implementation", () => {
		const decision = decideRefinementStallRecovery(CLEAN_STALL);
		expect(decision.action).toBe("begin_implementation");
		expect(decision.reason).toContain("begin_implementation");
	});

	it("does nothing for a non-refinable card (plan-mode / home-agent turns are out of scope)", () => {
		const decision = decideRefinementStallRecovery({ ...CLEAN_STALL, isRefinableWorkCard: false });
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("not a refinable work card");
	});

	it("does nothing once the card has already promoted to In Progress", () => {
		const decision = decideRefinementStallRecovery({ ...CLEAN_STALL, begunImplementation: true });
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("already promoted");
	});

	it("does not re-drive a turn that ended on a clarifying question — it is waiting on the operator", () => {
		const decision = decideRefinementStallRecovery({ ...CLEAN_STALL, endedOnQuestion: true });
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("clarifying question");
	});

	it("stops once the one-shot nudge budget is spent (a wandering model must not be nudged forever)", () => {
		const decision = decideRefinementStallRecovery({ ...CLEAN_STALL, nudgeCount: 1, nudgeLimit: 1 });
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("budget spent");
	});

	it("fires on the first nudge but not the second, at the default one-shot limit", () => {
		expect(decideRefinementStallRecovery({ ...CLEAN_STALL, nudgeCount: 0 }).action).toBe("begin_implementation");
		expect(decideRefinementStallRecovery({ ...CLEAN_STALL, nudgeCount: 1 }).action).toBe("none");
	});

	it("does nothing for a failed or interrupted card — that is terminal, not a steerable stall", () => {
		expect(decideRefinementStallRecovery({ ...CLEAN_STALL, state: "failed" }).action).toBe("none");
		expect(decideRefinementStallRecovery({ ...CLEAN_STALL, state: "interrupted" }).action).toBe("none");
	});

	it("does nothing for a card parked for the operator (reviewReason 'attention')", () => {
		const decision = decideRefinementStallRecovery({ ...CLEAN_STALL, reviewReason: "attention" });
		expect(decision.action).toBe("none");
		expect(decision.reason).toContain("parked");
	});

	it("still fires when the state is a non-terminal reviewable hold other than awaiting_review", () => {
		// The gate excludes only failed/interrupted/attention; any other clean turn-end is a steerable stall.
		expect(decideRefinementStallRecovery({ ...CLEAN_STALL, state: "review" }).action).toBe("begin_implementation");
	});
});
