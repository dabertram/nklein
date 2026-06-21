import { beforeEach, describe, expect, it, vi } from "vitest";

import { runGit } from "../../../src/workspace/git-utils";
import { initializeGitRepository, isGitRepositoryCreatedByKanban } from "../../../src/workspace/initialize-repo";

vi.mock("../../../src/workspace/git-utils", () => ({
	runGit: vi.fn(),
}));

const runGitMock = vi.mocked(runGit);

function gitResult(ok: boolean, stdout = "") {
	return {
		ok,
		stdout,
		stderr: "",
		output: stdout,
		error: ok ? null : "Git command failed.",
		exitCode: ok ? 0 : 1,
	};
}

describe("Git repository ownership", () => {
	beforeEach(() => {
		runGitMock.mockReset();
	});

	it("marks repositories initialized by !Klein", async () => {
		runGitMock.mockResolvedValue(gitResult(true));

		await expect(initializeGitRepository("/project")).resolves.toEqual({
			ok: true,
			error: null,
		});
		expect(runGitMock).toHaveBeenNthCalledWith(1, "/project", ["init"]);
		expect(runGitMock).toHaveBeenNthCalledWith(2, "/project", ["rev-parse", "--verify", "HEAD"]);
		expect(runGitMock).toHaveBeenNthCalledWith(3, "/project", [
			"config",
			"--local",
			"kanban.repositoryCreatedByKanban",
			"true",
		]);
	});

	it("migrates repositories with !Klein's legacy initial commit", async () => {
		runGitMock
			.mockResolvedValueOnce(gitResult(false))
			.mockResolvedValueOnce(gitResult(true, "Initial commit through NKlein Kanban"))
			.mockResolvedValueOnce(gitResult(true));

		await expect(isGitRepositoryCreatedByKanban("/project")).resolves.toBe(true);
		expect(runGitMock).toHaveBeenLastCalledWith("/project", [
			"config",
			"--local",
			"kanban.repositoryCreatedByKanban",
			"true",
		]);
	});

	it("does not claim repositories without a marker or legacy commit", async () => {
		runGitMock.mockResolvedValueOnce(gitResult(false)).mockResolvedValueOnce(gitResult(true, "Initial commit"));

		await expect(isGitRepositoryCreatedByKanban("/project")).resolves.toBe(false);
		expect(runGitMock).toHaveBeenCalledTimes(2);
	});
});
