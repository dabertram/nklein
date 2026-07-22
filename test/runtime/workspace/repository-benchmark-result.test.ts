import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	captureBenchmarkWorkspaceResult,
	verifySealedBenchmarkWorkspace,
} from "../../../src/workspace/repository-benchmark-result";

function git(repoPath: string, ...args: string[]): string {
	return execFileSync("git", ["-C", repoPath, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Benchmark Test",
			GIT_AUTHOR_EMAIL: "benchmark@example.invalid",
			GIT_COMMITTER_NAME: "Benchmark Test",
			GIT_COMMITTER_EMAIL: "benchmark@example.invalid",
		},
	}).trim();
}

async function makeBaseline(): Promise<string> {
	const repoPath = await mkdtemp(join(tmpdir(), "nklein-benchmark-result-"));
	git(repoPath, "init", "--initial-branch=benchmark-baseline");
	await writeFile(join(repoPath, "source.txt"), "before\n");
	git(repoPath, "add", "--all");
	git(repoPath, "commit", "--message", "sealed upstream baseline");
	return repoPath;
}

describe("repository benchmark result", () => {
	it("admits only a pristine one-commit sealed baseline", async () => {
		const repoPath = await makeBaseline();
		const verified = await verifySealedBenchmarkWorkspace({ repoPath });
		expect(verified.baseCommit).toBe(git(repoPath, "rev-parse", "HEAD"));

		await writeFile(join(repoPath, "oracle-test.patch"), "private\n");
		await expect(verifySealedBenchmarkWorkspace({ repoPath })).rejects.toThrow(/not pristine/);
	});

	it("pins and diffs the exact clean terminal aggregate commit, including binary-safe output", async () => {
		const repoPath = await makeBaseline();
		const { baseCommit } = await verifySealedBenchmarkWorkspace({ repoPath });
		await writeFile(join(repoPath, "source.txt"), "after\n");
		git(repoPath, "add", "--all");
		git(repoPath, "commit", "--message", "delivered benchmark repair");

		const captured = await captureBenchmarkWorkspaceResult({ repoPath, baseCommit, runId: "task/run 1" });
		expect(captured.patch).toContain("-before");
		expect(captured.patch).toContain("+after");
		expect(git(repoPath, "rev-parse", captured.evidenceRef)).toBe(captured.resultCommit);
		await expect(captureBenchmarkWorkspaceResult({ repoPath, baseCommit, runId: "task/run 1" })).rejects.toThrow(
			/Could not pin benchmark evidence ref/,
		);
	});

	it("refuses to score dirty or unrelated terminal state", async () => {
		const repoPath = await makeBaseline();
		const { baseCommit } = await verifySealedBenchmarkWorkspace({ repoPath });
		await writeFile(join(repoPath, "unsettled.txt"), "dirty\n");
		await expect(captureBenchmarkWorkspaceResult({ repoPath, baseCommit, runId: "dirty" })).rejects.toThrow(/dirty/);
	});
});
