import { describe, expect, it } from "vitest";
import {
	buildAcceptanceFailureEvidence,
	classifyAcceptanceFailurePlanGap,
	parsePlanGapKind,
	shouldRecordAcceptancePlanGap,
} from "../../../src/commands/task/task-acceptance-plan-gap";

describe("parsePlanGapKind", () => {
	it("parses a valid kind and rejects an unknown one", () => {
		expect(parsePlanGapKind("missing_dependency")).toBe("missing_dependency");
		expect(() => parsePlanGapKind("nonsense")).toThrow();
	});
});

describe("shouldRecordAcceptancePlanGap", () => {
	it("records when acceptance is absent, or repair escalated / needs human review", () => {
		expect(shouldRecordAcceptancePlanGap({ acceptancePresent: false, repairAction: null })).toBe(true);
		expect(shouldRecordAcceptancePlanGap({ acceptancePresent: true, repairAction: "escalate" })).toBe(true);
		expect(shouldRecordAcceptancePlanGap({ acceptancePresent: true, repairAction: "human_review" })).toBe(true);
	});
	it("does not record when acceptance is present and repair did not escalate", () => {
		expect(shouldRecordAcceptancePlanGap({ acceptancePresent: true, repairAction: null })).toBe(false);
	});
});

describe("buildAcceptanceFailureEvidence", () => {
	it("includes command + output lines; truncates to 2000 chars", () => {
		expect(buildAcceptanceFailureEvidence({ command: "npm test", output: "boom", taskPrompt: "p" })).toBe(
			"Command: npm test\nOutput: boom",
		);
		expect(buildAcceptanceFailureEvidence({ command: null, output: "x".repeat(5000), taskPrompt: "p" }).length).toBe(
			2000,
		);
	});
	it("falls back to the task prompt when there is no command and no output", () => {
		expect(buildAcceptanceFailureEvidence({ command: null, output: "   ", taskPrompt: "do the thing" })).toBe(
			"do the thing",
		);
	});
});

describe("classifyAcceptanceFailurePlanGap", () => {
	const base = { acceptancePresent: true, repairAction: "escalate" as const, command: "npm test", taskPrompt: "p" };

	it("returns null when the failure should not be recorded as a plan gap", () => {
		expect(classifyAcceptanceFailurePlanGap({ ...base, repairAction: null, output: "transient" })).toBeNull();
	});

	it("flags a missing Acceptance line as 'other' with the prompt as evidence", () => {
		const result = classifyAcceptanceFailurePlanGap({ ...base, acceptancePresent: false, output: "" });
		expect(result?.kind).toBe("other");
		expect(result?.description).toMatch(/missing the required Acceptance/i);
	});

	it("classifies by output pattern (dependency / scope / decision / contradiction)", () => {
		expect(classifyAcceptanceFailurePlanGap({ ...base, output: "Error: Cannot find module 'zod'" })?.kind).toBe(
			"missing_dependency",
		);
		expect(classifyAcceptanceFailurePlanGap({ ...base, output: "the run timed out after 600s" })?.kind).toBe(
			"scope_too_large",
		);
		expect(classifyAcceptanceFailurePlanGap({ ...base, output: "requirement is ambiguous here" })?.kind).toBe(
			"missing_decision",
		);
		expect(classifyAcceptanceFailurePlanGap({ ...base, output: "these are mutually exclusive" })?.kind).toBe(
			"contradictory_requirement",
		);
	});

	it("falls back to 'other' (plan-level review) when no pattern matches", () => {
		const result = classifyAcceptanceFailurePlanGap({ ...base, output: "assertion failed: expected 2 got 3" });
		expect(result?.kind).toBe("other");
		expect(result?.description).toMatch(/plan-level review/i);
	});
});
