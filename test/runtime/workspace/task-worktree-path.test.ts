import { describe, expect, it } from "vitest";
import { isPathInsideTaskWorktreesHome } from "../../../src/workspace/task-worktree-path";

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
