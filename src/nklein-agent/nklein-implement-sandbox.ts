import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildImplementHarnessScript,
	type ImplementHarnessResult,
	type ImplementTest,
	parseImplementHarnessOutput,
} from "../core/implement-eval-harness";

/**
 * P22.2 / decision 2026-07-31 — execute an `implement` candidate under a real boundary.
 *
 * ── THE BOUNDARY ──
 * A child `node --permission` process. Verified on this platform (Node 25) that the flag denies, with
 * `ERR_ACCESS_DENIED`: filesystem reads, `child_process`, outbound `net` sockets, and `process.binding`. The only
 * read granted is the throwaway directory holding the harness script itself, which the child must load to run.
 * A wall-clock timeout covers the remaining failure mode the permission model does not — non-termination.
 *
 * **Scope of the claim:** this contains a local model's honest attempt at a pure function, including the ways
 * such an attempt goes wrong (infinite loops, exceptions, filesystem curiosity). It is NOT a claim of containment
 * against code written to escape; that threat model needs the Docker isolation !Klein already uses for agent work.
 *
 * ── WHY THE TEMP DIRECTORY IS PER-RUN AND ALWAYS REMOVED ──
 * The script embeds model-authored code. Leaving it behind would accumulate untrusted files under the system temp
 * directory, and reusing one path across runs would let a slow child from a previous run be read by the next.
 */

/** Generous: a correct pure function finishes in milliseconds, so this only catches non-termination. */
const DEFAULT_IMPLEMENT_TIMEOUT_MS = 10_000;

export interface RunImplementCandidateInput {
	readonly code: string;
	readonly tests: readonly ImplementTest[];
	readonly timeoutMs?: number;
	/** Injected for tests; defaults to the real child-process runner. */
	readonly execFileImpl?: typeof execFile;
}

/**
 * Run a candidate implementation against its assertions.
 *
 * Returns `null` when nothing could be measured — a timeout, a crash, or a candidate that exited before
 * reporting. Deliberately distinct from `0/N`: "failed every test" and "produced no evidence" are different
 * facts, and the eval runner scores a null as *no scorable answer* rather than as a zero the model did not earn.
 */
export async function runImplementCandidate(input: RunImplementCandidateInput): Promise<ImplementHarnessResult | null> {
	// ⚠️ REAL path, not the one `tmpdir()` hands back. On macOS that is `/var/folders/...`, a SYMLINK to
	// `/private/var/folders/...`, and Node's permission model matches the RESOLVED path — so granting the
	// symlinked form denies the child its own script and every run silently returns "no evidence". Found by
	// capturing the child's stderr, which showed it failing inside `node:fs` before running a line of the harness.
	const directory = await realpath(await mkdtemp(join(tmpdir(), "nklein-implement-")));
	const scriptPath = join(directory, "harness.js");
	try {
		await writeFile(scriptPath, buildImplementHarnessScript({ code: input.code, tests: input.tests }), "utf8");
		const stdout = await new Promise<string>((resolve) => {
			const runner = input.execFileImpl ?? execFile;
			runner(
				process.execPath,
				// `--allow-fs-read` is scoped to the throwaway directory only: the child must read its own script
				// and nothing else. Every other capability stays denied by `--permission`.
				["--permission", `--allow-fs-read=${directory}`, scriptPath],
				{ timeout: input.timeoutMs ?? DEFAULT_IMPLEMENT_TIMEOUT_MS, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" },
				(_error, childStdout) => {
					// A non-zero exit or a kill is NOT an error case to propagate: the sentinel decides whether
					// anything was measured. A candidate can fail loudly and still have reported its results first.
					resolve(String(childStdout ?? ""));
				},
			);
		});
		return parseImplementHarnessOutput(stdout);
	} catch {
		return null;
	} finally {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
	}
}
