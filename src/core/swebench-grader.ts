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
import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGitProcessEnv } from "./git-process-env";
import {
	buildSwebenchEnvDockerfile,
	buildSwebenchSelectionCommand,
	classifySwebenchPackages,
	parseCondaEnvironmentYml,
	passedIdsFromOutput,
	rewriteSwebenchRepoLine,
	type SwebenchResolvedEnv,
	sealedInstallCommand,
	splitSwebenchPreInstall,
	swebenchGraderImageFor,
	swebenchSpecBuildRequirements,
} from "./swebench-env-spec";
import type { SwebenchInstanceMetadata } from "./swebench-instance";
import { buildSwebenchGradePlan, parseSwebenchGradeOutput, type SwebenchGradeVerdict } from "./swebench-instance";
import type { SwebenchTrancheEntry } from "./swebench-tranche";

/** A hand-proven tranche entry or a spec-resolved env (P1.SWEBENCHFULL) — the grader takes either. */
export type SwebenchGraderEntry = SwebenchTrancheEntry | SwebenchResolvedEnv;

/**
 * The wheel-cache directory name for an entry. A hand-proven tranche entry keeps its INSTANCE id (byte-identical to
 * the N8 runs); a spec-resolved entry uses its `specKey` — the full suite has 707 instances across only ~389
 * (repo, version) rows, and every instance of one row resolves the same dependency closure, so one prepare per spec
 * replaces hundreds (and the `--network none` grade finds the same wheels either way).
 */
export function swebenchWheelCacheKey(entry: SwebenchGraderEntry): string {
	return "resolvedFrom" in entry && entry.resolvedFrom === "spec" ? entry.specKey : entry.instanceId;
}

/** The runner facts of an entry, with the tranche's byte-identical defaults for hand-proven entries. */
export function graderEntryFacts(entry: SwebenchGraderEntry): {
	readonly fromSpec: boolean;
	readonly testCmd: string;
	readonly logParser: SwebenchResolvedEnv["logParser"];
	readonly installCommand: string;
	readonly packages: string | null;
} {
	if ("resolvedFrom" in entry && entry.resolvedFrom === "spec") {
		return {
			fromSpec: true,
			testCmd: entry.testCmd,
			logParser: entry.logParser,
			installCommand: entry.installCommand,
			packages: entry.packages,
		};
	}
	return {
		fromSpec: false,
		testCmd: "python -m pytest -rA -p no:cacheprovider",
		logParser: "pytest",
		installCommand: "pip install -e .",
		packages: null,
	};
}

const execFileAsync = promisify(execFile);

export const SWEBENCH_GRADER_IMAGE = "python:3.9-slim";

/**
 * The in-container shell for `prepare`: resolve the repo's deps + the tranche pins into the wheel cache. The
 * entry's probe-proven env facts apply HERE too — `pip download` builds the repo's metadata, and an isolated
 * build env gets the LATEST setuptools (no pkg_resources) and no scm pretend-version, which is exactly the
 * failure the facts exist to prevent (prepare-caught on pytest-5227).
 */
export function buildSwebenchPrepareScript(entry: SwebenchGraderEntry, extraPins: readonly string[] = []): string {
	// The grade-time closure: era pins AND the offline build toolchain (pip download never includes PEP 517
	// build requirements in a source's closure — the whole first control sweep failed on exactly that).
	const packages = classifySwebenchPackages(graderEntryFacts(entry).packages);
	const pins = [
		...new Set([...swebenchToolchainRequirements(entry), ...entry.extraRequirements, ...packages.pins, ...extraPins]),
	];
	const requirementsArg = packages.requirementsFile ? ` -r '/src/${packages.requirementsFile}'` : "";
	const installEnv = Object.entries(entry.installEnv)
		.map(([key, value]) => `${key}='${value}'`)
		.join(" ");
	const specBuildRequirements =
		"resolvedFrom" in entry && entry.resolvedFrom === "spec" ? swebenchSpecBuildRequirements(entry) : [];
	const needsHostBuildEnv = entry.preInstallRequirements.length > 0 || specBuildRequirements.length > 0;
	const repoPreInstall =
		"preInstallShell" in entry
			? splitSwebenchPreInstall(entry.preInstallShell).repo.map(
					(line) => `(cd /src && ${rewriteSwebenchRepoLine(line, "/src")})`,
				)
			: [];
	return [
		"set -eu",
		`mkdir -p /cache/wheels/${swebenchWheelCacheKey(entry)}`,
		...repoPreInstall,
		...(needsHostBuildEnv
			? [
					`python -m pip install --disable-pip-version-check -q --cache-dir /cache/pip-cache wheel ${[
						...entry.preInstallRequirements,
						...specBuildRequirements.filter((requirement) => requirement !== "wheel"),
					]
						.map((requirement) => `'${requirement}'`)
						.join(" ")}`.trimEnd(),
				]
			: []),
		// The repo source resolves its own dependency constraints; pins ride along so their wheels land too.
		// A SHARED pip HTTP cache under /cache: hundreds of instances of one repo resolve the same wheels, and the
		// operator's uplink is a phone hotspot (full-suite run, 2026-09-15) — without it every prepare re-downloads.
		`${installEnv ? `env ${installEnv} ` : ""}python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache ${
			needsHostBuildEnv ? "--no-build-isolation " : ""
		}--dest /cache/wheels/${swebenchWheelCacheKey(entry)} /src${requirementsArg} ${pins.map((pin) => `'${pin}'`).join(" ")}`.trimEnd(),
		`ls /cache/wheels/${swebenchWheelCacheKey(entry)} | wc -l`,
	].join("\n");
}

/** The build toolchain every offline editable install needs (pip's isolated build env is unreachable offline). */
export function swebenchToolchainRequirements(entry: SwebenchGraderEntry): string[] {
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
	entry: SwebenchGraderEntry,
	plan: Pick<ReturnType<typeof buildSwebenchGradePlan>, "failToPassCommand" | "passToPassCommand">,
	extraPins: readonly string[] = [],
): string {
	const wheels = `--no-index --find-links /cache/wheels/${swebenchWheelCacheKey(entry)}`;
	const facts = graderEntryFacts(entry);
	const packages = classifySwebenchPackages(facts.packages);
	// Upstream order for a spec: pre_install → packages → pip_packages → install (the repo). A tranche entry keeps
	// its probe-proven order (extras AFTER the editable install: a pytest-repo's editable install IS the pytest).
	const packagePins = facts.fromSpec
		? [...packages.pins, ...extraPins, ...entry.extraRequirements]
		: [...packages.pins, ...extraPins];
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
		// P1.SWEBENCHFULL: repo-level pre_install lines (sed on pyproject/setup files…) run IN the workspace first.
		...("preInstallShell" in entry
			? splitSwebenchPreInstall(entry.preInstallShell).repo.map(
					(line) =>
						`(cd /work && ${rewriteSwebenchRepoLine(line, "/work")}) 2>&1 || echo "SWEBENCH_PREINSTALL_FAILED"`,
				)
			: []),
		// P1.SWEBENCHFULL: the spec's package list (requirements file / conda deps / pins) lands before the repo.
		...(packages.requirementsFile ? [pipInstall(`-r '/work/${packages.requirementsFile}'`, "packages")] : []),
		...(packagePins.length > 0 ? [pipInstall(quote(packagePins), "packages")] : []),
		...(facts.fromSpec && "resolvedFrom" in entry && entry.resolvedFrom === "spec"
			? [pipInstall(quote(swebenchSpecBuildRequirements(entry)), "build-requirements")]
			: []),
		facts.fromSpec
			? `${installEnv ? `env ${installEnv} ` : ""}${sealedInstallCommand(facts.installCommand, wheels)} 2>&1 || echo "SWEBENCH_PIP_FAILED editable"`
			: `${installEnv ? `env ${installEnv} ` : ""}${pipInstall(
					`--no-build-isolation ${quote(entry.installArgs.filter((arg) => arg !== "--no-build-isolation"))} -e /work`
						.replace(/\s+/g, " ")
						.trim(),
					"editable",
				)}`,
		...(!facts.fromSpec && entry.extraRequirements.length > 0
			? [pipInstall(quote(entry.extraRequirements), "extras")]
			: []),
		...(entry.httpbinService
			? [
					// Loopback httpbin INSIDE the none-network namespace: the era suite builds URLs from HTTPBIN_URL.
					`(python -c 'from httpbin import app; app.run(host="127.0.0.1", port=${entry.httpbinService.port})' >/tmp/httpbin.log 2>&1 &)`,
					`export HTTPBIN_URL=http://127.0.0.1:${entry.httpbinService.port}/`,
					`for attempt in $(seq 1 50); do python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:${entry.httpbinService.port}/get', timeout=1)" 2>/dev/null && break; sleep 0.2; done`,
				]
			: []),
		"cd /work",
		// Upstream `eval_commands` (locale-gen, LANG/LC_ALL exports — django) run in THIS shell so their exports
		// reach the test commands below.
		...("evalCommands" in entry ? entry.evalCommands.map((line) => `${line} 2>&1 || true`) : []),
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
	entry: SwebenchGraderEntry,
	instance: SwebenchInstanceMetadata,
	workspaceDir: string,
): {
	plan: ReturnType<typeof buildSwebenchGradePlan>;
	excludedCount: number;
	/** FAIL_TO_PASS ids removed by the tranche's sealed exclusions (named on the receipt, never silent). */
	sealedFailToPassExcluded: readonly { id: string; cause: string }[];
} {
	const sealedExcluded = new Set((entry.sealedPassToPassExclusions ?? []).map((exclusion) => exclusion.id));
	const sealedFailToPassExcluded = (entry.sealedFailToPassExclusions ?? []).filter((exclusion) =>
		instance.failToPass.includes(exclusion.id),
	);
	const sealedFailToPassIds = new Set(sealedFailToPassExcluded.map((exclusion) => exclusion.id));
	const facts = graderEntryFacts(entry);
	// pytest ids name files (a missing file aborts the whole selection run); django labels and sympy names do not.
	const fileExists = (selection: string): boolean => {
		if (facts.logParser !== "pytest") {
			return true;
		}
		const file = selection.split("::")[0];
		return file !== undefined && existsSync(join(workspaceDir, file));
	};
	const passToPass = instance.passToPass.filter(
		(selection) => !sealedExcluded.has(selection) && fileExists(selection),
	);
	const failToPass = instance.failToPass.filter(
		(selection) => !sealedFailToPassIds.has(selection) && fileExists(selection),
	);
	// pytest ids pass the dataset sanitizer (shell-unsafe node ids are dropped and counted); django/sympy ids are
	// not node ids — the runner builders validate them by shape instead.
	const sanitized =
		facts.logParser === "pytest"
			? buildSwebenchGradePlan({ ...instance, failToPass, passToPass })
			: {
					...buildSwebenchGradePlan({ ...instance, failToPass: [], passToPass: [] }),
					failToPass,
					passToPass,
					droppedSelections: [],
				};
	// P1.SWEBENCHFULL: the runner invocation comes from the entry's facts (django labels, sympy files, pytest ids);
	// for a hand-proven tranche entry this is byte-identical to the pytest plan.
	const plan = {
		...sanitized,
		failToPassCommand: buildSwebenchSelectionCommand({
			logParser: facts.logParser,
			testCmd: facts.testCmd,
			selections: sanitized.failToPass,
			testPatch: instance.testPatch,
		}),
		passToPassCommand: buildSwebenchSelectionCommand({
			logParser: facts.logParser,
			testCmd: facts.testCmd,
			selections: sanitized.passToPass,
			testPatch: instance.testPatch,
		}),
	};
	const excludedCount =
		plan.droppedSelections.length +
		(instance.passToPass.length - passToPass.length) +
		(instance.failToPass.length - failToPass.length);
	return { plan, excludedCount, sealedFailToPassExcluded };
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
	input: { entry: SwebenchGraderEntry; sourceDir: string; cacheRoot: string },
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<void> {
	await mkdir(join(input.cacheRoot, "wheels"), { recursive: true });
	const extraPins = await environmentYmlPins(input.entry, input.sourceDir);
	await deps.exec("docker", [
		"run",
		"--rm",
		"-v",
		// Writable on purpose: pip's metadata build writes egg-info into the source tree, and this source is a
		// throwaway prepare-time materialization (grade-time workspaces are separate copies).
		`${input.sourceDir}:/src`,
		"-v",
		`${input.cacheRoot}:/cache`,
		swebenchGraderImageFor(input.entry),
		"bash",
		"-lc",
		buildSwebenchPrepareScript(input.entry, extraPins),
	]);
}

/** Pins from the spec's conda `environment.yml` in the source tree (an approximation of conda by pip — recorded). */
async function environmentYmlPins(entry: SwebenchGraderEntry, sourceDir: string): Promise<string[]> {
	const packages = classifySwebenchPackages(graderEntryFacts(entry).packages);
	if (!packages.environmentYml || !existsSync(join(sourceDir, packages.environmentYml))) {
		return [];
	}
	return parseCondaEnvironmentYml(await readFile(join(sourceDir, packages.environmentYml), "utf8"));
}

/**
 * P1.SWEBENCHFULL: build the base/env image a spec-resolved entry grades in — ONLINE, once per image (an explicit
 * egress step like `prepare`). A hand-proven tranche entry needs none (stock python:3.9-slim).
 */
export async function buildSwebenchEnvImage(
	input: { entry: SwebenchGraderEntry },
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<{ image: string; built: boolean }> {
	const image = swebenchGraderImageFor(input.entry);
	if (!("resolvedFrom" in input.entry) || input.entry.resolvedFrom !== "spec") {
		return { image, built: false };
	}
	const context = await mkdtemp(join(tmpdir(), "swebench-env-"));
	try {
		await writeFile(
			join(context, "Dockerfile"),
			buildSwebenchEnvDockerfile({
				pythonVersion: input.entry.pythonVersion,
				preInstall: input.entry.preInstallShell,
			}),
		);
		await deps.exec("docker", ["build", "-t", image, context]);
		return { image, built: true };
	} finally {
		await rm(context, { recursive: true, force: true });
	}
}

/**
 * Grade a workspace COPY (test_patch already applied host-side by the caller) with the network namespace off.
 * Returns the pure parser's verdict; docker/env failures surface as unresolved-with-reason, never a throw the
 * drain has to interpret.
 */
export async function gradeSwebenchWorkspace(
	input: {
		entry: SwebenchGraderEntry;
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
			swebenchGraderImageFor(input.entry),
			"bash",
			"-lc",
			buildSwebenchGradeScript(
				input.entry,
				sealed.plan,
				await environmentYmlPins(input.entry, input.workspaceCopyDir),
			),
		]);
		stdout = result.stdout;
	} catch (error) {
		stdout = error instanceof Error ? error.message : String(error);
	}
	const { failToPassOutput, passToPassOutput } = splitSwebenchGradeOutput(stdout);
	const { plan, excludedCount, sealedFailToPassExcluded } = sealed;
	const logParser = graderEntryFacts(input.entry).logParser;
	const verdict = parseSwebenchGradeOutput({
		failToPass: plan.failToPass,
		passToPass: plan.passToPass,
		failToPassOutput,
		passToPassOutput,
		passedIn: (output) => passedIdsFromOutput(logParser, output),
	});
	// A tranche instance whose gradable F2P is EMPTY cannot prove any fix — that is disqualifying, not green.
	const resolvable = plan.failToPass.length > 0;
	const sealedNote =
		sealedFailToPassExcluded.length > 0
			? `; ${sealedFailToPassExcluded.length} fail-to-pass excluded under the seal: ${sealedFailToPassExcluded
					.map((exclusion) => `${exclusion.id.split("::").pop()} (${exclusion.cause})`)
					.join(", ")}`
			: "";
	const reason = `${
		resolvable ? verdict.reason : `not resolvable: no gradable fail-to-pass id survived the dataset`
	}${excludedCount > 0 ? ` (${excludedCount} ungradable dataset id(s) excluded)` : ""}${sealedNote}`;
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
		await execFileAsync("git", ["-C", workspaceCopyDir, "apply", ".swebench-test.patch"], {
			env: createGitProcessEnv(),
		});
		return { applied: true };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { applied: false, reason: "graded_tests_modified", detail: detail.slice(0, 500) };
	} finally {
		await rm(patchPath, { force: true });
	}
}

/**
 * P1.SWEBENCHFULL: flatten every cached wheel into `wheels/_flat` (hard links, first writer wins) — the directory an
 * arm mounts into its agent sandboxes as the read-only wheelhouse (`NKLEIN_AGENT_SANDBOX_WHEELHOUSE`), so the
 * toolchain prime resolves era pins offline from the same closure the sealed grader installs.
 */
export async function flattenSwebenchWheels(
	cacheRoot: string,
): Promise<{ flatDir: string; linked: number; total: number }> {
	const wheelsRoot = join(cacheRoot, "wheels");
	const flatDir = join(wheelsRoot, "_flat");
	await mkdir(flatDir, { recursive: true });
	let linked = 0;
	let total = 0;
	for (const instanceDir of await readdir(wheelsRoot)) {
		if (instanceDir === "_flat") continue;
		const dir = join(wheelsRoot, instanceDir);
		let files: string[] = [];
		try {
			files = await readdir(dir);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!/\.(whl|tar\.gz|zip)$/u.test(file)) continue;
			total += 1;
			const target = join(flatDir, file);
			if (existsSync(target)) continue;
			try {
				await link(join(dir, file), target);
				linked += 1;
			} catch {
				await copyFile(join(dir, file), target);
				linked += 1;
			}
		}
	}
	return { flatDir, linked, total };
}
