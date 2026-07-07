import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { createGitProcessEnv } from "./core/git-process-env";

/**
 * Filesystem + git path predicates used by the CLI (todo §5.U — extracted from cli.ts as a cohesive utility): assert /
 * test that a path is a directory, and detect whether a path sits inside a git work tree. Small self-contained checks
 * (coupling = node fs/child_process + the sanitized git env), lifted out of the CLI wiring and unit-testable.
 */

/** Throw if `path` is not a directory (used to validate a user-supplied project path). */
export async function assertPathIsDirectory(path: string): Promise<void> {
	const info = await stat(path);
	if (!info.isDirectory()) {
		throw new Error(`Project path is not a directory: ${path}`);
	}
}

/** True iff `path` exists and is a directory (never throws — a missing/unreadable path is simply false). */
export async function pathIsDirectory(path: string): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isDirectory();
	} catch {
		return false;
	}
}

/** True iff `path` is inside a git work tree (`git rev-parse --is-inside-work-tree` prints "true"). */
export function hasGitRepository(path: string): boolean {
	const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd: path,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		env: createGitProcessEnv(),
	});
	return result.status === 0 && result.stdout.trim() === "true";
}
