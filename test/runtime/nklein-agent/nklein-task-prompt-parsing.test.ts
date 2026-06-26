import { describe, expect, it } from "vitest";
import {
	isDecompositionPlanningPrompt,
	isExplicitDecompositionPrompt,
	parseAcceptanceCommand,
	parseRequestedMinimumTaskCount,
} from "../../../src/nklein-agent/nklein-task-prompt-parsing";

describe("parseRequestedMinimumTaskCount", () => {
	it("reads a numeric 'at least N'", () => {
		expect(parseRequestedMinimumTaskCount("Decompose this; at least 8 cards.")).toBe(8);
	});
	it("reads a 'minimum task count: N'", () => {
		expect(parseRequestedMinimumTaskCount("minimum task count: 12")).toBe(12);
	});
	it("reads a spelled-out 'at least ten'", () => {
		expect(parseRequestedMinimumTaskCount("Please produce at least ten cards")).toBe(10);
	});
	it("returns null when no count is requested", () => {
		expect(parseRequestedMinimumTaskCount("Just build the thing")).toBeNull();
	});
});

describe("parseAcceptanceCommand", () => {
	it("extracts the acceptance command line", () => {
		expect(parseAcceptanceCommand("Do X.\nAcceptance command: npm test\nThanks")).toBe("npm test");
	});
	it("returns null without an acceptance line", () => {
		expect(parseAcceptanceCommand("No command here")).toBeNull();
	});
});

describe("isExplicitDecompositionPrompt", () => {
	it("is true for decompose_project / minimumTaskCount mentions", () => {
		expect(isExplicitDecompositionPrompt("call decompose_project now")).toBe(true);
		expect(isExplicitDecompositionPrompt("minimumTaskCount=5")).toBe(true);
	});
	it("is false otherwise", () => {
		expect(isExplicitDecompositionPrompt("build a feature")).toBe(false);
	});
});

describe("isDecompositionPlanningPrompt", () => {
	it("matches broad planning language", () => {
		expect(isDecompositionPlanningPrompt("produce a task graph")).toBe(true);
		expect(isDecompositionPlanningPrompt("at least three dependent implementation cards")).toBe(true);
		expect(isDecompositionPlanningPrompt("decomposition of the project")).toBe(true);
	});
	it("is false for a plain implementation prompt", () => {
		expect(isDecompositionPlanningPrompt("add a button to the toolbar")).toBe(false);
	});
});
