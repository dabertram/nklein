/**
 * N8 — SWE-bench tranche PURE core: the instance contract between the fetcher's pinned cache
 * (`scripts/swebench-fetch.mts`, the explicit egress step) and the hermetic nightly cell that drains it.
 *
 * Boundaries this module enforces by construction:
 *  - The GOLD PATCH never appears here (the fetcher drops it; the type cannot carry it) — leakage-safe.
 *  - `test_patch` belongs to the GRADER, never the workspace the agent sees: the agent works on the repo at
 *    `base_commit` exactly; the harness applies the instance's own test changes only when judging.
 *  - Resolution is SWE-bench's rule verbatim: 100% of FAIL_TO_PASS pass AND 100% of PASS_TO_PASS stay green —
 *    a partial fix is `unresolved`, not a fraction (the invariant pack asserts a boolean, not a score).
 */

import { createHash } from "node:crypto";

/** One vendored instance's metadata, as staged by the fetcher (gold patch measured for selection, then dropped). */
export interface SwebenchInstanceMetadata {
	readonly instanceId: string;
	readonly repo: string;
	readonly baseCommit: string;
	readonly datasets: readonly string[];
	readonly failToPass: readonly string[];
	readonly passToPass: readonly string[];
	readonly testPatch: string;
	readonly problemStatement: string;
	readonly goldPatchBytes: number;
	readonly goldPatchFiles: number;
	readonly version: string | null;
}

export interface SwebenchPin {
	readonly repo: string;
	readonly baseCommit: string;
	readonly tarballSha256: string;
	readonly bytes: number;
}

export type SwebenchPinVerification =
	| { readonly ok: true; readonly sha256: string }
	| { readonly ok: false; readonly reason: string };

/** Verify a cached tarball against its pin BEFORE extraction — hash drift means the cache is not the recipe. */
export function verifySwebenchPin(tarball: Uint8Array, pin: SwebenchPin): SwebenchPinVerification {
	const sha256 = createHash("sha256").update(tarball).digest("hex");
	if (sha256 !== pin.tarballSha256) {
		return {
			ok: false,
			reason: `tarball sha256 ${sha256.slice(0, 12)}… does not match pin ${pin.tarballSha256.slice(0, 12)}… — refetch with scripts/swebench-fetch.mts`,
		};
	}
	if (tarball.byteLength !== pin.bytes) {
		return { ok: false, reason: `tarball is ${tarball.byteLength} bytes, pin says ${pin.bytes}` };
	}
	return { ok: true, sha256 };
}

/** The board card an instance becomes — the issue text IS the prompt (N8), plus the two harness ground rules. */
export function buildSwebenchCard(instance: SwebenchInstanceMetadata): {
	readonly taskId: string;
	readonly title: string;
	readonly prompt: string;
} {
	const firstLine =
		instance.problemStatement
			.split("\n")
			.find((line) => line.trim() !== "")
			?.trim() ?? "";
	const title = `${instance.instanceId}: ${firstLine}`.slice(0, 120);
	const prompt = [
		`Fix the following issue in this repository (${instance.repo} @ ${instance.baseCommit.slice(0, 12)}).`,
		"Do not modify existing tests; fix the library code so the described behavior is correct.",
		"",
		instance.problemStatement.trim(),
	].join("\n");
	return { taskId: `swebench-${instance.instanceId}`, title, prompt };
}

/**
 * The grader's plan: apply the instance's OWN test changes, then run exactly the instance's FAIL_TO_PASS and
 * PASS_TO_PASS selections. Deterministic single command per group; `-rA` prints one summary line per test in
 * every outcome class, which is what the parser consumes.
 */
export function buildSwebenchGradePlan(instance: SwebenchInstanceMetadata): {
	readonly testPatch: string;
	readonly failToPassCommand: readonly string[];
	readonly passToPassCommand: readonly string[];
} {
	// No `--no-header`: it only exists from pytest 6.2, and pytest-repo instances run THEIR OWN pytest — the
	// 5.x-era tranche members reject unknown flags as a usage error (probe-caught 2026-08-05, pytest-6202).
	const base = ["python", "-m", "pytest", "-rA", "-p", "no:cacheprovider"];
	return {
		testPatch: instance.testPatch,
		failToPassCommand: [...base, ...instance.failToPass],
		passToPassCommand: [...base, ...instance.passToPass],
	};
}

export interface SwebenchGradeVerdict {
	readonly resolved: boolean;
	readonly failToPassPassed: readonly string[];
	readonly failToPassFailed: readonly string[];
	readonly passToPassFailed: readonly string[];
	readonly reason: string;
}

/**
 * Judge pytest `-rA` output for the two selections. A test id counts as PASSED only when its own summary line
 * says so; anything else — failed, errored, skipped, or MISSING from the output entirely (collection error,
 * wrong node id) — is a failure of that group. Missing-as-failure is load-bearing: a collection crash prints
 * no per-test lines at all, and treating silence as success would grade a broken run as resolved.
 */
export function parseSwebenchGradeOutput(input: {
	readonly failToPass: readonly string[];
	readonly passToPass: readonly string[];
	readonly failToPassOutput: string;
	readonly passToPassOutput: string;
}): SwebenchGradeVerdict {
	const passedIn = (output: string): Set<string> => {
		const passed = new Set<string>();
		for (const line of output.split("\n")) {
			const match = /^PASSED\s+(\S+)/.exec(line.trim());
			if (match?.[1]) {
				passed.add(match[1]);
			}
		}
		return passed;
	};
	// pytest may print node ids with parametrization/whitespace variants; match on exact id OR the id as a
	// prefix of a printed pass (a parametrized selection like `test_a[x]` prints exactly; a module selection
	// never appears verbatim, so exactness is required for test ids and prefix matching is NOT used for them).
	const f2pPassedSet = passedIn(input.failToPassOutput);
	const p2pPassedSet = passedIn(input.passToPassOutput);
	const failToPassPassed = input.failToPass.filter((testId) => f2pPassedSet.has(testId));
	const failToPassFailed = input.failToPass.filter((testId) => !f2pPassedSet.has(testId));
	const passToPassFailed = input.passToPass.filter((testId) => !p2pPassedSet.has(testId));
	const resolved = failToPassFailed.length === 0 && passToPassFailed.length === 0;
	const reason = resolved
		? `resolved: ${failToPassPassed.length}/${input.failToPass.length} fail-to-pass now green, ${input.passToPass.length} pass-to-pass held`
		: `unresolved: ${failToPassFailed.length} fail-to-pass still failing${passToPassFailed.length > 0 ? `, ${passToPassFailed.length} pass-to-pass REGRESSED` : ""}`;
	return { resolved, failToPassPassed, failToPassFailed, passToPassFailed, reason };
}
