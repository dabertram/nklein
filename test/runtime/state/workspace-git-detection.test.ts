import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../../src/core/git-process-env";
import {
	detectGitRepositoryInfo,
	resetWorkspaceGitDetectionInFlightForTests,
} from "../../../src/state/workspace-git-detection";

const temporaryPaths: string[] = [];

afterEach(() => {
	resetWorkspaceGitDetectionInFlightForTests();
	for (const path of temporaryPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("workspace Git detection in-flight coalescing", () => {
	it("shares one repository-info result across a concurrent state-read wave", async () => {
		const repoPath = mkdtempSync(join(tmpdir(), "nklein-git-detection-"));
		temporaryPaths.push(repoPath);
		execFileSync("git", ["init", "-b", "main"], {
			cwd: repoPath,
			stdio: "ignore",
			env: createGitProcessEnv(),
		});

		const results = await Promise.all(Array.from({ length: 100 }, () => detectGitRepositoryInfo(repoPath)));

		expect(results[0]).toEqual({ currentBranch: "main", defaultBranch: "main", branches: ["main"] });
		expect(results.every((result) => result === results[0])).toBe(true);
		// No lasting cache: a later read gets a fresh object and therefore observes future branch changes.
		expect(await detectGitRepositoryInfo(repoPath)).not.toBe(results[0]);
	});
});
