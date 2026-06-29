import { describe, expect, it } from "vitest";
import { resolveTaskBaseRef } from "../../../src/commands/task/task-runtime-workspace";
import type { RuntimeWorkspaceStateResponse } from "../../../src/core/api-contract";

const stateWithGit = (git: Partial<RuntimeWorkspaceStateResponse["git"]>): RuntimeWorkspaceStateResponse =>
	({ git: { currentBranch: null, defaultBranch: null, branches: [], ...git } }) as RuntimeWorkspaceStateResponse;

describe("resolveTaskBaseRef", () => {
	it("prefers the current branch, then default, then the first branch, then empty string", () => {
		expect(resolveTaskBaseRef(stateWithGit({ currentBranch: "feature", defaultBranch: "main" }))).toBe("feature");
		expect(resolveTaskBaseRef(stateWithGit({ currentBranch: null, defaultBranch: "main" }))).toBe("main");
		expect(resolveTaskBaseRef(stateWithGit({ defaultBranch: null, branches: ["dev", "x"] }))).toBe("dev");
		expect(resolveTaskBaseRef(stateWithGit({}))).toBe("");
	});
});
