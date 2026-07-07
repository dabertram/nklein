import { describe, expect, it } from "vitest";
import {
	normalizePathForComparison,
	parseTaskWorktreeTaskId,
	readPendingPlanArtifactInfo,
} from "../../../src/workspace/project-health";

describe("normalizePathForComparison", () => {
	it("folds backslashes to forward slashes so Windows and POSIX paths compare equal", () => {
		expect(normalizePathForComparison("C:\\Users\\x\\repo")).toBe("C:/Users/x/repo");
	});

	it("strips one OR many trailing slashes (so 'a/b/' and 'a/b///' both match 'a/b')", () => {
		expect(normalizePathForComparison("/home/wt/")).toBe("/home/wt");
		expect(normalizePathForComparison("/home/wt///")).toBe("/home/wt");
		expect(normalizePathForComparison("/home/wt")).toBe("/home/wt");
	});
});

describe("parseTaskWorktreeTaskId", () => {
	const home = "/home/user/.nklein/task-worktrees";

	it("extracts the first path segment under the worktrees home as the task id", () => {
		expect(parseTaskWorktreeTaskId(`${home}/task-abc/repo`, home)).toBe("task-abc");
		// A repo directly at <home>/<taskId> (no nested repo dir) still yields the task id.
		expect(parseTaskWorktreeTaskId(`${home}/task-xyz`, home)).toBe("task-xyz");
	});

	it("returns null when the repo path is OUTSIDE the worktrees home (would escape via ../)", () => {
		expect(parseTaskWorktreeTaskId("/some/other/place", home)).toBe(null);
	});

	it("returns null when the repo path IS the worktrees home (no task segment)", () => {
		expect(parseTaskWorktreeTaskId(home, home)).toBe(null);
	});

	it("returns null for the parent of the worktrees home (relative resolves to '..')", () => {
		expect(parseTaskWorktreeTaskId("/home/user/.nklein", home)).toBe(null);
	});
});

describe("readPendingPlanArtifactInfo", () => {
	it("returns null for non-object inputs (null, arrays, primitives)", () => {
		expect(readPendingPlanArtifactInfo(null)).toBe(null);
		expect(readPendingPlanArtifactInfo("pending")).toBe(null);
		expect(readPendingPlanArtifactInfo(42)).toBe(null);
		expect(readPendingPlanArtifactInfo([{ applicationStatus: "pending" }])).toBe(null);
	});

	it("returns null unless applicationStatus is exactly 'pending'", () => {
		expect(readPendingPlanArtifactInfo({ applicationStatus: "applied" })).toBe(null);
		expect(readPendingPlanArtifactInfo({ applicationStatus: "rejected", sourceTaskId: "t1" })).toBe(null);
		expect(readPendingPlanArtifactInfo({})).toBe(null);
	});

	it("captures a non-blank string sourceTaskId when pending", () => {
		expect(readPendingPlanArtifactInfo({ applicationStatus: "pending", sourceTaskId: "task-7" })).toEqual({
			sourceTaskId: "task-7",
		});
	});

	it("normalizes a missing, blank, or non-string sourceTaskId to null while staying pending", () => {
		expect(readPendingPlanArtifactInfo({ applicationStatus: "pending" })).toEqual({ sourceTaskId: null });
		expect(readPendingPlanArtifactInfo({ applicationStatus: "pending", sourceTaskId: "   " })).toEqual({
			sourceTaskId: null,
		});
		expect(readPendingPlanArtifactInfo({ applicationStatus: "pending", sourceTaskId: 99 })).toEqual({
			sourceTaskId: null,
		});
	});
});
