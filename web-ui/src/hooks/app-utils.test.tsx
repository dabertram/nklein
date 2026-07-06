import { describe, expect, it } from "vitest";

import {
	buildDetailTaskUrl,
	buildProjectPathname,
	normalizeStoredTaskAutoReviewMode,
	parseDetailTaskIdFromSearch,
	parseProjectIdFromPathname,
} from "@/hooks/app-utils";

describe("parseDetailTaskIdFromSearch", () => {
	it("returns the selected task id when present", () => {
		expect(parseDetailTaskIdFromSearch("?task=task-123")).toBe("task-123");
	});

	it("returns null when the task id is missing or blank", () => {
		expect(parseDetailTaskIdFromSearch("")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=")).toBeNull();
		expect(parseDetailTaskIdFromSearch("?task=%20%20")).toBeNull();
	});
});

describe("buildDetailTaskUrl", () => {
	it("adds the task id while preserving other query params and hash", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board",
				hash: "#panel",
				taskId: "task-123",
			}),
		).toBe("/project-1?view=board&task=task-123#panel");
	});

	it("removes the task id while preserving other query params", () => {
		expect(
			buildDetailTaskUrl({
				pathname: "/project-1",
				search: "?view=board&task=task-123",
				hash: "",
				taskId: null,
			}),
		).toBe("/project-1?view=board");
	});
});

describe("parseProjectIdFromPathname / buildProjectPathname", () => {
	it("reads the first path segment as the (URL-decoded) project id", () => {
		expect(parseProjectIdFromPathname("/project-1")).toBe("project-1");
		expect(parseProjectIdFromPathname("/a/b/c")).toBe("a"); // only the first segment
		expect(parseProjectIdFromPathname("/proj%20ect")).toBe("proj ect"); // percent-decoded
	});

	it("returns null for a root/empty pathname", () => {
		expect(parseProjectIdFromPathname("")).toBeNull();
		expect(parseProjectIdFromPathname("/")).toBeNull();
		expect(parseProjectIdFromPathname("//")).toBeNull();
	});

	it("returns null (never throws) on a malformed percent-encoding", () => {
		expect(parseProjectIdFromPathname("/%zz")).toBeNull();
	});

	it("builds a percent-encoded single-segment pathname", () => {
		expect(buildProjectPathname("project-1")).toBe("/project-1");
		expect(buildProjectPathname("a b")).toBe("/a%20b");
	});

	it("round-trips ids — even ones containing a slash (encoded to %2F, so the split can't lose it)", () => {
		for (const id of ["project-1", "a b", "weird/slash", "unïcode"]) {
			expect(parseProjectIdFromPathname(buildProjectPathname(id))).toBe(id);
		}
	});
});

describe("normalizeStoredTaskAutoReviewMode", () => {
	it("accepts the two valid modes and rejects anything else (stored value is untrusted)", () => {
		expect(normalizeStoredTaskAutoReviewMode("commit")).toBe("commit");
		expect(normalizeStoredTaskAutoReviewMode("pr")).toBe("pr");
		expect(normalizeStoredTaskAutoReviewMode("")).toBeNull();
		expect(normalizeStoredTaskAutoReviewMode("PR")).toBeNull(); // case-sensitive
		expect(normalizeStoredTaskAutoReviewMode("move_to_trash")).toBeNull(); // a legacy value is not silently accepted
	});
});
