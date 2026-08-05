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
	const pins = [...entry.preInstallRequirements, ...entry.extraRequirements];
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

/** The in-container shell for `grade`: venv from cache only, editable install, run both selections. */
export function buildSwebenchGradeScript(entry: SwebenchTrancheEntry, instance: SwebenchInstanceMetadata): string {
	const plan = buildSwebenchGradePlan(instance);
	const wheels = `--no-index --find-links /cache/wheels/${entry.instanceId}`;
	const installEnv = Object.entries(entry.installEnv)
		.map(([key, value]) => `${key}='${value}'`)
		.join(" ");
	const pipInstall = (what: string) => `python -m pip install --disable-pip-version-check -q ${wheels} ${what}`;
	const quote = (parts: readonly string[]) => parts.map((part) => `'${part}'`).join(" ");
	return [
		"set -u",
		"python -m venv /tmp/venv",
		"export PATH=/tmp/venv/bin:$PATH",
		...(entry.preInstallRequirements.length > 0 ? [pipInstall(quote(entry.preInstallRequirements))] : []),
		`${installEnv ? `env ${installEnv} ` : ""}${pipInstall(`${quote(entry.installArgs)} -e /work`.trim())}`,
		...(entry.extraRequirements.length > 0 ? [pipInstall(quote(entry.extraRequirements))] : []),
		"cd /work",
		"echo '===SWEBENCH_F2P==='",
		`${quote(plan.failToPassCommand)} || true`,
		"echo '===SWEBENCH_P2P==='",
		`${quote(plan.passToPassCommand)} || true`,
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
			buildSwebenchGradeScript(input.entry, input.instance),
		]);
		stdout = result.stdout;
	} catch (error) {
		stdout = error instanceof Error ? error.message : String(error);
	}
	const { failToPassOutput, passToPassOutput } = splitSwebenchGradeOutput(stdout);
	const verdict = parseSwebenchGradeOutput({
		failToPass: input.instance.failToPass,
		passToPass: input.instance.passToPass,
		failToPassOutput,
		passToPassOutput,
	});
	return { ...verdict, graderStdoutTail: stdout.slice(-2_000) };
}

/** Host-side test_patch application onto the workspace COPY (the container has no git by design). */
export async function applyTestPatchToCopy(workspaceCopyDir: string, testPatch: string): Promise<void> {
	const patchPath = join(workspaceCopyDir, ".swebench-test.patch");
	await writeFile(patchPath, testPatch.endsWith("\n") ? testPatch : `${testPatch}\n`);
	await execFileAsync("git", ["-C", workspaceCopyDir, "apply", ".swebench-test.patch"]);
	await rm(patchPath, { force: true });
}
