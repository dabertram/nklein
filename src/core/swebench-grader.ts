/**
 * N8 — the SEALED grader: judge a (possibly fixed) SWE-bench workspace inside a stock `python:3.9-slim`
 * container. Two phases with an explicit egress boundary between them:
 *
 *  - `prepare` (network ON, once per instance): resolve + download the instance's wheel set INTO the cache
 *    (`.nklein-bench/swebench/wheels/<id>/`) with the container's exact python+platform — the only step that
 *    may touch PyPI, and it lives beside the fetcher as part of the explicit egress tool.
 *  - `grade` (`--network none`, every run): build a venv from the cached wheels with `--no-index`, editable-
 *    install the workspace, run the instance's own FAIL_TO_PASS / PASS_TO_PASS selections, and hand both
 *    outputs to the pure parser. Offline is not a claim here — the network namespace makes it a property.
 *
 * The instance's `test_patch` is applied HOST-side to a throwaway COPY of the delivered workspace before the
 * container ever starts (stock image ⇒ no git inside): the agent's workspace is never mutated, and the
 * container only ever executes pip-from-cache and pytest.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SwebenchInstanceMetadata } from "./swebench-instance";
import { buildSwebenchGradePlan, parseSwebenchGradeOutput, type SwebenchGradeVerdict } from "./swebench-instance";
import type { SwebenchTrancheEntry } from "./swebench-tranche";

const execFileAsync = promisify(execFile);

export const SWEBENCH_GRADER_IMAGE = "python:3.9-slim";

/**
 * The in-container shell for `prepare`: resolve the repo's deps + the tranche pins into the wheel cache. The
 * entry's probe-proven env facts apply HERE too — `pip download` builds the repo's metadata, and an isolated
 * build env gets the LATEST setuptools (no pkg_resources) and no scm pretend-version, which is exactly the
 * failure the facts exist to prevent (prepare-caught on pytest-5227).
 */
export function buildSwebenchPrepareScript(entry: SwebenchTrancheEntry): string {
	// The grade-time closure: era pins AND the offline build toolchain (pip download never includes PEP 517
	// build requirements in a source's closure — the whole first control sweep failed on exactly that).
	const pins = [...new Set([...swebenchToolchainRequirements(entry), ...entry.extraRequirements])];
	const installEnv = Object.entries(entry.installEnv)
		.map(([key, value]) => `${key}='${value}'`)
		.join(" ");
	const needsHostBuildEnv = entry.preInstallRequirements.length > 0;
	return [
		"set -eu",
		`mkdir -p /cache/wheels/${entry.instanceId}`,
		...(needsHostBuildEnv
			? [
					`python -m pip install --disable-pip-version-check -q wheel ${entry.preInstallRequirements
						.map((requirement) => `'${requirement}'`)
						.join(" ")}`,
				]
			: []),
		// The repo source resolves its own dependency constraints; pins ride along so their wheels land too.
		`${installEnv ? `env ${installEnv} ` : ""}python -m pip download --disable-pip-version-check -q ${
			needsHostBuildEnv ? "--no-build-isolation " : ""
		}--dest /cache/wheels/${entry.instanceId} /src ${pins.map((pin) => `'${pin}'`).join(" ")}`.trimEnd(),
		`ls /cache/wheels/${entry.instanceId} | wc -l`,
	].join("\n");
}

/** The build toolchain every offline editable install needs (pip's isolated build env is unreachable offline). */
export function swebenchToolchainRequirements(entry: SwebenchTrancheEntry): string[] {
	const pinnedSetuptools = entry.preInstallRequirements.find((requirement) => requirement.startsWith("setuptools"));
	return [
		"wheel",
		pinnedSetuptools ?? "setuptools",
		...entry.buildRequirements,
		...entry.preInstallRequirements.filter((requirement) => requirement !== pinnedSetuptools),
	];
}

/**
 * The in-container shell for `grade`: venv from cache only, toolchain first, editable install ALWAYS with
 * `--no-build-isolation` (an isolated build env tries to fetch setuptools from the index — impossible under
 * `--network none`; control-caught on the whole first tranche sweep). Every stage is diagnosable: pip
 * failures print a named marker line, and pytest's stderr merges into the parsed stream (`^PASSED` summary
 * lines cannot collide with diagnostics).
 */
export function buildSwebenchGradeScript(
	entry: SwebenchTrancheEntry,
	plan: Pick<ReturnType<typeof buildSwebenchGradePlan>, "failToPassCommand" | "passToPassCommand">,
): string {
	const wheels = `--no-index --find-links /cache/wheels/${entry.instanceId}`;
	const installEnv = Object.entries(entry.installEnv)
		.map(([key, value]) => `${key}='${value}'`)
		.join(" ");
	const quote = (parts: readonly string[]) => parts.map((part) => `'${part}'`).join(" ");
	const pipInstall = (what: string, stage: string) =>
		`python -m pip install --disable-pip-version-check -q ${wheels} ${what} 2>&1 || echo "SWEBENCH_PIP_FAILED ${stage}"`;
	return [
		"set -u",
		"python -m venv /tmp/venv",
		"export PATH=/tmp/venv/bin:$PATH",
		pipInstall(quote(swebenchToolchainRequirements(entry)), "toolchain"),
		`${installEnv ? `env ${installEnv} ` : ""}${pipInstall(
			`--no-build-isolation ${quote(entry.installArgs.filter((arg) => arg !== "--no-build-isolation"))} -e /work`
				.replace(/\s+/g, " ")
				.trim(),
			"editable",
		)}`,
		...(entry.extraRequirements.length > 0 ? [pipInstall(quote(entry.extraRequirements), "extras")] : []),
		...(entry.httpbinService
			? [
					// Loopback httpbin INSIDE the none-network namespace: the era suite builds URLs from HTTPBIN_URL.
					`(python -c 'from httpbin import app; app.run(host="127.0.0.1", port=${entry.httpbinService.port})' >/tmp/httpbin.log 2>&1 &)`,
					`export HTTPBIN_URL=http://127.0.0.1:${entry.httpbinService.port}/`,
					`for attempt in $(seq 1 50); do python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:${entry.httpbinService.port}/get', timeout=1)" 2>/dev/null && break; sleep 0.2; done`,
				]
			: []),
		"cd /work",
		"echo '===SWEBENCH_F2P==='",
		`${quote(plan.failToPassCommand)} 2>&1 || true`,
		"echo '===SWEBENCH_P2P==='",
		`${quote(plan.passToPassCommand)} 2>&1 || true`,
		"echo '===SWEBENCH_END==='",
	].join("\n");
}

/** Split a grade run's combined stdout into the two pytest outputs. */
export function splitSwebenchGradeOutput(stdout: string): { failToPassOutput: string; passToPassOutput: string } {
	const f2pStart = stdout.indexOf("===SWEBENCH_F2P===");
	const p2pStart = stdout.indexOf("===SWEBENCH_P2P===");
	const end = stdout.indexOf("===SWEBENCH_END===");
	if (f2pStart === -1 || p2pStart === -1 || end === -1 || !(f2pStart < p2pStart && p2pStart < end)) {
		// Malformed output (env failure before the markers) — both selections read as empty ⇒ every test counts
		// failed, which is the honest verdict for a grader that never ran.
		return { failToPassOutput: "", passToPassOutput: "" };
	}
	return {
		failToPassOutput: stdout.slice(f2pStart, p2pStart),
		passToPassOutput: stdout.slice(p2pStart, end),
	};
}

/**
 * The SEALED grade's effective selections: dataset sanitize (pure, inside `buildSwebenchGradePlan`) PLUS the
 * two workspace-aware filters — recorded per-instance online-only P2P exclusions, and ids whose FILE does not
 * exist in the repo at all (pytest's own suite ids tests created inside testdir sandboxes at runtime; such an
 * id aborts the whole selection run with `file not found`, control-caught on pytest-7521). Every removal is
 * counted so a trimmed guard is visible in the verdict, never silent.
 */
export function planSealedGrade(
	entry: SwebenchTrancheEntry,
	instance: SwebenchInstanceMetadata,
	workspaceDir: string,
): { plan: ReturnType<typeof buildSwebenchGradePlan>; excludedCount: number } {
	const sealedExcluded = new Set((entry.sealedPassToPassExclusions ?? []).map((exclusion) => exclusion.id));
	const fileExists = (selection: string): boolean => {
		const file = selection.split("::")[0];
		return file !== undefined && existsSync(join(workspaceDir, file));
	};
	const passToPass = instance.passToPass.filter(
		(selection) => !sealedExcluded.has(selection) && fileExists(selection),
	);
	const failToPass = instance.failToPass.filter(fileExists);
	const plan = buildSwebenchGradePlan({ ...instance, failToPass, passToPass });
	const excludedCount =
		plan.droppedSelections.length +
		(instance.passToPass.length - passToPass.length) +
		(instance.failToPass.length - failToPass.length);
	return { plan, excludedCount };
}

export interface SwebenchGraderDeps {
	/** Spawn docker (injected for tests). */
	readonly exec: (command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
}

const defaultDeps: SwebenchGraderDeps = {
	exec: async (command, args) => {
		const { stdout, stderr } = await execFileAsync(command, [...args], { maxBuffer: 64 * 1024 * 1024 });
		return { stdout, stderr };
	},
};

/** One-time per instance, network ON — the wheel-cache egress step. `sourceDir` is a PRISTINE materialization. */
export async function prepareSwebenchWheels(
	input: { entry: SwebenchTrancheEntry; sourceDir: string; cacheRoot: string },
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<void> {
	await mkdir(join(input.cacheRoot, "wheels"), { recursive: true });
	await deps.exec("docker", [
		"run",
		"--rm",
		"-v",
		// Writable on purpose: pip's metadata build writes egg-info into the source tree, and this source is a
		// throwaway prepare-time materialization (grade-time workspaces are separate copies).
		`${input.sourceDir}:/src`,
		"-v",
		`${input.cacheRoot}:/cache`,
		SWEBENCH_GRADER_IMAGE,
		"bash",
		"-lc",
		buildSwebenchPrepareScript(input.entry),
	]);
}

/**
 * Grade a workspace COPY (test_patch already applied host-side by the caller) with the network namespace off.
 * Returns the pure parser's verdict; docker/env failures surface as unresolved-with-reason, never a throw the
 * drain has to interpret.
 */
export async function gradeSwebenchWorkspace(
	input: {
		entry: SwebenchTrancheEntry;
		instance: SwebenchInstanceMetadata;
		workspaceCopyDir: string;
		cacheRoot: string;
	},
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<SwebenchGradeVerdict & { graderStdoutTail: string }> {
	const sealed = planSealedGrade(input.entry, input.instance, input.workspaceCopyDir);
	let stdout = "";
	try {
		const result = await deps.exec("docker", [
			"run",
			"--rm",
			"--network",
			"none",
			"-v",
			`${input.workspaceCopyDir}:/work`,
			"-v",
			`${input.cacheRoot}:/cache:ro`,
			SWEBENCH_GRADER_IMAGE,
			"bash",
			"-lc",
			buildSwebenchGradeScript(input.entry, sealed.plan),
		]);
		stdout = result.stdout;
	} catch (error) {
		stdout = error instanceof Error ? error.message : String(error);
	}
	const { failToPassOutput, passToPassOutput } = splitSwebenchGradeOutput(stdout);
	const { plan, excludedCount } = sealed;
	const verdict = parseSwebenchGradeOutput({
		failToPass: plan.failToPass,
		passToPass: plan.passToPass,
		failToPassOutput,
		passToPassOutput,
	});
	// A tranche instance whose gradable F2P is EMPTY cannot prove any fix — that is disqualifying, not green.
	const resolvable = plan.failToPass.length > 0;
	const reason = `${
		resolvable ? verdict.reason : `not resolvable: no gradable fail-to-pass id survived the dataset`
	}${excludedCount > 0 ? ` (${excludedCount} ungradable dataset id(s) excluded)` : ""}`;
	return {
		...verdict,
		resolved: verdict.resolved && resolvable,
		reason,
		graderStdoutTail: stdout.slice(-2_000),
	};
}

/**
 * Host-side test_patch application onto the workspace COPY (the container has no git by design).
 *
 * A REFUSAL here is a finding, not an error. The instance's own test changes only fail to apply when the file
 * they target has moved underneath them — overwhelmingly because the agent EDITED THE GRADED TESTS, which the
 * card explicitly forbids ("do not modify existing tests; fix the library code"). Live-found 2026-08-08: a
 * real model asked to fix a Flask bug changed only `tests/test_blueprints.py` and no source at all. Grading
 * that run is impossible, and saying so precisely is far more useful than either crashing or, worse, quietly
 * grading a tampered suite.
 */
export type TestPatchApplication =
	| { readonly applied: true }
	| { readonly applied: false; readonly reason: "graded_tests_modified"; readonly detail: string };

export async function applyTestPatchToCopy(workspaceCopyDir: string, testPatch: string): Promise<TestPatchApplication> {
	const patchPath = join(workspaceCopyDir, ".swebench-test.patch");
	await writeFile(patchPath, testPatch.endsWith("\n") ? testPatch : `${testPatch}\n`);
	try {
		await execFileAsync("git", ["-C", workspaceCopyDir, "apply", ".swebench-test.patch"]);
		return { applied: true };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { applied: false, reason: "graded_tests_modified", detail: detail.slice(0, 500) };
	} finally {
		await rm(patchPath, { force: true });
	}
}
