import { describe, expect, it } from "vitest";
import type { NKleinAcceptanceGateResult } from "../../../src/nklein-agent/nklein-acceptance-gate";
import {
	buildNKleinAcceptanceRepairPlan,
	extractAcceptanceFailureConstraint,
} from "../../../src/nklein-agent/nklein-acceptance-repair";

const failedAcceptance: NKleinAcceptanceGateResult = {
	present: true,
	command: "npm test",
	passed: false,
	exitCode: 1,
	output: "Expected 100, received 101",
	durationMs: 20,
	failureCategory: null,
	failureHint: null,
};

describe("nklein acceptance repair", () => {
	it("builds a bounded repair prompt for a failing acceptance gate", () => {
		const plan = buildNKleinAcceptanceRepairPlan({
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

	it("escalates once to the reviewer role after repair attempts are exhausted", () => {
		const plan = buildNKleinAcceptanceRepairPlan({
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

	it("hands off after the single escalation attempt also failed", () => {
		const plan = buildNKleinAcceptanceRepairPlan({
			taskId: "task-1",
			taskPrompt: "Implement the fix.\nAcceptance check: npm test",
			acceptance: failedAcceptance,
			attempt: 4,
			maxAttempts: 2,
			modelRoles: {
				reviewer: {
					providerId: "anthropic",
					modelId: "claude-sonnet",
				},
			},
		});

		expect(plan).toMatchObject({
			action: "human_review",
			escalatedRole: null,
			escalatedSettings: null,
		});
		expect(plan?.prompt).toContain("prepare a concise human handoff");
	});

	it("hands off immediately for acceptance setup failures", () => {
		const plan = buildNKleinAcceptanceRepairPlan({
			taskId: "task-1",
			taskPrompt: "Implement the fix.\nAcceptance check: cd /workspaces/dev-old-task && npm test",
			acceptance: {
				...failedAcceptance,
				command: "cd /workspaces/dev-old-task && npm test",
				output: "sh: 1: cd: can't cd to /workspaces/dev-old-task",
				failureCategory: "acceptance_setup_error",
				failureHint: "The acceptance command could not enter its configured sandbox working directory.",
			},
			attempt: 1,
			maxAttempts: 2,
			modelRoles: {
				reviewer: {
					providerId: "anthropic",
					modelId: "claude-sonnet",
				},
			},
		});

		expect(plan).toMatchObject({
			action: "human_review",
			attempt: 1,
			escalatedRole: null,
			escalatedSettings: null,
			summary: "Acceptance setup failed; hand off for human review.",
		});
		expect(plan?.prompt).toContain("could not enter its configured working directory");
		expect(plan?.prompt).toContain("Failure hint:");
	});

	it("returns null when the acceptance gate passed or was missing", () => {
		expect(
			buildNKleinAcceptanceRepairPlan({
				taskId: "task-1",
				taskPrompt: "Implement the fix.",
				acceptance: { ...failedAcceptance, passed: true, exitCode: 0 },
				attempt: 1,
			}),
		).toBeNull();
		expect(
			buildNKleinAcceptanceRepairPlan({
				taskId: "task-1",
				taskPrompt: "Implement the fix.",
				acceptance: {
					present: false,
					command: null,
					passed: null,
					exitCode: null,
					output: "",
					durationMs: 0,
					failureCategory: null,
					failureHint: null,
				},
				attempt: 1,
			}),
		).toBeNull();
	});
});
