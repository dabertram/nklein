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
import { existsSync, readFileSync } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGitProcessEnv } from "./git-process-env";
import {
	buildSwebenchEnvDockerfile,
	buildSwebenchSelectionArguments,
	classifySwebenchPackages,
	flattenSwebenchRequirements,
	isSwebenchRequirementsSentinel,
	parseCondaEnvironmentYml,
	parsePep518BuildRequires,
	passedIdsFromOutput,
	rewriteSwebenchRepoLine,
	SWEBENCH_REPO_REQUIREMENTS_PATHS,
	type SwebenchResolvedEnv,
	sealedInstallCommand,
	splitSwebenchPreInstall,
	swebenchGraderImageFor,
	swebenchSpecBuildRequirements,
	withSwebenchLegacyCBuildEnv,
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
/** POSIX single-quote a value that may itself contain single quotes (environment markers do). */
function shellQuote(value: string): string {
	return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

export const SWEBENCH_PREPARE_MARKER = "SWEBENCH_PREPARE_OK";

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
export function buildSwebenchPrepareScript(
	entry: SwebenchGraderEntry,
	extraPins: readonly string[] = [],
	repoRequirementsFile: string | null = null,
	pep518BuildRequires: readonly string[] = [],
): string {
	// The grade-time closure: era pins AND the offline build toolchain (pip download never includes PEP 517
	// build requirements in a source's closure — the whole first control sweep failed on exactly that).
	const packages = classifySwebenchPackages(graderEntryFacts(entry).packages);
	const requirementsFile =
		repoRequirementsFile ??
		(isSwebenchRequirementsSentinel(graderEntryFacts(entry).packages) ? null : packages.requirementsFile);
	const installEnv = Object.entries(entry.installEnv)
		.map(([key, value]) => `${key}='${value}'`)
		.join(" ");
	const specBuildRequirements =
		"resolvedFrom" in entry && entry.resolvedFrom === "spec" ? swebenchSpecBuildRequirements(entry) : [];
	const hostBuildPins = [
		...new Set([...entry.preInstallRequirements, ...specBuildRequirements, ...pep518BuildRequires]),
	];
	const needsHostBuildEnv = hostBuildPins.length > 0;
	// ONE shell for the whole block: upstream's lines share state (matplotlib assigns `QHULL_TAR` and uses it two
	// lines later), so a subshell per line leaves the variable unbound — fatal under `set -eu`.
	const repoPreInstallLines = "preInstallShell" in entry ? splitSwebenchPreInstall(entry.preInstallShell).repo : [];
	const repoPreInstall =
		repoPreInstallLines.length > 0
			? [`( cd /src\n${repoPreInstallLines.map((line) => rewriteSwebenchRepoLine(line, "/src")).join("\n")}\n)`]
			: [];
	const stages: { label: string; args: string; fatal: boolean }[] = [
		...(requirementsFile ? [{ label: "requirements", args: `-r '/src/${requirementsFile}'`, fatal: false }] : []),
		...(packages.pins.length > 0 || extraPins.length > 0
			? [
					{
						label: "packages",
						args: [...new Set([...packages.pins, ...extraPins])].map((pin) => shellQuote(pin)).join(" "),
						fatal: false,
					},
				]
			: []),
		{
			label: "toolchain",
			args: [...new Set([...swebenchToolchainRequirements(entry), ...pep518BuildRequires])]
				.map((pin) => shellQuote(pin))
				.join(" "),
			fatal: false,
		},
		{ label: "repo", args: "/src", fatal: true },
		...(entry.extraRequirements.length > 0
			? [{ label: "extras", args: entry.extraRequirements.map((pin) => shellQuote(pin)).join(" "), fatal: false }]
			: []),
	];
	return [
		"set -eu",
		// Accumulates the labels of non-fatal stages that failed; the completion marker is gated on it being empty.
		'incomplete=""',
		`mkdir -p /cache/wheels/${swebenchWheelCacheKey(entry)}`,
		...repoPreInstall,
		...(needsHostBuildEnv
			? [
					`python -m pip install --disable-pip-version-check -q --cache-dir /cache/pip-cache wheel ${hostBuildPins
						.filter((requirement) => requirement !== "wheel")
						.map((requirement) => shellQuote(requirement))
						.join(" ")}`.trimEnd(),
				]
			: []),
		// Upstream INSTALLS in stages (requirements file → era pins → the repo → pip_packages) and never resolves
		// them together. Resolving them in one `pip download` asks pip for a single solution across stages that
		// legitimately conflict — ten sphinx specs died with ResolutionImpossible on the 2026-09-15 Verified sweep.
		// So: one call per stage into the same wheel dir, with the SHARED pip HTTP cache (the operator's uplink is a
		// phone hotspot). Only the repo stage is fatal; the others print a named marker.
		...stages.map(({ label, args, fatal }) =>
			`${installEnv ? `env ${installEnv} ` : ""}python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache ${
				needsHostBuildEnv ? "--no-build-isolation " : ""
			}--dest /cache/wheels/${swebenchWheelCacheKey(entry)} ${args}${
				fatal ? "" : ` || { echo "SWEBENCH_DOWNLOAD_INCOMPLETE ${label}"; incomplete="$incomplete ${label}"; }`
			}`.replace(/\s+/g, " "),
		),
		// The completion marker: written ONLY when EVERY stage closed. The fatal repo stage aborts the script on
		// its own; a non-fatal stage that failed sets `incomplete`, and a cache missing that stage's wheels is not
		// a cache hit. Live 2026-09-15: four failed specs left partial wheel dirs. Live 2026-09-16: scikit-learn
		// 0.22's `pip_packages` stage could not resolve `numpy==1.19.2` for cp36/aarch64, the marker was written
		// anyway, and every sealed grade for the spec then died with "No matching distribution found for numpy" —
		// with the prepare still cheerfully reporting "already cached".
		`if [ -n "$incomplete" ]; then echo "SWEBENCH_PREPARE_INCOMPLETE$incomplete"; else mkdir -p /cache/wheels/${swebenchWheelCacheKey(entry)} && touch /cache/wheels/${swebenchWheelCacheKey(entry)}/${SWEBENCH_PREPARE_MARKER}; fi`,
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
	repoRequirementsFile: string | null = null,
	pep518BuildRequires: readonly string[] = [],
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
	const quote = (parts: readonly string[]) => parts.map((part) => shellQuote(part)).join(" ");
	const pipInstall = (what: string, stage: string) =>
		`python -m pip install --disable-pip-version-check -q ${wheels} ${what} 2>&1 || echo "SWEBENCH_PIP_FAILED ${stage}"`;
	return [
		"set -u",
		"python -m venv /tmp/venv",
		"export PATH=/tmp/venv/bin:$PATH",
		pipInstall(quote(swebenchToolchainRequirements(entry)), "toolchain"),
		// P1.SWEBENCHFULL: repo-level pre_install lines (sed on pyproject/setup files…) run IN the workspace first.
		// ONE shell for the whole block (see the prepare script): upstream's pre_install lines share shell state.
		...(() => {
			const lines = "preInstallShell" in entry ? splitSwebenchPreInstall(entry.preInstallShell).repo : [];
			return lines.length > 0
				? [
						`( cd /work\n${lines
							.map((line) => rewriteSwebenchRepoLine(line, "/work"))
							.join("\n")}\n) 2>&1 || echo "SWEBENCH_PREINSTALL_FAILED"`,
					]
				: [];
		})(),
		// P1.SWEBENCHFULL: the spec's package list (requirements file / conda deps / pins) lands before the repo.
		...(repoRequirementsFile || (!isSwebenchRequirementsSentinel(facts.packages) && packages.requirementsFile)
			? [pipInstall(`-r '/work/${repoRequirementsFile ?? packages.requirementsFile}'`, "packages")]
			: []),
		...(packagePins.length > 0 ? [pipInstall(quote(packagePins), "packages")] : []),
		...(facts.fromSpec && "resolvedFrom" in entry && entry.resolvedFrom === "spec"
			? [
					pipInstall(
						quote([...new Set([...swebenchSpecBuildRequirements(entry), ...pep518BuildRequires])]),
						"build-requirements",
					),
				]
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
		// Upstream builds the repo in an ISOLATED build env, so `build-system.requires` never touches the runtime
		// environment. We build with --no-build-isolation (there is no index under `--network none`), so those
		// requirements install into the SAME venv and can move a pin the spec fixed: astropy 5.1 pins
		// numpy==1.25.2, its `oldest-supported-numpy` build requirement dragged numpy down to 1.19.3, and the
		// editable install — needing something newer — then jumped to the highest wheel in the cache, 2.0.2.
		// pyerfa is compiled against the numpy 1.x ABI, so every one of the 322 pass-to-pass tests failed in a
		// PRISTINE tree with `numpy.core.multiarray failed to import`. Re-asserting the spec's exact pins with
		// --no-deps restores the environment the spec defines, and is a no-op when nothing moved.
		...(() => {
			const exact = specExactPins(packagePins);
			return facts.fromSpec && exact.length > 0 ? [pipInstall(`--no-deps ${quote(exact)}`, "pins-reassert")] : [];
		})(),
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
		`${facts.testCmd} ${quote(plan.failToPassCommand)} 2>&1 || true`,
		"echo '===SWEBENCH_P2P==='",
		`${facts.testCmd} ${quote(plan.passToPassCommand)} 2>&1 || true`,
		"echo '===SWEBENCH_END==='",
	].join("\n");
}

/**
 * The `name==version` pins from a spec's package list. Only exact pins are re-assertable: a range would let pip
 * pick again, which is the very thing the re-assertion exists to prevent.
 */
export function specExactPins(pins: readonly string[]): string[] {
	return pins.filter((pin) => /^[A-Za-z0-9][A-Za-z0-9._-]*==[^\s;]+$/u.test(pin.trim())).map((pin) => pin.trim());
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
		// The plan carries the SELECTION ARGUMENTS; the script prefixes the spec's raw `test_cmd` shell string.
		failToPassCommand: buildSwebenchSelectionArguments({
			logParser: facts.logParser,
			selections: sanitized.failToPass,
			testPatch: instance.testPatch,
		}),
		passToPassCommand: buildSwebenchSelectionArguments({
			logParser: facts.logParser,
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
	input: { entry: SwebenchGraderEntry; sourceDir: string; cacheRoot: string; instanceVersion?: string | null },
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<void> {
	await mkdir(join(input.cacheRoot, "wheels"), { recursive: true });
	const extraPins = await environmentYmlPins(input.entry, input.sourceDir);
	const repoRequirements = await materializeRepoRequirements(input.entry, input.sourceDir);
	const buildRequires = readPep518BuildRequires(input.sourceDir);
	const scmEnv = setuptoolsScmPretendVersion(input.sourceDir, input.instanceVersion ?? null);
	const prepared = await deps.exec("docker", [
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
		buildSwebenchPrepareScript(
			{ ...input.entry, installEnv: withSwebenchLegacyCBuildEnv({ ...input.entry.installEnv, ...scmEnv }) },
			extraPins,
			repoRequirements,
			buildRequires,
		),
	]);
	// A stage that could not resolve leaves the cache short of wheels the sealed grade will ask for, and a silent
	// partial cache is the worst possible outcome: the prepare reports "already cached" forever and every grade
	// for the spec fails on a missing distribution. Refuse the closure instead, naming the stages.
	const incomplete = /SWEBENCH_PREPARE_INCOMPLETE(.*)/u.exec(prepared.stdout)?.[1]?.trim();
	if (incomplete) {
		throw new Error(
			`wheel closure incomplete for ${swebenchWheelCacheKey(input.entry)} — stage(s) ${incomplete} could not resolve; the cache was NOT marked complete`,
		);
	}
}

/**
 * The spec's repo requirements, flattened from the LOCAL checkout when upstream's `packages` is the sentinel
 * (`requirements.txt`). Writes them beside the tree as `.nklein-swebench-requirements.txt` so both the prepare
 * download and the sealed install can `-r` it, and returns that file's basename (or null when no path matched).
 */
/**
 * `SETUPTOOLS_SCM_PRETEND_VERSION` for a checkout whose build reads its version from git tags. Our workspace is a
 * tarball with ONE synthetic commit and no tags, so setuptools_scm invents `0.1.dev1+…`: pytest's own suite then
 * dies with `ModuleNotFoundError: No module named '_pytest._version'` (live 2026-09-16, 15 pass-to-pass "regressed"
 * in a pristine control). Upstream clones with history and never sees it. The instance's dataset `version` is the
 * honest value — the same trick the hand-proven tranche entries carry as `installEnv`.
 */
function setuptoolsScmPretendVersion(treeDir: string, instanceVersion: string | null): Record<string, string> {
	if (!instanceVersion) {
		return {};
	}
	const mentionsScm = ["pyproject.toml", "setup.py", "setup.cfg"].some((file) => {
		const path = join(treeDir, file);
		return existsSync(path) && /setuptools[-_]scm/i.test(readFileSync(path, "utf8"));
	});
	if (!mentionsScm) {
		return {};
	}
	const version = /^\d+(\.\d+)?$/u.test(instanceVersion) ? `${instanceVersion}.0` : instanceVersion;
	return { SETUPTOOLS_SCM_PRETEND_VERSION: version };
}

/** The checkout's PEP 518 build requirements, read host-side (empty when there is no pyproject.toml). */
function readPep518BuildRequires(treeDir: string): string[] {
	const path = join(treeDir, "pyproject.toml");
	return existsSync(path) ? parsePep518BuildRequires(readFileSync(path, "utf8")) : [];
}

async function materializeRepoRequirements(entry: SwebenchGraderEntry, treeDir: string): Promise<string | null> {
	const facts = graderEntryFacts(entry);
	if (!isSwebenchRequirementsSentinel(facts.packages)) {
		return null;
	}
	const repo = entry.repo;
	for (const candidate of SWEBENCH_REPO_REQUIREMENTS_PATHS[repo] ?? []) {
		if (!existsSync(join(treeDir, candidate))) {
			continue;
		}
		const lines = flattenSwebenchRequirements(candidate, (path) => {
			const full = join(treeDir, path);
			return existsSync(full) ? readFileSync(full, "utf8") : null;
		});
		if (lines.length === 0) {
			continue;
		}
		const name = ".nklein-swebench-requirements.txt";
		await writeFile(join(treeDir, name), `${lines.join("\n")}\n`);
		return name;
	}
	return null;
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
	const scmEnv = setuptoolsScmPretendVersion(input.workspaceCopyDir, input.instance.version);
	const gradeEntry = {
		...input.entry,
		installEnv: withSwebenchLegacyCBuildEnv({ ...input.entry.installEnv, ...scmEnv }),
	} as SwebenchGraderEntry;
	const repoRequirementsFile = await materializeRepoRequirements(gradeEntry, input.workspaceCopyDir);
	const sealed = planSealedGrade(gradeEntry, input.instance, input.workspaceCopyDir);
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
				gradeEntry,
				sealed.plan,
				await environmentYmlPins(input.entry, input.workspaceCopyDir),
				// The sealed grade builds the same closure the prepare downloaded: the repo's flattened
				// requirements file AND its PEP 518 build requirements. Omitting the latter left the editable
				// install without the checkout's declared build backend deps — astropy 4.3 needs `cython==0.29.22`
				// to generate `astropy/table/_np_utils.c`, which the git checkout does not carry, so `gcc` died on
				// a missing source and thirteen pass-to-pass tests read as "regressed" in a pristine control.
				repoRequirementsFile,
				readPep518BuildRequires(input.workspaceCopyDir),
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
	// The receipt keeps a 2 kB tail, which is the right size for a verdict and the wrong size for a diagnosis:
	// an environment defect lives in the INSTALL stages, thousands of lines above the tail. Naming a directory
	// here writes the whole grader transcript there, one file per instance. Opt-in, because a full Verified run
	// would otherwise leave 500 multi-megabyte logs behind.
	const logDir = process.env.NKLEIN_SWEBENCH_GRADER_LOG_DIR;
	if (logDir) {
		try {
			await mkdir(logDir, { recursive: true });
			await writeFile(join(logDir, `${input.instance.instanceId}.log`), stdout);
		} catch {
			// A diagnostic sink must never change a verdict.
		}
	}
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
