import { describe, expect, it } from "vitest";
import { classifySandboxFailure, DEFAULT_SANDBOX_FAILURE_LIMIT } from "../../../src/core/sandbox-disposed-session";

describe("a session whose sandbox is gone", () => {
	it("keeps retrying while the task has never held a placement — the acquisition may still be queued", () => {
		for (const consecutiveFailures of [1, 2, 9]) {
			const decision = classifySandboxFailure({ everPlaced: false, consecutiveFailures });
			expect(decision.absence).toBe("never_placed");
			expect(decision.action).toBe("retry");
		}
	});

	it("tolerates ONE failure after a dispose, because a dispose can race a call already in flight", () => {
		const first = classifySandboxFailure({ everPlaced: true, consecutiveFailures: 1 });
		expect(first.absence).toBe("disposed");
		expect(first.action).toBe("retry");
		expect(first.reason).toContain("race");
	});

	it("stops the session on the second, which cannot be that race", () => {
		const decision = classifySandboxFailure({
			everPlaced: true,
			consecutiveFailures: DEFAULT_SANDBOX_FAILURE_LIMIT,
		});
		expect(decision.action).toBe("stop_session");
		// The reason must say what the cost of NOT stopping is — thirty wasted requests is what prompted this.
		expect(decision.reason).toContain("model request");
	});

	it("takes a caller-supplied limit, so a rig chasing a flaky pool can loosen it deliberately", () => {
		expect(classifySandboxFailure({ everPlaced: true, consecutiveFailures: 2, limit: 5 }).action).toBe("retry");
		expect(classifySandboxFailure({ everPlaced: true, consecutiveFailures: 5, limit: 5 }).action).toBe(
			"stop_session",
		);
	});
});

/**
 * Where the count is kept decides whether the guard works at all.
 *
 * The first cut of this guard watched the session summary's `latestHookActivity.activityText` for the
 * "No Docker sandbox workspace is prepared" string. It fired ZERO times across a shift in which one task refused
 * FIVE times in a row — the error reaches the model through the tool result, not through that field. The count
 * now lives in the sandbox manager, at the point that raises the refusal, which is the only place that sees every
 * one of them. This test pins the streak semantics that placement-vs-refusal ordering has to produce.
 */
describe("the consecutive-failure streak", () => {
	function streak(events: readonly ("refuse" | "placed")[]): number[] {
		let consecutive = 0;
		const decisions: number[] = [];
		for (const event of events) {
			if (event === "placed") {
				consecutive = 0;
				continue;
			}
			consecutive += 1;
			decisions.push(
				classifySandboxFailure({ everPlaced: true, consecutiveFailures: consecutive }).action === "stop_session"
					? 1
					: 0,
			);
		}
		return decisions;
	}

	it("stops on the second refusal, and a regained placement resets the streak", () => {
		expect(streak(["refuse", "refuse"])).toEqual([0, 1]);
		// A placement between refusals means the session worked in between — that is not a streak.
		expect(streak(["refuse", "placed", "refuse"])).toEqual([0, 0]);
	});

	it("would have stopped the five-in-a-row case the first cut missed entirely", () => {
		expect(streak(["refuse", "refuse", "refuse", "refuse", "refuse"])).toEqual([0, 1, 1, 1, 1]);
	});
});
