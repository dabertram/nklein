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
