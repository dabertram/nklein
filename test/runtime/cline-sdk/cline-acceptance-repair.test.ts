import { describe, expect, it } from "vitest";

import {
	buildClineAcceptanceRepairPlan,
	extractAcceptanceFailureConstraint,
} from "../../../src/cline-sdk/cline-acceptance-repair";

const failedAcceptance = {
	present: true,
	command: "npm test",
	passed: false,
	exitCode: 1,
	output: "Expected 100, received 101",
	durationMs: 20,
};

describe("cline acceptance repair", () => {
	it("builds a bounded repair prompt for a failing acceptance gate", () => {
		const plan = buildClineAcceptanceRepairPlan({
			taskId: "task-1",
			taskTitle: "Cap habit score",
			taskPrompt: "Implement the fix.\nAcceptance check: npm test",
			acceptance: failedAcceptance,
			attempt: 1,
			maxAttempts: 2,
		});

		expect(plan).toMatchObject({
			action: "repair",
			attempt: 1,
			maxAttempts: 2,
			escalatedRole: null,
		});
		expect(plan?.prompt).toContain("Acceptance command: npm test");
		expect(plan?.prompt).toContain("Failing test constraint:");
		expect(plan?.prompt).toContain("Expected 100, received 101");
		expect(plan?.prompt).toContain("rerun the exact Acceptance check");
	});

	it("extracts the failing assertion as a concise next-turn constraint", () => {
		const output = [
			"stderr | noisy setup",
			" FAIL  test/habits.test.ts > caps perfect habit scores",
			"AssertionError: expected 101 to be 100",
			"",
			"- Expected",
			"+ Received",
			"",
			"- 100",
			"+ 101",
			"    at test/habits.test.ts:12:18",
		].join("\n");

		expect(extractAcceptanceFailureConstraint(output)).toContain("AssertionError: expected 101 to be 100");
		expect(extractAcceptanceFailureConstraint(output)).toContain("- Expected");
	});

	it("extracts compiler errors as acceptance constraints", () => {
		const output = [
			"src/score.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
			"  const score: number = label;",
			"        ~~~~~",
		].join("\n");

		expect(extractAcceptanceFailureConstraint(output)).toContain("error TS2322");
	});

	it("escalates to the reviewer role after repair attempts are exhausted", () => {
		const plan = buildClineAcceptanceRepairPlan({
			taskId: "task-1",
			taskPrompt: "Implement the fix.\nAcceptance check: npm test",
			acceptance: failedAcceptance,
			attempt: 3,
			maxAttempts: 2,
			modelRoles: {
				reviewer: {
					providerId: "anthropic",
					modelId: "claude-sonnet",
				},
			},
		});

		expect(plan).toMatchObject({
			action: "escalate",
			escalatedRole: "reviewer",
			escalatedSettings: {
				providerId: "anthropic",
				modelId: "claude-sonnet",
			},
		});
		expect(plan?.prompt).toContain("escalate this task to the reviewer role");
	});

	it("returns null when the acceptance gate passed or was missing", () => {
		expect(
			buildClineAcceptanceRepairPlan({
				taskId: "task-1",
				taskPrompt: "Implement the fix.",
				acceptance: { ...failedAcceptance, passed: true, exitCode: 0 },
				attempt: 1,
			}),
		).toBeNull();
		expect(
			buildClineAcceptanceRepairPlan({
				taskId: "task-1",
				taskPrompt: "Implement the fix.",
				acceptance: {
					present: false,
					command: null,
					passed: null,
					exitCode: null,
					output: "",
					durationMs: 0,
				},
				attempt: 1,
			}),
		).toBeNull();
	});
});
