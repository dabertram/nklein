import { describe, expect, it } from "vitest";
import {
	parseAgentId,
	parseAutoMergeColumn,
	parseAutoReviewMode,
	parseOptionalStringOrDefault,
	slugifyPlanTaskId,
} from "../../../src/commands/task/task-command-parsers";

describe("slugifyPlanTaskId", () => {
	it("lowercases, collapses non-alphanumerics to single hyphens, trims edge hyphens", () => {
		expect(slugifyPlanTaskId("  My Cool Feature!! ")).toBe("my-cool-feature");
		expect(slugifyPlanTaskId("a___b   c")).toBe("a-b-c");
	});
	it("falls back to 'task' when nothing usable remains", () => {
		expect(slugifyPlanTaskId("")).toBe("task");
		expect(slugifyPlanTaskId("!!!")).toBe("task");
		expect(slugifyPlanTaskId("---")).toBe("task");
	});
});

describe("parseAutoMergeColumn", () => {
	it("defaults to review (undefined or explicit), maps completed/done, rejects others", () => {
		expect(parseAutoMergeColumn(undefined)).toBe("review");
		expect(parseAutoMergeColumn("review")).toBe("review");
		expect(parseAutoMergeColumn("completed")).toBe("completed");
		expect(parseAutoMergeColumn("done")).toBe("completed");
		expect(() => parseAutoMergeColumn("backlog")).toThrow(/Invalid merge column/);
	});
});

describe("parseAutoReviewMode", () => {
	it("passes commit/pr, returns undefined for absent, throws otherwise", () => {
		expect(parseAutoReviewMode(undefined)).toBeUndefined();
		expect(parseAutoReviewMode("commit")).toBe("commit");
		expect(parseAutoReviewMode("pr")).toBe("pr");
		expect(() => parseAutoReviewMode("squash")).toThrow(/Invalid auto review mode/);
	});
});

describe("parseAgentId", () => {
	it("maps undefined→undefined, 'default'→null, a valid id through, invalid→throws", () => {
		expect(parseAgentId(undefined)).toBeUndefined();
		expect(parseAgentId("default")).toBeNull();
		expect(parseAgentId("nklein")).toBe("nklein");
		expect(() => parseAgentId("not-an-agent")).toThrow(/Invalid agent ID/);
	});
});

describe("parseOptionalStringOrDefault", () => {
	it("maps undefined→undefined, 'default'→null, anything else through verbatim", () => {
		expect(parseOptionalStringOrDefault(undefined)).toBeUndefined();
		expect(parseOptionalStringOrDefault("default")).toBeNull();
		expect(parseOptionalStringOrDefault("main")).toBe("main");
	});
});
