import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

/**
 * Every `git` child process launched from `src/` must run with a sanitised environment.
 *
 * Live 2026-09-08, and misdiagnosed as flaky for a whole day. `swebench-materialize.ts` ran `git init/add/commit`
 * in a throwaway repo without `createGitProcessEnv()`. Under the pre-commit hook the test suite inherits the
 * hook's `GIT_INDEX_FILE`, so that `git add -A` wrote its fixture files into the OUTER commit's index while the
 * blobs stayed in the temp repo's object store. The commit then died with
 * `error: invalid object … src/lib.py` / `Error building trees` — after the hook had already passed, and only for
 * commits that set an index (a plain `git commit` is unaffected), which is exactly why it read as intermittent.
 *
 * Reads are not safe either: an inherited `GIT_DIR` overrides `-C <dir>`, so a "read this repo" call quietly reads
 * a different one. `createGitProcessEnv` exists precisely for this and strips the whole repository-scoping family.
 */
// The call may wrap: `execFileAsync(\n\t"git",\n\t[...]` is the same hazard as the one-liner.
const GIT_CALL = /(?:execFile|execFileAsync|execFileSync|spawn|spawnSync)\(\s*\n?\s*["']git["']/u;

describe("git child processes in src/ sanitise their environment", () => {
	it("never launches git without createGitProcessEnv (an inherited hook index hijacks the call)", () => {
		const offenders: string[] = [];
		for (const file of globSync("src/**/*.ts", { absolute: false })) {
			const source = readFileSync(join(process.cwd(), file), "utf8");
			if (!GIT_CALL.test(source)) {
				continue;
			}
			// `runGit` in src/workspace/git-utils.ts is the sanctioned wrapper and applies the sanitiser itself.
			if (file.endsWith("git-utils.ts") || file.endsWith("git-process-env.ts")) {
				continue;
			}
			if (!source.includes("createGitProcessEnv")) {
				offenders.push(file);
			}
		}
		expect(
			offenders,
			`these modules spawn git without createGitProcessEnv(), so a parent git hook's GIT_INDEX_FILE/GIT_DIR hijacks them:\n  ${offenders.join("\n  ")}`,
		).toEqual([]);
	});
});
