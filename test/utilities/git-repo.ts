import { spawnSync } from "node:child_process";

import { createGitTestEnv } from "./git-env";

export interface RunTestGitOptions {
	/** Extra variables layered onto the sanitised environment. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Runs `git` against a test repository with a sanitised environment (see `createGitTestEnv`) and
 * throws on a non-zero exit. Every test that shells out to git should go through this rather than
 * calling `spawnSync("git", ...)` directly, so the sanitising can never be forgotten.
 */
export function runTestGit(cwd: string, args: string[], options: RunTestGitOptions = {}): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(options.env),
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const details = [`git ${args.join(" ")} failed in ${cwd}`, result.stdout?.trim(), result.stderr?.trim()]
			.filter((part) => part && part.length > 0)
			.join("\n");
		throw new Error(details);
	}
	return result.stdout.trim();
}

export interface InitTestRepositoryOptions extends RunTestGitOptions {
	/** Branch to start on. Defaults to `main` so tests do not depend on the host's `init.defaultBranch`. */
	branch?: string;
}

/** Creates an empty repository at `path` with a committer identity already configured. */
export function initTestRepository(path: string, options: InitTestRepositoryOptions = {}): void {
	const { branch = "main", ...gitOptions } = options;
	runTestGit(path, ["init", "-q", `--initial-branch=${branch}`], gitOptions);
	runTestGit(path, ["config", "user.name", "Test User"], gitOptions);
	runTestGit(path, ["config", "user.email", "test@example.com"], gitOptions);
}

/** Stages everything under `cwd` and commits it. Returns the new commit sha. */
export function commitAllInTestRepository(cwd: string, message: string, options: RunTestGitOptions = {}): string {
	runTestGit(cwd, ["add", "."], options);
	runTestGit(cwd, ["commit", "-qm", message], options);
	return runTestGit(cwd, ["rev-parse", "HEAD"], options);
}
