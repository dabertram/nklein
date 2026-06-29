import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeGitRepositoryInfo } from "@/runtime/types";
import { useTaskBranchOptions } from "./use-task-branch-options";

type Result = ReturnType<typeof useTaskBranchOptions>;

let container: HTMLDivElement;
let root: Root;
let latest: Result;
let gitInput: RuntimeGitRepositoryInfo | null;

function Probe(): null {
	latest = useTaskBranchOptions({ workspaceGit: gitInput });
	return null;
}

function renderWith(git: RuntimeGitRepositoryInfo | null): Result {
	gitInput = git;
	act(() => root.render(<Probe />));
	return latest;
}

const git = (over: Partial<RuntimeGitRepositoryInfo>): RuntimeGitRepositoryInfo =>
	({ currentBranch: null, defaultBranch: null, branches: [], ...over }) as RuntimeGitRepositoryInfo;

describe("useTaskBranchOptions", () => {
	beforeEach(() => {
		container = document.createElement("div");
		root = createRoot(container);
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	});
	afterEach(() => act(() => root.unmount()));

	it("returns empty options and default for no git info", () => {
		const result = renderWith(null);
		expect(result.createTaskBranchOptions).toEqual([]);
		expect(result.defaultTaskBranchRef).toBe("");
	});

	it("labels current + default, dedupes, and prefers the current branch as default ref", () => {
		const result = renderWith(
			git({ currentBranch: "feature", defaultBranch: "main", branches: ["main", "feature", "dev"] }),
		);
		expect(result.createTaskBranchOptions).toEqual([
			{ value: "feature", label: "feature (current)" },
			{ value: "main", label: "main (default)" },
			{ value: "dev", label: "dev" },
		]);
		expect(result.defaultTaskBranchRef).toBe("feature");
	});

	it("falls back to the default branch as the ref when there is no current branch", () => {
		const result = renderWith(git({ currentBranch: null, defaultBranch: "main", branches: ["main", "x"] }));
		expect(result.createTaskBranchOptions).toEqual([
			{ value: "main", label: "main (default)" },
			{ value: "x", label: "x" },
		]);
		expect(result.defaultTaskBranchRef).toBe("main");
	});
});
