import { describe, expect, it } from "vitest";
import {
	buildTaskWorktreeDisplayPath,
	getWorkspaceFolderLabelForWorktreePath,
	isPathInsideTaskWorktreesHome,
	KANBAN_TASK_WORKTREES_DISPLAY_ROOT,
	normalizeTaskIdForWorktreePath,
} from "../../../src/workspace/task-worktree-path";

describe("isPathInsideTaskWorktreesHome", () => {
	it("matches the root exactly or a true sub-path, normalizing trailing slashes", () => {
		expect(isPathInsideTaskWorktreesHome("/home/u/.nklein/worktrees", "/home/u/.nklein/worktrees")).toBe(true);
		expect(isPathInsideTaskWorktreesHome("/home/u/.nklein/worktrees/t1/repo", "/home/u/.nklein/worktrees/")).toBe(
			true,
		);
	});
	it("rejects a sibling that merely shares a prefix, and empty inputs", () => {
		// "/a/bc" is not inside "/a/b" — must require a path separator boundary.
		expect(isPathInsideTaskWorktreesHome("/a/bc", "/a/b")).toBe(false);
		expect(isPathInsideTaskWorktreesHome("", "/a/b")).toBe(false);
		expect(isPathInsideTaskWorktreesHome("/a/b", "")).toBe(false);
	});
});

describe("normalizeTaskIdForWorktreePath", () => {
	it("trims and returns a valid task id", () => {
		expect(normalizeTaskIdForWorktreePath("  task-123  ")).toBe("task-123");
	});
	it("rejects empty ids and path-traversal characters", () => {
		for (const bad of ["", "   ", "a/b", "a\\b", "..", "../x", "a..b"]) {
			expect(() => normalizeTaskIdForWorktreePath(bad)).toThrow(/Invalid task id/);
		}
	});
});

describe("getWorkspaceFolderLabelForWorktreePath", () => {
	it("takes the last path segment, ignoring trailing separators", () => {
		expect(getWorkspaceFolderLabelForWorktreePath("/home/u/my-repo")).toBe("my-repo");
		expect(getWorkspaceFolderLabelForWorktreePath("/home/u/my-repo///")).toBe("my-repo");
		expect(getWorkspaceFolderLabelForWorktreePath("C:\\code\\proj")).toBe("proj");
	});
	it("strips control characters and falls back to 'workspace' when empty", () => {
		expect(getWorkspaceFolderLabelForWorktreePath("")).toBe("workspace");
		expect(getWorkspaceFolderLabelForWorktreePath("/")).toBe("workspace");
		expect(getWorkspaceFolderLabelForWorktreePath("/a/repo")).toBe("repo");
	});
});

describe("buildTaskWorktreeDisplayPath", () => {
	it("composes display-root / task-id / workspace-label", () => {
		expect(buildTaskWorktreeDisplayPath("t1", "/home/u/my-repo")).toBe(
			`${KANBAN_TASK_WORKTREES_DISPLAY_ROOT}/t1/my-repo`,
		);
	});
	it("rejects an invalid task id before building", () => {
		expect(() => buildTaskWorktreeDisplayPath("../escape", "/home/u/my-repo")).toThrow(/Invalid task id/);
	});
});
