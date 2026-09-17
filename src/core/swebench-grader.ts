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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
	parseSetupRequires,
	passedIdsFromOutput,
	rewriteSwebenchRepoLine,
	SWEBENCH_REPO_REQUIREMENTS_PATHS,
	type SwebenchResolvedEnv,
	sealedInstallCommand,
	splitSwebenchPreInstall,
	stripAnsiEscapes,
	swebenchEraConstraintLines,
	swebenchGraderImageFor,
	swebenchInstallExtras,
	swebenchLegacyCBuildEnvLines,
	swebenchPipRequirement,
	swebenchSpecBuildRequirements,
	swebenchSpecPinConstraintArg,
	swebenchTestCommand,
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

/**
 * Pins the prepare could not resolve on THIS platform, one per line beside the wheels. Upstream's package lists
 * are conda environments and some entries (GUI toolkits, or a version with no aarch64 wheel) have no pip
 * distribution we can build. Recording them keeps the rest of the closure usable and keeps the substitution
 * visible: the sealed grade drops exactly these pins from its install, and the verdict names them.
 */
export const SWEBENCH_UNRESOLVED_PINS = "SWEBENCH_UNRESOLVED.txt";

/**
 * Build requirements the checkout never declared, discovered by the closure probe and recorded beside the
 * wheels so the GRADE installs them too. astropy 3.1 predates pyproject.toml: nothing declares that
 * `astropy_helpers` imports jinja2 during the build, and downloading jinja2 is not enough — it has to be
 * installed, in both the probe and the grade, or the editable build dies the same way every time.
 */
export const SWEBENCH_EXTRA_BUILD_REQUIREMENTS = "SWEBENCH_BUILD_REQS.txt";

/**
 * Runtime imports the environment needs that nothing declares — discovered by the negative CONTROL, because the
 * closure probe proves an INSTALL and this only shows up when tests are collected. sphinx 3.2's
 * `writers/latex.py` does `from roman import toRoman`, which modern docutils no longer brings along, and every
 * test aborted at collection with `No module named 'roman'`.
 *
 * Recording happens only under NKLEIN_SWEBENCH_RECORD_RUNTIME_REQS, which the control sweep sets and a scored
 * run never does: a graded arm must not quietly repair its own environment mid-benchmark.
 */
export const SWEBENCH_RUNTIME_REQUIREMENTS = "SWEBENCH_RUNTIME_REQS.txt";

/**
 * Pass-to-pass tests a control found to be NETWORK-BOUND, one `id\tcause` per line beside the wheels.
 *
 * Some graded tests reach the internet by design — matplotlib's `test_https_imread_smoketest` fetches an https
 * URL, requests' timeout tests dial an unroutable host. Upstream grades online and they pass; a sealed grade
 * cannot run them at all, and counting them as regressions would blame the model for the network. The seal
 * excludes exactly these, and the verdict NAMES each one with the exception that proved it.
 */
export const SWEBENCH_SEALED_P2P = "SWEBENCH_SEALED_P2P.txt";

/** A pytest short-summary reason that means "this test needed the network", never "this test is broken". */
const NETWORK_FAILURE =
	/\b(URLError|HTTPError|ConnectionError|ConnectTimeout|ConnectionResetError|NewConnectionError|MaxRetryError|socket\.gaierror|gaierror|Temporary failure in name resolution|Network is unreachable|Name or service not known|Max retries exceeded)\b/u;

/** The network-bound pass-to-pass exclusions a control recorded for this spec. */
export function readSealedPassToPassExclusions(
	cacheRoot: string,
	entry: SwebenchGraderEntry,
): { id: string; cause: string }[] {
	const path = join(cacheRoot, "wheels", swebenchWheelCacheKey(entry), SWEBENCH_SEALED_P2P);
	if (!existsSync(path)) {
		return [];
	}
	return readFileSync(path, "utf8")
		.split("\n")
		.map((line) => line.split("\t"))
		.flatMap(([id, cause]) => (id?.trim() ? [{ id: id.trim(), cause: cause?.trim() || "network-bound" }] : []));
}

/** Network-bound failures in a pytest run's short summary, as `id` → the exception that named them. */
export function networkBoundFailures(output: string): { id: string; cause: string }[] {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the summary carries ANSI colour.
	const plain = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
	return [...plain.matchAll(/^FAILED\s+(\S+)\s+-\s+(.+)$/gmu)].flatMap((match) => {
		const id = match[1] ?? "";
		const reason = (match[2] ?? "").trim();
		return id && NETWORK_FAILURE.test(reason) ? [{ id, cause: reason.slice(0, 120) }] : [];
	});
}

/** The runtime requirements a control recorded for this spec's wheel cache. */
export function readRuntimeRequirements(cacheRoot: string, entry: SwebenchGraderEntry): string[] {
	const path = join(cacheRoot, "wheels", swebenchWheelCacheKey(entry), SWEBENCH_RUNTIME_REQUIREMENTS);
	if (!existsSync(path)) {
		return [];
	}
	return [
		...new Set(
			readFileSync(path, "utf8")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
		),
	];
}

/** The build requirements the probe discovered for this spec's wheel cache. */
export function readExtraBuildRequirements(cacheRoot: string, entry: SwebenchGraderEntry): string[] {
	const path = join(cacheRoot, "wheels", swebenchWheelCacheKey(entry), SWEBENCH_EXTRA_BUILD_REQUIREMENTS);
	if (!existsSync(path)) {
		return [];
	}
	return [
		...new Set(
			readFileSync(path, "utf8")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
		),
	];
}

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
	setupRequires: readonly string[] = [],
	repoRequirementLines: readonly string[] = [],
	// Sibling checkouts' build requirements: DOWNLOAD-only. They belong in the cache but never in an install —
	// `astropy__astropy__5.0` spans `cython==0.29.22` AND `cython==0.29.30`, and asking pip for both at once is
	// unsatisfiable. The download stages fall back per pin, so both wheels land; the install stages below, and
	// every probe and grade, keep asking only for what THEIR checkout declares.
	downloadOnlyBuildRequires: readonly string[] = [],
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
	const unresolvedPath = `/cache/wheels/${swebenchWheelCacheKey(entry)}/${SWEBENCH_UNRESOLVED_PINS}`;
	const prepareSpecPins = specExactPins(
		"resolvedFrom" in entry && entry.resolvedFrom === "spec" ? [...entry.extraRequirements] : [],
	);
	const prepareSpecPinArg = swebenchSpecPinConstraintArg(prepareSpecPins);
	const stages: { label: string; args: string; pins: readonly string[]; fatal: boolean }[] = [
		...(requirementsFile
			? [
					{
						label: "requirements",
						args: `-r '/src/${requirementsFile}'`,
						// The file's own lines are the per-line fallback: one requirement with no distribution for
						// this platform must not take the other two hundred down with it.
						pins: repoRequirementLines,
						fatal: false,
					},
				]
			: []),
		...(packages.pins.length > 0 || extraPins.length > 0
			? [
					{
						label: "packages",
						args: [...new Set([...packages.pins, ...extraPins])].map((pin) => shellQuote(pin)).join(" "),
						pins: [...new Set([...packages.pins, ...extraPins])],
						fatal: false,
					},
				]
			: []),
		{
			label: "toolchain",
			args: [
				...new Set([...swebenchToolchainRequirements(entry), ...pep518BuildRequires, ...downloadOnlyBuildRequires]),
			]
				.map((pin) => shellQuote(pin))
				.join(" "),
			pins: [
				...new Set([...swebenchToolchainRequirements(entry), ...pep518BuildRequires, ...downloadOnlyBuildRequires]),
			],
			fatal: false,
		},
		{
			// The extras the install command names ride along: they are part of the environment being cached.
			label: "repo",
			args: shellQuote(`/src${swebenchInstallExtras(graderEntryFacts(entry).installCommand)}`),
			pins: [],
			fatal: true,
		},
		...(entry.extraRequirements.length > 0
			? [
					{
						label: "extras",
						args: entry.extraRequirements.map((pin) => shellQuote(pin)).join(" "),
						pins: [...entry.extraRequirements],
						fatal: false,
					},
				]
			: []),
		...(setupRequires.length > 0
			? [
					{
						label: "setup-requires",
						args: setupRequires.map((pin) => shellQuote(pin)).join(" "),
						pins: [...setupRequires],
						fatal: false,
					},
				]
			: []),
	];
	return [
		"set -eu",
		// Accumulates the labels of non-fatal stages that failed; the completion marker is gated on it being empty.
		'incomplete=""',
		`rm -f ${unresolvedPath}`,
		// The same constraints the grade uses — era caps AND the spec's own exact pins — so the download resolves
		// the environment the grade will install, not a newer one it cannot. `wheel` unconstrained came back as
		// 0.48.0, which requires packaging>=24.0 and therefore cannot coexist with matplotlib 3.7's pinned
		// packaging==23.1; constrained, pip simply picks the last `wheel` that fits.
		...swebenchEraConstraintLines(prepareSpecPins),
		...swebenchLegacyCBuildEnvLines(),
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
		//
		// --no-build-isolation is for the REPO stage alone. The era pins it protects only matter for the checkout's
		// own build; forcing it on the other stages means any sdist they touch must find its PEP 517 backend
		// already installed. matplotlib 3.7's package list pulls an sdist built with meson-python, and the download
		// died with `ModuleNotFoundError: No module named 'mesonpy'` — six specs. The prepare has network, so those
		// stages can simply let pip fetch the backend into its own isolated env, as pip does by default.
		...stages.map(({ label, args, pins, fatal }) => {
			const download = (what: string) =>
				`${installEnv ? `env ${installEnv} ` : ""}python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache ${
					needsHostBuildEnv && label === "repo" ? "--no-build-isolation " : ""
				}${
					// The spec's pins constrain the PACKAGE stages of the download exactly as they do the install, so
					// an unversioned conda entry resolves to a release that fits them rather than to today's.
					label === "packages" || label === "requirements" ? prepareSpecPinArg : ""
				}--dest /cache/wheels/${swebenchWheelCacheKey(entry)} ${what}`.replace(/\s+/g, " ");
			if (fatal) {
				return download(args);
			}
			// A stage of independent pins retries PIN BY PIN when the joint resolution fails, and records the ones
			// that cannot resolve on this platform instead of losing the whole stage. Upstream's package lists are
			// conda environments: matplotlib's names `pyqt`, `wxpython`, `pygobject` and `cairocffi`, which conda
			// ships as binaries and pip can only build from source against system dev libraries we do not have.
			// Before this, ONE such entry took every other pin of the stage down with it — numpy included.
			if (pins.length === 0) {
				return `${download(args)} || { echo "SWEBENCH_DOWNLOAD_INCOMPLETE ${label}"; incomplete="$incomplete ${label}"; }`;
			}
			return [
				`if ! ${download(args)}; then`,
				`  for pin in ${pins.map((pin) => shellQuote(pin)).join(" ")}; do`,
				`    ${download('"$pin"')} || { echo "SWEBENCH_UNRESOLVED_PIN $pin"; echo "$pin" >> ${unresolvedPath}; }`,
				"  done",
				"fi",
			].join("\n");
		}),
		// The completion marker: written ONLY when EVERY stage closed. The fatal repo stage aborts the script on
		// its own; a non-fatal stage that failed sets `incomplete`, and a cache missing that stage's wheels is not
		// a cache hit. Live 2026-09-15: four failed specs left partial wheel dirs. Live 2026-09-16: scikit-learn
		// 0.22's `pip_packages` stage could not resolve `numpy==1.19.2` for cp36/aarch64, the marker was written
		// anyway, and every sealed grade for the spec then died with "No matching distribution found for numpy" —
		// with the prepare still cheerfully reporting "already cached".
		`if [ -n "$incomplete" ]; then echo "SWEBENCH_PREPARE_INCOMPLETE$incomplete"; fi`,
		`ls /cache/wheels/${swebenchWheelCacheKey(entry)} | wc -l`,
	].join("\n");
}

/**
 * The closure PROBE: the sealed grade's own install, offline against the cache the download filled, in a
 * throwaway venv and a separate container run.
 *
 * Two things come out of it. A closure gap surfaces HERE — once, at prepare — instead of at every grade of the
 * spec: matplotlib 3.7's editable install wanted `cython>=3.0.10`, which nothing had downloaded, and only the
 * grade ever said so. And the build's OWN network fetches are warmed: matplotlib downloads a pinned freetype
 * tarball during `build_ext` and reads it back from the XDG cache, which a `--network none` grade cannot do.
 *
 * `PIP_NO_INDEX` (set by the shared install lines) keeps pip offline so the probe cannot paper over a gap with a
 * live download, while the container's network stays available for exactly those non-pip fetches.
 */
export function buildSwebenchProbeScript(input: {
	readonly entry: SwebenchGraderEntry;
	readonly extraPins?: readonly string[];
	readonly repoRequirementsFile?: string | null;
	readonly pep518BuildRequires?: readonly string[];
	readonly unresolvedPins?: readonly string[];
	readonly extraBuildRequirements?: readonly string[];
	readonly runtimeRequirements?: readonly string[];
}): string {
	const key = swebenchWheelCacheKey(input.entry);
	return [
		"set -u",
		`mkdir -p /cache/xdg/${key}`,
		"python -m venv /tmp/probe",
		"(",
		"export PATH=/tmp/probe/bin:$PATH",
		...buildSwebenchInstallLines({ ...input, root: "/src", xdgHome: `/cache/xdg/${key}`, runRepoPreInstall: false }),
		") > /tmp/probe.log 2>&1 || true",
		// Keep whatever the repo's own pre_install fetched into `build/` — the grade has no network to fetch it.
		`if [ -d /src/build ]; then mkdir -p /cache/build/${key} && cp -a /src/build/. /cache/build/${key}/ 2>/dev/null || true; fi`,
		// A pipeline's `while read` runs in a SUBSHELL, so the verdict is read back from the file, not a variable.
		'if grep -qE "SWEBENCH_PIP_FAILED|No matching distribution|Could not find a version" /tmp/probe.log; then',
		'  echo "SWEBENCH_PROBE_FAILED"',
		'  grep -hE "SWEBENCH_PIP_FAILED|No matching distribution|Could not find a version" /tmp/probe.log | sort -u | head -6',
		// When the reason is not a missing distribution, the summary lines say nothing useful — so the tail of the
		// transcript comes with it. A probe that fails without saying why costs a whole hand re-run to find out.
		'  echo "SWEBENCH_PROBE_TAIL"',
		// Context around the FIRST failure, not the tail: a later stage's collapse (`No module named numpy`) is a
		// consequence, and the tail only ever shows the consequence.
		'  grep -n -B 30 -m1 "SWEBENCH_PIP_FAILED" /tmp/probe.log || tail -40 /tmp/probe.log',
		"fi",
	].join("\n");
}

/** The build toolchain every offline editable install needs (pip's isolated build env is unreachable offline). */
export function swebenchToolchainRequirements(entry: SwebenchGraderEntry): string[] {
	const pinnedSetuptools = entry.preInstallRequirements.find((requirement) => requirement.startsWith("setuptools"));
	return [
		// The venv's bundled pip is far too old to read modern wheel tags; it is upgraded first, from here. A spec
		// that still passes `--no-use-pep517` needs the pip era that still HAS the option — see
		// swebenchPipRequirement — so both candidates ride into the cache.
		"pip",
		swebenchPipRequirement(graderEntryFacts(entry).installCommand),
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
/**
 * The install sequence shared by the sealed GRADE and the prepare's closure probe: the same toolchain, the same
 * repo-level pre_install, the same package stages, the same editable install, the same pin re-assertion. One
 * definition, because a probe that installs differently from the grade proves nothing about the grade.
 *
 * `root` is the checkout (`/work` when grading, `/src` when probing). `xdgHome` is where a build's OWN downloads
 * are cached — matplotlib fetches a pinned freetype tarball during `build_ext` and reads it back from the XDG
 * cache, so the probe (which has network) warms it and the grade (which has none) replays it.
 */
export function buildSwebenchInstallLines(input: {
	readonly entry: SwebenchGraderEntry;
	readonly root: string;
	readonly xdgHome: string;
	readonly extraPins?: readonly string[];
	readonly repoRequirementsFile?: string | null;
	readonly pep518BuildRequires?: readonly string[];
	readonly unresolvedPins?: readonly string[];
	/**
	 * Whether to run the repo-level pre_install. The GRADE must (its workspace is a fresh copy); the PROBE must
	 * NOT, because the download script already applied it to the same `/src` tree and these lines are not
	 * idempotent — sphinx's `sed 's/sphinxcontrib-applehelp/sphinxcontrib-applehelp<=1.0.7/'` applied twice yields
	 * `sphinxcontrib-applehelp<=1.0.7<=1.0.7`, and setuptools rejects the whole `install_requires`.
	 */
	readonly runRepoPreInstall?: boolean;
	/** Build requirements the probe DISCOVERED, recorded beside the wheels; see SWEBENCH_EXTRA_BUILD_REQUIREMENTS. */
	readonly extraBuildRequirements?: readonly string[];
	/** Runtime imports a CONTROL discovered; see SWEBENCH_RUNTIME_REQUIREMENTS. */
	readonly runtimeRequirements?: readonly string[];
}): string[] {
	const { entry, root, xdgHome } = input;
	const runRepoPreInstall = input.runRepoPreInstall ?? true;
	const extraPins = input.extraPins ?? [];
	const repoRequirementsFile = input.repoRequirementsFile ?? null;
	const pep518BuildRequires = input.pep518BuildRequires ?? [];
	const unresolvedPins = input.unresolvedPins ?? [];
	const wheels = `--no-index --find-links /cache/wheels/${swebenchWheelCacheKey(entry)}`;
	const facts = graderEntryFacts(entry);
	const packages = classifySwebenchPackages(facts.packages);
	const unresolved = new Set(unresolvedPins);
	const packagePins = (
		facts.fromSpec ? [...packages.pins, ...extraPins, ...entry.extraRequirements] : [...packages.pins, ...extraPins]
	).filter((pin) => !unresolved.has(pin));
	const installEnv = Object.entries(entry.installEnv)
		.map(([key, value]) => `${key}='${value}'`)
		.join(" ");
	const quote = (parts: readonly string[]) => parts.map((part) => shellQuote(part)).join(" ");
	const specPins = specExactPins(facts.fromSpec ? [...entry.extraRequirements] : []);
	const specPinArg = swebenchSpecPinConstraintArg(specPins);
	const pipInstall = (what: string, stage: string) =>
		`python -m pip install --disable-pip-version-check -q ${wheels} ${what} 2>&1 || echo "SWEBENCH_PIP_FAILED ${stage}"`;
	return [
		`export XDG_CACHE_HOME=${xdgHome}`,
		// Our own pip calls carry --no-index --find-links, but a repo's build can spawn pip ITSELF and that child
		// carries neither. matplotlib's setup.py resolves `setup_requires` by running
		// `pip wheel --no-deps -w <tmp> 'numpy>=1.19'`, which reaches for PyPI, and under `--network none` the
		// editable install died with `metadata-generation-failed` — six matplotlib specs, every pass-to-pass test
		// scored as a regression. pip reads these variables on EVERY invocation, so they reach the nested call too.
		"export PIP_NO_INDEX=1",
		`export PIP_FIND_LINKS=/cache/wheels/${swebenchWheelCacheKey(entry)}`,
		"export PIP_DISABLE_PIP_VERSION_CHECK=1",
		// pytest truncates its short-summary lines to the terminal width, and with no terminal that is 80 columns:
		// `FAILED …::test_https_imread_smoketest - urll...` says almost nothing. The width is what decides whether
		// a failure's reason is readable at all, so it is set explicitly.
		"export COLUMNS=200",
		// The spec's own exact pins are constraints for EVERY resolution in the environment, not just the stage that
		// names them. Upstream's package lists are conda environments whose entries mostly carry no version, and
		// pip resolves those to today's releases: matplotlib 3.7's unversioned `pandas` came back as 3.0.5, which
		// cannot coexist with the spec's `numpy==1.25.2`, and the whole packages stage died with
		// ResolutionImpossible. Constrained, pip picks the pandas that fits the pinned numpy — which is what conda
		// did for upstream.
		...swebenchEraConstraintLines(specPins),
		...swebenchLegacyCBuildEnvLines(),
		// FIRST, before anything else is resolved: `python -m venv` seeds the interpreter's OWN bundled pip, and on
		// the python 3.6 image that is pip 18.1 — which predates PEP 600 and cannot read a `manylinux_2_28` or
		// abi3 wheel at all. The download runs under the image's newer system pip and fetched
		// `bcrypt-4.0.1-cp36-abi3-manylinux_2_28_aarch64.whl`; the venv's pip then reported "from versions: )" for
		// a file sitting in front of it, and django 3.0/3.2's whole requirements install failed over it. `pip`
		// alone is a no-op to a pip that considers itself satisfied, hence --upgrade.
		pipInstall(`--upgrade ${shellQuote(swebenchPipRequirement(facts.installCommand))}`, "pip-upgrade"),
		pipInstall(quote(swebenchToolchainRequirements(entry)), "toolchain"),
		// P1.SWEBENCHFULL: repo-level pre_install lines (sed on pyproject/setup files…) run IN the workspace first.
		// ONE shell for the whole block (see the prepare script): upstream's pre_install lines share shell state.
		...(() => {
			const lines =
				runRepoPreInstall && "preInstallShell" in entry ? splitSwebenchPreInstall(entry.preInstallShell).repo : [];
			return lines.length > 0
				? [
						`( cd ${root}\n${lines
							.map((line) => rewriteSwebenchRepoLine(line, root))
							.join("\n")}\n) 2>&1 || echo "SWEBENCH_PREINSTALL_FAILED"`,
					]
				: [];
		})(),
		// A VCS dependency cannot be satisfied under `--network none`: sphinx 3.2's tox.ini lists
		// `git+https://github.com/html5lib/html5lib-python`, tox runs `pip install git+…`, the clone fails with
		// exit 128 and tox aborts BEFORE running a single test — five specs, scored as total regressions. The URL
		// is rewritten to the project name so pip resolves it from the sealed cache instead. A documented
		// substitution: the pinned ref becomes the release the closure holds, which is what an offline grade can
		// honestly offer.
		`if [ -f ${root}/tox.ini ]; then sed -i -E -e 's#git[+]https?://[^[:space:]]*/([A-Za-z0-9_.-]+)-python([[:space:]]|$)#\\1\\2#g' -e 's#git[+]https?://[^[:space:]]*/([A-Za-z0-9_.-]+)([[:space:]]|$)#\\1\\2#g' ${root}/tox.ini; fi`,
		// A repo-level pre_install may DOWNLOAD build assets into `build/` at the top of the checkout: matplotlib's
		// spec wgets and untars qhull there. That works while preparing, where the network is on, and cannot work
		// in a `--network none` grade — the editable install died on `Failed to download qhull-2020-src-8.0.2.tgz`.
		// So the probe saves the tree it produced and every later grade restores it, AFTER the pre_install so a
		// failed fetch cannot clobber what the cache already holds.
		`if [ -d /cache/build/${swebenchWheelCacheKey(entry)} ]; then mkdir -p ${root}/build && cp -a /cache/build/${swebenchWheelCacheKey(entry)}/. ${root}/build/ 2>/dev/null || true; fi`,
		// P1.SWEBENCHFULL: the spec's package list (requirements file / conda deps / pins) lands before the repo.
		...(repoRequirementsFile || (!isSwebenchRequirementsSentinel(facts.packages) && packages.requirementsFile)
			? [
					// A requirements FILE resolves as a unit too, and one line can lose the other two hundred:
					// django's list pulls `pylibmc`, whose C extension needs memcached headers. Same joint-then-
					// per-line shape as the pin stage, reading the lines back from the file itself.
					(() => {
						const file = `${root}/${repoRequirementsFile ?? packages.requirementsFile}`;
						return [
							// The JOINT attempt's output is diagnostic, not a verdict: when it fails, the per-line
							// fallback below decides what actually could not be installed. Leaving pip's errors in the
							// transcript made the closure probe read an expected retry as a failure.
							`if ! python -m pip install --disable-pip-version-check -q ${wheels} ${specPinArg}-r '${file}' >> /tmp/swebench-skipped.log 2>&1; then`,
							`  while read -r line; do`,
							// pip strips a requirements file's inline comments; it does NOT strip them from an
							// ARGUMENT. Passing `astroid==3.0.0a8  # Pinned for tests` verbatim made pip fail on a
							// perfectly good pin, which the probe then recorded as unavailable and the grade dropped
							// — pylint 3.0 fell back to the spec's older astroid and lost 17 pass-to-pass tests.
							`    req=$(printf '%s' "$line" | sed -E 's/[[:space:]]*#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')`,
							'    case "$req" in "") continue;; esac',
							// The attempt's own output goes to a file, not the transcript: a pin the fallback SKIPS is an
							// expected, recorded outcome, and leaving pip's "No matching distribution" in the transcript
							// made the closure probe read its own fallback as a failure. matplotlib 3.4 installed
							// perfectly and was reported unproved for exactly that.
							`    python -m pip install --disable-pip-version-check -q ${wheels} ${specPinArg}"$req" >> /tmp/swebench-skipped.log 2>&1 || echo "SWEBENCH_PIN_SKIPPED $req"`,
							`  done < '${file}'`,
							"fi",
						].join("\n");
					})(),
				]
			: []),
		// The package stage installs as a unit, then PIN BY PIN when that unit cannot resolve — the same shape the
		// download uses, and for the same reason. Upstream's lists are conda environments carrying documentation
		// extras the graded tests never import: matplotlib 3.5's `numpydoc==1.11.0`, `sphinx` and
		// `sphinx-panels==0.6.0` cannot coexist under pip, and resolving them as one unit lost numpy with them.
		// A pin that cannot be installed alone is named on the line, recorded by the probe, and dropped by the
		// grade — visible, never silent.
		...(packagePins.length > 0
			? [
					[
						// As above: the joint attempt is a try, and the per-pin fallback is the verdict.
						`if ! python -m pip install --disable-pip-version-check -q ${wheels} ${specPinArg}${quote(packagePins)} >> /tmp/swebench-skipped.log 2>&1; then`,
						`  for pin in ${quote(packagePins)}; do`,
						`    python -m pip install --disable-pip-version-check -q ${wheels} ${specPinArg}"$pin" >> /tmp/swebench-skipped.log 2>&1 || echo "SWEBENCH_PIN_SKIPPED $pin"`,
						"  done",
						"fi",
					].join("\n"),
				]
			: []),
		...(facts.fromSpec && "resolvedFrom" in entry && entry.resolvedFrom === "spec"
			? [
					// NOT quiet: the re-assertion below decides by reading "Installing collected packages" out of
					// this log, and `-q` suppresses exactly that line. astropy 5.1 lost all 322 pass-to-pass tests
					// the one time this stage was quiet — numpy looked untouched, so its pin was never restored.
					`python -m pip install --disable-pip-version-check ${wheels} ${quote([
						...new Set([
							...swebenchSpecBuildRequirements(entry),
							...pep518BuildRequires,
							...(input.extraBuildRequirements ?? []),
						]),
					])} > /tmp/swebench-build-requirements.log 2>&1 || echo "SWEBENCH_PIP_FAILED build-requirements"`,
					"cat /tmp/swebench-build-requirements.log",
				]
			: []),
		facts.fromSpec
			? `${installEnv ? `env ${installEnv} ` : ""}${sealedInstallCommand(facts.installCommand, wheels, root).replace(" -q ", " ")} > /tmp/swebench-editable.log 2>&1 || echo "SWEBENCH_PIP_FAILED editable"`
			: `${installEnv ? `env ${installEnv} ` : ""}${pipInstall(
					`--no-build-isolation ${quote(entry.installArgs.filter((arg) => arg !== "--no-build-isolation"))} -e ${root}`
						.replace(/\s+/g, " ")
						.trim(),
					"editable",
				)}`,
		"cat /tmp/swebench-editable.log 2>/dev/null || true",
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
			if (!facts.fromSpec || exact.length === 0) {
				return [];
			}
			// WHICH pins to restore is the whole question, and the two stages answer it differently.
			// A pin the BUILD-REQUIREMENTS stage moved was moved by US — astropy 5.1's `oldest-supported-numpy`
			// dragged numpy to 1.19.3, the editable install then jumped to 2.0.2, and pyerfa's ABI broke.
			// A pin the EDITABLE install moved was moved by the REPO, deliberately: pylint 3.0 needs an astroid
			// newer than the spec's `astroid==3.0.0a6`, and forcing a6 back produced
			// `module 'astroid.nodes' has no attribute 'Try'` at collection — 18 pass-to-pass tests lost in a
			// pristine tree. Upstream never re-asserts after the install, so neither do we for those.
			return [
				'SWEBENCH_REASSERT=""',
				`for pin in ${quote(exact)}; do`,
				"  name=$(printf '%s' \"$pin\" | sed -E 's/[<>=!~[].*//' | tr 'A-Z_' 'a-z-')",
				'  moved_by_build=$(grep -ciE "Installing collected packages:.*(^|[ ,])$name([ ,]|$)" /tmp/swebench-build-requirements.log 2>/dev/null || true)',
				'  moved_by_repo=$(grep -ciE "Installing collected packages:.*(^|[ ,])$name([ ,]|$)" /tmp/swebench-editable.log 2>/dev/null || true)',
				'  if [ "${moved_by_build:-0}" != "0" ] || [ "${moved_by_repo:-0}" = "0" ]; then SWEBENCH_REASSERT="$SWEBENCH_REASSERT $pin"; fi',
				"done",
				`if [ -n "$SWEBENCH_REASSERT" ]; then python -m pip install --disable-pip-version-check -q ${wheels} --no-deps $SWEBENCH_REASSERT 2>&1 || echo "SWEBENCH_PIP_FAILED pins-reassert"; fi`,
			];
		})(),
		// Last, so nothing can clobber them: the runtime imports a control found missing. Installed with --no-deps
		// because the environment is otherwise already the spec's, and a dependency cascade here would undo it.
		// A recorded name the cache could not fetch is dropped, exactly like an unresolvable pin. A control reads
		// these out of test output, and test output can name a module that is not a distribution at all.
		...(() => {
			const wanted = (input.runtimeRequirements ?? []).filter((name) => !unresolved.has(name));
			return wanted.length > 0 ? [pipInstall(`--no-deps ${quote(wanted)}`, "runtime-requirements")] : [];
		})(),
	];
}

export function buildSwebenchGradeScript(
	entry: SwebenchGraderEntry,
	plan: Pick<ReturnType<typeof buildSwebenchGradePlan>, "failToPassCommand" | "passToPassCommand">,
	extraPins: readonly string[] = [],
	repoRequirementsFile: string | null = null,
	pep518BuildRequires: readonly string[] = [],
	unresolvedPins: readonly string[] = [],
	extraBuildRequirements: readonly string[] = [],
	runtimeRequirements: readonly string[] = [],
): string {
	const facts = graderEntryFacts(entry);
	const quote = (parts: readonly string[]) => parts.map((part) => shellQuote(part)).join(" ");
	return [
		"set -u",
		"python -m venv /tmp/venv",
		"export PATH=/tmp/venv/bin:$PATH",
		// The probe warmed a build's own downloads into the cache; the cache is read-only here, and a build that
		// wants to WRITE its cache must not fail on that, so it is copied into a writable temp dir first.
		`mkdir -p /tmp/xdg && cp -a /cache/xdg/${swebenchWheelCacheKey(entry)}/. /tmp/xdg/ 2>/dev/null || true`,
		...buildSwebenchInstallLines({
			entry,
			root: "/work",
			xdgHome: "/tmp/xdg",
			extraPins,
			repoRequirementsFile,
			pep518BuildRequires,
			unresolvedPins,
			extraBuildRequirements,
			runtimeRequirements,
		}),
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
		...(() => {
			// pytest ABORTS a whole selection when one id cannot be found: `ERROR: not found: …` and then
			// "no tests ran", however many of the others were collectable. requests 2.27's ids embed a runtime
			// path (`test_unzipped_paths_unchanged[/test_utils.py]`) that does not reproduce, and three such ids
			// cost all 175 of its pass-to-pass tests. So the selection is intersected with what pytest can
			// actually collect, and the ids that fall out are NAMED rather than silently dropped.
			const run = (selection: readonly string[], label: string): string[] => {
				const command = swebenchTestCommand(facts.testCmd);
				// Only a selection that is PURE NODE IDS can be intersected. A hand-proven tranche entry's plan carries
				// the whole runner argv (`python -m pytest -rA -p no:cacheprovider t.py::b`), and feeding that to
				// `--collect-only` collects the command words themselves. Those entries keep the plain call, which
				// also keeps pass-1 comparability.
				const isNodeId = (token: string) => token.includes("::") || /\.py$/u.test(token);
				if (facts.logParser !== "pytest" || selection.length === 0 || !selection.every(isNodeId)) {
					return [`${command} ${quote(selection)} 2>&1 || true`];
				}
				const files = [...new Set(selection.map((id) => id.split("::")[0] ?? "").filter(Boolean))];
				const wanted = `/tmp/swebench-${label}-wanted.txt`;
				const collected = `/tmp/swebench-${label}-collected.txt`;
				const final = `/tmp/swebench-${label}-final.txt`;
				return [
					// The selection lives in a FILE from here on. Embedding 1405 quoted ids in a shell line — twice, once
					// per branch — produced a command the shell would not run at all, and xarray 2022.06 executed 3 of
					// them. One file, one branch, no quoting to get wrong.
					`printf '%s\\n' ${quote(selection)} > ${wanted}`,
					`python -m pytest --collect-only -q ${quote(files)} 2>/dev/null | sed 's/[[:space:]]*$//' > ${collected} || true`,
					`grep -xF -f ${wanted} ${collected} > ${final} || true`,
					// An empty intersection means the collect-only pass itself failed; run the original selection rather
					// than silently running nothing.
					`[ -s ${final} ] || cp ${wanted} ${final}`,
					`comm -23 <(sort -u ${wanted}) <(sort -u ${final}) | sed 's/^/SWEBENCH_ID_NOT_COLLECTED /' || true`,
					`${command} $(cat ${final}) 2>&1 || true`,
				];
			};
			return [
				"echo '===SWEBENCH_F2P==='",
				...run(plan.failToPassCommand, "f2p"),
				"echo '===SWEBENCH_P2P==='",
				...run(plan.passToPassCommand, "p2p"),
				"echo '===SWEBENCH_END==='",
			];
		})(),
	].join("\n");
}

/**
 * The `name==version` pins from a spec's package list. Only exact pins are re-assertable: a range would let pip
 * pick again, which is the very thing the re-assertion exists to prevent.
 */
export function specExactPins(pins: readonly string[]): string[] {
	return pins.filter((pin) => /^[A-Za-z0-9][A-Za-z0-9._-]*==[^\s;]+$/u.test(pin.trim())).map((pin) => pin.trim());
}

/**
 * pip's "Could not find a version that satisfies the requirement X (from versions: …)" lines, split by whether
 * the distribution is ABSENT (worth fetching) or merely UNUSABLE (every candidate present was discarded).
 * An exact `==` pin counts as absent when its own version is not among the candidates listed.
 */
export function resolutionFailures(transcript: string): { requirement: string; absent: boolean }[] {
	return [
		...transcript.matchAll(
			/Could not find a version that satisfies the requirement (\S+) \(from versions: ([^)]*)\)/gu,
		),
	].map((match) => {
		const requirement = match[1] ?? "";
		const candidates = (match[2] ?? "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const pinned = /==\s*([^\s,;]+)$/u.exec(requirement)?.[1];
		const absent =
			candidates.length === 0 || candidates[0] === "none" || (pinned !== undefined && !candidates.includes(pinned));
		return { requirement, absent };
	});
}

/**
 * Whether the checkout's suite builds its URLs from `HTTPBIN_URL`, and therefore can be graded offline against
 * a loopback httpbin instead of the real httpbin.org.
 *
 * The era requests suites read `HTTPBIN = os.environ.get('HTTPBIN_URL', 'http://httpbin.org/')`. Under
 * `--network none` the default loses 35 of requests 2.0's 79 pass-to-pass tests to `requests.exceptions` in a
 * PRISTINE tree — a network result, not a code result. The hand-proven tranche entries already carry a local
 * httpbin for exactly this; spec-resolved entries get it by detection instead of by hand.
 */
export function detectsHttpbinUrl(treeDir: string): boolean {
	for (const name of readdirSync(treeDir, { withFileTypes: true })) {
		if (!name.isFile() || !name.name.endsWith(".py")) {
			continue;
		}
		if (readFileSync(join(treeDir, name.name), "utf8").includes("HTTPBIN_URL")) {
			return true;
		}
	}
	const tests = join(treeDir, "tests");
	if (!existsSync(tests)) {
		return false;
	}
	return readdirSync(tests, { withFileTypes: true }).some(
		(name) =>
			name.isFile() &&
			name.name.endsWith(".py") &&
			readFileSync(join(tests, name.name), "utf8").includes("HTTPBIN_URL"),
	);
}

/**
 * The dotted django test module whose file contains this docstring, or null.
 *
 * unittest prints a test's docstring instead of its id, and the dataset records what was printed — so some
 * pass-to-pass ids are sentences with no module in them. The workspace has the answer: the docstring is the
 * first line of some test method, so the file holding it names the module. Two of django 2.2's 1432 ids are
 * findable only this way, and a test that cannot be selected is one the grader can only score as failed.
 */
function findDjangoModuleForDocstring(workspaceDir: string, docstring: string): string | null {
	const tests = join(workspaceDir, "tests");
	if (!existsSync(tests) || docstring.length < 12) {
		return null;
	}
	const stack = [tests];
	while (stack.length > 0) {
		const directory = stack.pop();
		if (directory === undefined) {
			break;
		}
		for (const item of readdirSync(directory, { withFileTypes: true })) {
			const full = join(directory, item.name);
			if (item.isDirectory()) {
				stack.push(full);
			} else if (item.isFile() && item.name.endsWith(".py")) {
				if (readFileSync(full, "utf8").includes(docstring)) {
					return full
						.slice(tests.length + 1)
						.replace(/\.py$/u, "")
						.replace(/\/__init__$/u, "")
						.split("/")
						.join(".");
				}
			}
		}
	}
	return null;
}

/** The pins the prepare recorded as unresolvable on this platform for this spec's wheel cache. */
export function readUnresolvedPins(cacheRoot: string, entry: SwebenchGraderEntry): string[] {
	const path = join(cacheRoot, "wheels", swebenchWheelCacheKey(entry), SWEBENCH_UNRESOLVED_PINS);
	if (!existsSync(path)) {
		return [];
	}
	return [
		...new Set(
			readFileSync(path, "utf8")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
		),
	];
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
			findModuleForDocstring: (docstring) => findDjangoModuleForDocstring(workspaceDir, docstring),
		}),
		passToPassCommand: buildSwebenchSelectionArguments({
			logParser: facts.logParser,
			selections: sanitized.passToPass,
			testPatch: instance.testPatch,
			findModuleForDocstring: (docstring) => findDjangoModuleForDocstring(workspaceDir, docstring),
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

/**
 * Every `name==version` a declaration file names, minus the environment-marker comparisons that share the
 * syntax (`python_version=='3.10'`, `platform_system=='Windows'`). A cache can substitute for a range; it can
 * never substitute for an exact pin, so these are the ones that have to be downloaded whoever declared them.
 */
export function exactRequirementPins(text: string): string[] {
	const markers = new Set([
		"python_version",
		"python_full_version",
		"os_name",
		"sys_platform",
		"platform_release",
		"platform_system",
		"platform_version",
		"platform_machine",
		"platform_python_implementation",
		"implementation_name",
		"implementation_version",
		"extra",
	]);
	return [
		...new Set(
			// `*` belongs in the version class: `numpy==1.21.*` is a legal pin, and stopping the match before it
			// produced `numpy==1.21.` — a requirement pip cannot parse at all.
			[...text.matchAll(/(?:^|[\s"'[(,])([A-Za-z][A-Za-z0-9._-]*)==([0-9][A-Za-z0-9._+!*-]*)/gu)]
				.filter((match) => !markers.has((match[1] ?? "").toLowerCase()))
				.filter((match) => !(match[2] ?? "").endsWith("."))
				.map((match) => `${match[1]}==${match[2]}`),
		),
	].sort();
}

/**
 * Everything EVERY cached instance sharing this entry's wheel cache key can ask its sealed install for: their
 * PEP 518 build requirements, their `setup_requires`, and every EXACT pin (`name==version`) declared anywhere in
 * their `pyproject.toml`, `setup.cfg` or `setup.py`.
 *
 * The closure is keyed per `(repo, version)` spec, but a spec spans many base commits and a checkout's declared
 * build requirements move between them. The per-spec control gate proved ONE instance per spec, so this was
 * invisible until a scored run hit a sibling: `astropy__astropy__5.0` was probed from instance 13236
 * (`cython==0.29.22`) while instance 13398 pins `cython==0.29.30`, the sealed install could not resolve it,
 * `extension_helpers` never installed, and a PRISTINE tree scored 0 of 68 pass-to-pass tests.
 *
 * The exact pins matter as much as the build requirements, and for the same reason one layer up: with cython
 * fixed, the same instance's editable install then died on `hypothesis==6.46.7; extra == "test"` because the
 * cache held 6.82.6 — the `[test]` extra its SIBLING's `setup.cfg` pins. Rather than learn every file format's
 * notion of an extra, take the one shape a cache cannot substitute for: an exact pin. A range is nearly always
 * satisfiable by whatever the probe already resolved; `name==version` never is.
 *
 * Reading each sibling's declarations straight out of its cached tarball costs three `tar` reads per sibling and
 * removes the whole class: whichever instance the prepare happens to materialize, the closure holds what all of
 * them ask for. A hand-proven tranche entry keys on its own instance id, has no siblings, and is therefore
 * untouched — pass-1 numbers stay comparable.
 */
export async function specSiblingBuildRequirements(
	entry: SwebenchGraderEntry,
	cacheRoot: string,
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<{ buildRequires: string[]; setupRequires: string[]; exactPins: string[] }> {
	const key = swebenchWheelCacheKey(entry);
	const instancesDir = join(cacheRoot, "instances");
	if (!("resolvedFrom" in entry) || entry.resolvedFrom !== "spec" || !existsSync(instancesDir)) {
		return { buildRequires: [], setupRequires: [], exactPins: [] };
	}
	const buildRequires = new Set<string>();
	const setupRequires = new Set<string>();
	const exactPins = new Set<string>();
	for (const file of readdirSync(instancesDir)) {
		if (!file.endsWith(".json")) {
			continue;
		}
		let meta: { repo?: string; version?: string };
		try {
			meta = JSON.parse(readFileSync(join(instancesDir, file), "utf8")) as { repo?: string; version?: string };
		} catch {
			continue;
		}
		if (!meta.repo || !meta.version || `${meta.repo.replace(/\//gu, "__")}__${meta.version}` !== key) {
			continue;
		}
		const tarball = join(cacheRoot, "repos", `${file.slice(0, -".json".length)}.tar.gz`);
		if (!existsSync(tarball)) {
			continue;
		}
		// The archive's top-level directory is `<name>-<baseCommit>`; read it rather than reconstruct it.
		const listed = await deps
			.exec("bash", ["-lc", `tar -tzf ${shellQuote(tarball)} 2>/dev/null | head -1`])
			.catch(() => null);
		const top = (listed?.stdout ?? "").trim().replace(/\/$/u, "");
		if (!top) {
			continue;
		}
		for (const [name, parse, sink] of [
			["pyproject.toml", parsePep518BuildRequires, buildRequires],
			["setup.py", parseSetupRequires, setupRequires],
			["setup.cfg", () => [], setupRequires],
		] as const) {
			const read = await deps
				.exec("bash", [
					"-lc",
					`tar -xzOf ${shellQuote(tarball)} ${shellQuote(`${top}/${name}`)} 2>/dev/null || true`,
				])
				.catch(() => null);
			if (!read?.stdout) {
				continue;
			}
			for (const requirement of parse(read.stdout)) {
				sink.add(requirement);
			}
			for (const pin of exactRequirementPins(read.stdout)) {
				exactPins.add(pin);
			}
		}
	}
	return {
		buildRequires: [...buildRequires].sort(),
		setupRequires: [...setupRequires].sort(),
		exactPins: [...exactPins].sort(),
	};
}

/** One-time per instance, network ON — the wheel-cache egress step. `sourceDir` is a PRISTINE materialization. */
export async function prepareSwebenchWheels(
	input: { entry: SwebenchGraderEntry; sourceDir: string; cacheRoot: string; instanceVersion?: string | null },
	deps: SwebenchGraderDeps = defaultDeps,
): Promise<void> {
	await mkdir(join(input.cacheRoot, "wheels"), { recursive: true });
	const extraPins = await environmentYmlPins(input.entry, input.sourceDir);
	const repoRequirements = await materializeRepoRequirements(input.entry, input.sourceDir);
	const repoRequirementLines = repoRequirements
		? readFileSync(join(input.sourceDir, repoRequirements), "utf8")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
		: [];
	const buildRequires = readPep518BuildRequires(input.sourceDir);
	const setupRequires = readSetupRequires(input.sourceDir);
	// What the OTHER instances of this spec declare. Cached, never installed here — see the parameter's note.
	const siblings = await specSiblingBuildRequirements(input.entry, input.cacheRoot, deps);
	const siblingOnly = [...siblings.buildRequires, ...siblings.setupRequires, ...siblings.exactPins].filter(
		(requirement) => !buildRequires.includes(requirement) && !setupRequires.includes(requirement),
	);
	// The loopback httpbin the grade will serve has to be IN the closure, or the sealed install cannot start it.
	const httpbinRequirement = detectsHttpbinUrl(input.sourceDir) && !input.entry.httpbinService ? ["httpbin"] : [];
	const scmEnv = setuptoolsScmPretendVersion(input.sourceDir, input.instanceVersion ?? null);
	// The probe must install in the SAME environment the grade will: the legacy C diagnostics and the
	// setuptools-scm pretend version are part of the install, not decoration. Without them the probe failed to
	// build astropy while the grade built it fine, which is the probe lying about the closure.
	const probeEntry = {
		...input.entry,
		installEnv: { ...input.entry.installEnv, ...scmEnv },
	} as SwebenchGraderEntry;
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
			{ ...input.entry, installEnv: { ...input.entry.installEnv, ...scmEnv } },
			extraPins,
			repoRequirements,
			buildRequires,
			[...setupRequires, ...httpbinRequirement],
			repoRequirementLines,
			siblingOnly,
		),
	]);
	// A stage that could not resolve leaves the cache short of wheels the sealed grade will ask for, and a silent
	// partial cache is the worst possible outcome: the prepare reports "already cached" forever and every grade
	// for the spec fails on a missing distribution. Refuse the closure instead, naming the stages.
	const incomplete = /SWEBENCH_PREPARE_INCOMPLETE(.*)/u.exec(prepared.stdout)?.[1]?.trim();
	const resolverSays = (transcript: string): string =>
		transcript
			.split("\n")
			.filter((line) =>
				/^(ERROR|WARNING: Discarding)|No matching distribution|Could not find a version|SWEBENCH_PIP_FAILED/u.test(
					line.trim(),
				),
			)
			.slice(-4)
			.map((line) => line.trim().slice(0, 300))
			.join(" | ");
	if (incomplete) {
		// Carry the resolver's own words: "stage X failed" without them sends the reader back to re-run by hand.
		const why = resolverSays(`${prepared.stdout}\n${prepared.stderr}`);
		throw new Error(
			`wheel closure incomplete for ${swebenchWheelCacheKey(input.entry)} — stage(s) ${incomplete} could not resolve; the cache was NOT marked complete${why ? `\n  ${why}` : ""}`,
		);
	}
	// A SECOND container run, because the probe must skip exactly the pins the download just recorded as
	// unresolvable — and those are only known once the download has finished.
	//
	// The probe does not merely report: it DRIVES the closure to completion. `pip download` builds an sdist's
	// metadata in an isolated env, so that sdist's own PEP 518 build requirements are fetched there and never
	// land in our cache — matplotlib 3.7's closure was missing `cython>=3.0.10` for exactly that reason, and only
	// a grade ever said so. Each round downloads precisely the requirements the sealed install named as missing
	// and probes again. Six rounds, because an sdist's build requirements can themselves be sdists with build
	// requirements; a closure that still has not converged by then is a finding, not a retry.
	const key = swebenchWheelCacheKey(input.entry);
	// The download recorded what it could not resolve; the probe must install the FILTERED requirements file, the
	// same one the grade will write for itself.
	const probeRequirements = await materializeRepoRequirements(
		input.entry,
		input.sourceDir,
		readUnresolvedPins(input.cacheRoot, input.entry),
	);
	let probed = { stdout: "", stderr: "" };
	const guessed = new Set<string>();
	for (let round = 1; round <= 6; round += 1) {
		probed = await deps.exec("docker", [
			"run",
			"--rm",
			"-v",
			`${input.sourceDir}:/src`,
			"-v",
			`${input.cacheRoot}:/cache`,
			swebenchGraderImageFor(input.entry),
			"bash",
			"-lc",
			buildSwebenchProbeScript({
				entry: probeEntry,
				extraPins,
				repoRequirementsFile: probeRequirements,
				pep518BuildRequires: buildRequires,
				unresolvedPins: readUnresolvedPins(input.cacheRoot, input.entry),
				extraBuildRequirements: readExtraBuildRequirements(input.cacheRoot, input.entry),
				// The probe must ask for the runtime requirements too, or they are recorded and installed at GRADE
				// time out of a cache that never fetched them. Seven sphinx specs recorded `roman`, re-proved their
				// closures, and still had no `roman` wheel — the probe never mentioned it, so nothing downloaded it.
				runtimeRequirements: readRuntimeRequirements(input.cacheRoot, input.entry),
			}),
		]);
		if (!probed.stdout.includes("SWEBENCH_PROBE_FAILED")) {
			break;
		}
		// A pin can DOWNLOAD as an sdist and still fail to build: matplotlib's conda list names `wxpython`, whose
		// sdist compiles wxWidgets and needs GTK development libraries the image does not carry. The download had
		// no way to know, so the probe records it — by the pin string the install actually uses — and retries.
		// The repo under test is never recorded this way: its build failing IS the closure failing.
		const candidatePins = [
			...classifySwebenchPackages(graderEntryFacts(input.entry).packages).pins,
			...extraPins,
			...input.entry.extraRequirements,
		];
		const repoName = input.entry.repo.split("/").pop()?.toLowerCase() ?? "";
		const normalize = (pin: string) => (pin.split(/[<>=!~;[\s]/u)[0] ?? "").trim().toLowerCase().replace(/_/gu, "-");
		// pip says both which requirement failed and which candidates it had, and the two cases need opposite
		// answers. "(from versions: none)" — or an exact `==` pin whose version is NOT among the candidates —
		// means the distribution is ABSENT and fetching it is the fix: scipy 1.5.2's build env asks for
		// `numpy==1.14.5` while the cache holds only 1.19.x. A requirement with candidates that were all
		// DISCARDED is the opposite: matplotlib 3.3.4's sdist sits in scikit-learn 0.20's cache and its
		// `setup.py egg_info` fails for want of headers, so fetching it again would change nothing.
		const unbuildable = [
			...new Set([
				...[...probed.stdout.matchAll(/Failed building wheel for (\S+)/gu)].map((match) => match[1] ?? ""),
				...resolutionFailures(probed.stdout)
					.filter((failure) => !failure.absent)
					.map((failure) => failure.requirement),
			]),
		]
			.map((name) => name.toLowerCase().replace(/_/gu, "-"))
			.filter((name) => name && name !== repoName);
		// A pin the per-pin fallback had to skip is unresolvable in this environment, by direct evidence.
		const skipped = [...probed.stdout.matchAll(/SWEBENCH_PIN_SKIPPED (.+)/gu)].map((match) =>
			(match[1] ?? "").trim(),
		);
		const newlyUnresolvable = [
			...new Set([...candidatePins.filter((pin) => unbuildable.includes(normalize(pin))), ...skipped]),
		].filter(Boolean);
		if (newlyUnresolvable.length > 0) {
			const path = join(input.cacheRoot, "wheels", key, SWEBENCH_UNRESOLVED_PINS);
			const already = readUnresolvedPins(input.cacheRoot, input.entry);
			const merged = [...new Set([...already, ...newlyUnresolvable])];
			await writeFile(path, `${merged.join("\n")}\n`);
			continue;
		}
		// A build that imports a module it does not have names it exactly, and that name is very often the
		// distribution name too: astropy 3.1 predates pyproject.toml, so nothing declared its build requirements
		// and `astropy_helpers` died on `No module named 'jinja2'` with the editable install saying only "Failed
		// building editable for astropy". Worth one attempt — a name that is not a distribution simply gets
		// recorded as unresolvable and never tried again.
		const alreadyUnresolvable = readUnresolvedPins(input.cacheRoot, input.entry);
		const missing = [
			...new Set(
				resolutionFailures(probed.stdout)
					.filter((failure) => failure.absent)
					.map((failure) => failure.requirement),
			),
		].filter((requirement) => requirement && !alreadyUnresolvable.includes(requirement));
		// A module name is a GUESS at a distribution name, and its failure is deliberately NOT recorded: recording
		// it would mark a package the environment genuinely needs as unavailable, which is what happened to django
		// 1.11's `numpy`. Each guess is tried once per prepare and then left alone.
		const guesses = [
			...new Set([
				...[...probed.stdout.matchAll(/ModuleNotFoundError: No module named '([A-Za-z][\w]*)'/gu)].map(
					(match) => match[1] ?? "",
				),
				// Some builds say it in prose instead of raising: astropy 3.1's setup emits "Cython must be
				// installed to build from a git checkout".
				...[...probed.stdout.matchAll(/\b([A-Za-z][\w-]*) must be installed\b/gu)].map((match) => match[1] ?? ""),
			]),
		].filter((name) => name && !guessed.has(name) && !missing.includes(name));
		for (const guess of guesses) {
			guessed.add(guess);
		}
		// An editable build that dies WHILE CYTHONIZING is the era gap in its most specific form: Cython 3.0 (2023)
		// rejects language constructs that 2018-era `.pyx` files use, and it fails without a message the transcript
		// can quote. Proven side by side on scikit-learn 0.20: Cython 3.0.12 fails at
		// `[ 1/39] Cythonizing sklearn/ensemble/_gradient_boosting.pyx`, Cython 0.29.37 builds it. The spec pins
		// `cython` with no version, so nothing but the failure itself says which era is meant. Tried once, and only
		// after a failure — a repo that genuinely needs Cython 3 never reaches here.
		// pytest 7.2 added `PytestRemovedIn8Warning` for nose-style `setup`/`teardown` methods, and astropy's own
		// test helper turns deprecations into ERRORS by policy. astropy 3.1's `TestHeaderFunctions` uses those
		// methods, so 7 of its 11 pass-to-pass tests errored at setup in a PRISTINE tree — the dataset's ids were
		// recorded against the era's pytest, which had no such warning. `py` rides along because pytest 7.1 still
		// imports it and nothing else in the closure pulls it in.
		const needsEraPytest =
			!guessed.has("pytest<7.2") &&
			probed.stdout.includes("PytestRemovedIn8Warning") &&
			/nose/iu.test(probed.stdout);
		if (needsEraPytest) {
			guessed.add("pytest<7.2");
			await deps.exec("docker", [
				"run",
				"--rm",
				"-v",
				`${input.cacheRoot}:/cache`,
				swebenchGraderImageFor(input.entry),
				"bash",
				"-lc",
				[
					"set -u",
					...swebenchEraConstraintLines(),
					`python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache --dest /cache/wheels/${key} 'pytest<7.2' 'py' || true`,
				].join("\n"),
			]);
			const path = join(input.cacheRoot, "wheels", key, SWEBENCH_RUNTIME_REQUIREMENTS);
			const merged = [...new Set([...readRuntimeRequirements(input.cacheRoot, input.entry), "pytest<7.2", "py"])];
			await writeFile(path, `${merged.join("\n")}\n`);
			continue;
		}
		const needsEraCython =
			!guessed.has("Cython<3") &&
			probed.stdout.includes("Cythonizing") &&
			probed.stdout.includes("SWEBENCH_PIP_FAILED editable");
		if (needsEraCython) {
			guessed.add("Cython<3");
			await deps.exec("docker", [
				"run",
				"--rm",
				"-v",
				`${input.cacheRoot}:/cache`,
				swebenchGraderImageFor(input.entry),
				"bash",
				"-lc",
				[
					"set -u",
					...swebenchEraConstraintLines(),
					`python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache --dest /cache/wheels/${key} 'Cython<3' || true`,
				].join("\n"),
			]);
			const path = join(input.cacheRoot, "wheels", key, SWEBENCH_EXTRA_BUILD_REQUIREMENTS);
			const merged = [...new Set([...readExtraBuildRequirements(input.cacheRoot, input.entry), "Cython<3"])];
			await writeFile(path, `${merged.join("\n")}\n`);
			continue;
		}
		if ((missing.length === 0 && guesses.length === 0) || round === 6) {
			throw new Error(
				`wheel closure incomplete for ${key} — the sealed install does not succeed against it; the cache was NOT marked complete\n  ${resolverSays(probed.stdout)}`,
			);
		}
		if (guesses.length > 0) {
			await deps
				.exec("docker", [
					"run",
					"--rm",
					"-v",
					`${input.cacheRoot}:/cache`,
					swebenchGraderImageFor(input.entry),
					"bash",
					"-lc",
					[
						"set -u",
						...swebenchEraConstraintLines(),
						`python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache --dest /cache/wheels/${key} ${guesses
							.map((guess) => shellQuote(guess))
							.join(" ")} && echo "SWEBENCH_GUESS_OK ${guesses.join(" ")}"`,
					].join("\n"),
				])
				.then(
					async (result) => {
						// Downloading is not enough: a build requirement has to be INSTALLED, in the probe and later in
						// the grade, so a guess that resolves is recorded as a build requirement of this spec.
						if (result.stdout.includes("SWEBENCH_GUESS_OK")) {
							const path = join(input.cacheRoot, "wheels", key, SWEBENCH_EXTRA_BUILD_REQUIREMENTS);
							const merged = [
								...new Set([...readExtraBuildRequirements(input.cacheRoot, input.entry), ...guesses]),
							];
							await writeFile(path, `${merged.join("\n")}\n`);
						}
						return result;
					},
					() => ({ stdout: "", stderr: "" }),
				);
		}
		if (missing.length === 0) {
			continue;
		}
		await deps.exec("docker", [
			"run",
			"--rm",
			"-v",
			`${input.cacheRoot}:/cache`,
			swebenchGraderImageFor(input.entry),
			"bash",
			"-lc",
			[
				"set -u",
				...swebenchEraConstraintLines(),
				`python -m pip download --disable-pip-version-check -q --cache-dir /cache/pip-cache --dest /cache/wheels/${key} ${missing
					.map((requirement) => shellQuote(requirement))
					.join(" ")} || { echo "SWEBENCH_UNRESOLVED_PIN"; ${missing
					.map(
						(requirement) =>
							`echo ${shellQuote(requirement)} >> /cache/wheels/${key}/${SWEBENCH_UNRESOLVED_PINS}`,
					)
					.join("; ")}; }`,
			].join("\n"),
		]);
	}
	// A remediation on the LAST round leaves the loop without a fresh probe, so the final state is checked here:
	// the marker must never be written over a probe that failed.
	if (probed.stdout.includes("SWEBENCH_PROBE_FAILED")) {
		throw new Error(
			`wheel closure incomplete for ${key} — the sealed install does not succeed against it; the cache was NOT marked complete\n  ${resolverSays(probed.stdout)}`,
		);
	}
	// The marker is written HOST-side, after the download closed AND the sealed install proved it.
	await writeFile(join(input.cacheRoot, "wheels", key, SWEBENCH_PREPARE_MARKER), "");
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

/**
 * The checkout's `setup_requires`, read host-side. setuptools resolves these by spawning its own pip at build
 * time, so they belong in the wheel closure even though nothing else asks for them.
 */
function readSetupRequires(treeDir: string): string[] {
	const path = join(treeDir, "setup.py");
	return existsSync(path) ? parseSetupRequires(readFileSync(path, "utf8")) : [];
}

async function materializeRepoRequirements(
	entry: SwebenchGraderEntry,
	treeDir: string,
	unresolved: readonly string[] = [],
): Promise<string | null> {
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
		// A requirement with no distribution for this platform is dropped, exactly like an unresolvable pin:
		// django 3.2's flattened list asks for `bcrypt`, which publishes no cp36 wheel, and `pip install -r` fails
		// the WHOLE file over it. The drop is recorded in the cache and named on the verdict, never silent.
		const dropped = new Set(unresolved);
		await writeFile(join(treeDir, name), `${lines.filter((line) => !dropped.has(line)).join("\n")}\n`);
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
 * The packages a pytest run SKIPPED tests for want of. Upstream's conda environments have them, so the dataset
 * lists those tests as pass-to-pass — and a skip is not a pass.
 *
 * Two phrasings, and the second one cost the most: xarray writes `SKIPPED [1] …:1616: requires bottleneck`,
 * while sklearn writes `SKIPPED [1] …:16: could not import 'pandas': No module named 'pandas'`. Only the first
 * was recognised, so sklearn 1.3's four `test__wrap_in_pandas_container_*` tests went unrecorded and were then
 * SEALED as "fails in the pristine control" — a fixable closure gap filed away as an unexplainable one.
 *
 * Pass output with the colour already stripped: pytest writes the marker as `\x1b[33mSKIPPED\x1b[0m [1] …`, so
 * a pattern anchored at `SKIPPED [` matches nothing at all on a coloured run.
 */
export function swebenchSkippedForMissingPackage(plainOutput: string): string[] {
	return [
		...new Set(
			[
				...[...plainOutput.matchAll(/SKIPPED \[\d+\][^\n:]*:\d+: requires ([A-Za-z][\w.-]*)\s*$/gmu)],
				...[...plainOutput.matchAll(/SKIPPED \[\d+\][^\n:]*:\d+: could not import '([A-Za-z][\w.-]*)'/gmu)],
			].map((match) => match[1] ?? ""),
		),
	].filter(Boolean);
}

/**
 * Did this grade MEASURE anything? An install that failed is not a measurement.
 *
 * The grade script runs under `set -u`, not `set -e`, so before this check a failed editable install went on to
 * run pytest anyway — pytest aborted while parsing `setup.cfg`'s warning filters with `ModuleNotFoundError: No
 * module named '<repo>'`, and every pass-to-pass id was reported REGRESSED against whichever model happened to
 * be in the seat. Live 2026-09-17 on the first instance of the Haiku Verified run: `astropy__astropy-13398`'s
 * closure held `cython==0.29.22` — its spec SIBLING's pin — and not the `cython==0.29.30` its own checkout
 * declares, so `extension_helpers` never installed and a PRISTINE tree, with no fix in it to have broken
 * anything, scored 0 of 68. A number that says nothing about any model must not be reported as one.
 */
export function swebenchEnvironmentRefusal(stdout: string): {
	readonly installFailures: readonly string[];
	readonly refusal: string | null;
} {
	// Anchored to a WHOLE LINE on purpose. When docker itself exits nonzero the caller puts the error message —
	// which quotes the entire grade script — in place of container output, and every `|| echo "SWEBENCH_PIP_FAILED
	// <stage>"` in that source then reads as a failure that happened. xarray 0.12 was refused with the stage list
	// `build-requirements",editable",pins-reassert";,…`, which is script text, not a result. The real marker is
	// echoed as its own line and nothing else is on it.
	const installFailures = [...new Set([...stdout.matchAll(/^SWEBENCH_PIP_FAILED (\S+)$/gmu)].map((m) => m[1] ?? ""))]
		.filter(Boolean)
		.sort();
	// The repo under test failing to install voids the grade outright. A build-requirements failure alone only
	// voids it when a module was also missing at test time: some of those pins are deliberately unresolvable on
	// this platform and are dropped on purpose, and the install succeeds without them.
	const refusal = installFailures.includes("editable")
		? `environment refused: the repo under test did not install (SWEBENCH_PIP_FAILED ${installFailures.join(", ")})`
		: installFailures.length > 0 && /ModuleNotFoundError: No module named/u.test(stdout)
			? `environment refused: install stage(s) ${installFailures.join(", ")} failed and a module was missing at test time`
			: null;
	return { installFailures, refusal };
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
): Promise<
	SwebenchGradeVerdict & {
		graderStdoutTail: string;
		installFailures: readonly string[];
		environmentRefusal: string | null;
	}
> {
	const scmEnv = setuptoolsScmPretendVersion(input.workspaceCopyDir, input.instance.version);
	const gradeEntry = {
		...input.entry,
		installEnv: { ...input.entry.installEnv, ...scmEnv },
		// A suite that reads HTTPBIN_URL can be graded against a loopback httpbin instead of the internet.
		...(input.entry.httpbinService || !detectsHttpbinUrl(input.workspaceCopyDir)
			? {}
			: { httpbinService: { port: 8998 } }),
		// The network-bound pass-to-pass tests a control proved cannot run sealed. Named on the verdict, never
		// silently dropped.
		sealedPassToPassExclusions: [
			...(input.entry.sealedPassToPassExclusions ?? []),
			...readSealedPassToPassExclusions(input.cacheRoot, input.entry),
		],
	} as SwebenchGraderEntry;
	const unresolvedPins = readUnresolvedPins(input.cacheRoot, input.entry);
	const repoRequirementsFile = await materializeRepoRequirements(gradeEntry, input.workspaceCopyDir, unresolvedPins);
	const sealed = planSealedGrade(gradeEntry, input.instance, input.workspaceCopyDir);
	let stdout = "";
	try {
		// The script goes in a FILE, never in an argv. Linux caps a SINGLE argument at 128 kB
		// (`MAX_ARG_STRLEN`), and the script embeds the selection: xarray 0.12's 1717 pass-to-pass ids make it
		// ~153 kB, so the container died with `exec /usr/bin/bash: argument list too long` before running a line.
		// The grade then reported 24 of 1717 — a docker failure wearing a score's clothes. Instance-specific, so
		// a gate that proves one instance per spec cannot see it.
		const scriptPath = join(input.workspaceCopyDir, ".swebench-grade.sh");
		await writeFile(
			scriptPath,
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
				unresolvedPins,
				readExtraBuildRequirements(input.cacheRoot, input.entry),
				readRuntimeRequirements(input.cacheRoot, input.entry),
			),
		);
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
			"-l",
			"/work/.swebench-grade.sh",
		]);
		stdout = result.stdout;
	} catch (error) {
		stdout = error instanceof Error ? error.message : String(error);
	}
	const { installFailures, refusal: environmentRefusal } = swebenchEnvironmentRefusal(stdout);
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
	const unresolvedNote =
		unresolvedPins.length > 0
			? `; environment substitution: ${unresolvedPins.join(", ")} unavailable on this platform`
			: "";
	const reason = `${
		resolvable ? verdict.reason : `not resolvable: no gradable fail-to-pass id survived the dataset`
	}${excludedCount > 0 ? ` (${excludedCount} ungradable dataset id(s) excluded)` : ""}${sealedNote}${unresolvedNote}`;
	// The receipt keeps a 2 kB tail, which is the right size for a verdict and the wrong size for a diagnosis:
	// an environment defect lives in the INSTALL stages, thousands of lines above the tail. Naming a directory
	// here writes the whole grader transcript there, one file per instance. Opt-in, because a full Verified run
	// would otherwise leave 500 multi-megabyte logs behind.
	// A CONTROL may discover a runtime import nothing declares — the closure probe proves an INSTALL, and these
	// only appear when tests are collected. Recording is gated on an env var the control sweep sets and a scored
	// run never does: a graded arm must not quietly repair its own environment mid-benchmark.
	// A REFUSED environment must never teach the closure. With a failed install every id fails and every import
	// is missing, so the recorder would write the repo's own name (`astropy`) in as a runtime requirement and
	// seal real tests as "fails in the pristine control" — a broken grade repairing itself into a wrong answer.
	if (process.env.NKLEIN_SWEBENCH_RECORD_RUNTIME_REQS && environmentRefusal === null) {
		// Two signatures, both naming the package exactly. An ImportError is the obvious one. The quieter one is a
		// pytest SKIP: `SKIPPED [1] xarray/tests/test_variable.py:1616: requires bottleneck`. Upstream's conda
		// environments HAVE those optional packages, so the dataset lists such tests as pass-to-pass — and a skip
		// is not a pass, so xarray 0.12 reported 3 of 364 as regressions for want of `bottleneck` and `sparse`.
		// Installing them recovers real graded tests, which is better than excluding them.
		const notPackages = new Set(["python", "internet", "network", "windows", "linux", "macos", "unix"]);
		// An ImportError is only evidence of a MISSING ENVIRONMENT when it stopped the run. pytest's own suite
		// imports `xyz42123`, `not_exists`, `asdfasdfasdf` and `foo` ON PURPOSE to exercise import-error handling,
		// and recording those turned four previously-clean pytest closures into failures. A collection failure
		// takes the whole selection down, so requiring zero passes separates "the environment is missing
		// something" from "a test asserted that a module is missing".
		const collectionFailed = plan.passToPass.length > 0 && verdict.passToPassFailed.length === plan.passToPass.length;
		// Colour again. pytest writes `\x1b[33mSKIPPED\x1b[0m [1] …`, so every pattern below that starts at
		// `SKIPPED [` matched nothing at all on a coloured run — sklearn 1.3's `could not import 'pandas'` skips
		// went unrecorded for exactly this reason, on a suite that DOES colour, while xarray's uncoloured output
		// recorded fine. This is the third time colour has silently changed a result; strip it before parsing.
		const plainStdout = stripAnsiEscapes(stdout);
		const discovered = [
			...new Set([
				...(collectionFailed
					? [...plainStdout.matchAll(/ModuleNotFoundError: No module named '([A-Za-z][\w]*)'/gu)].map(
							(m) => m[1] ?? "",
						)
					: []),
				...swebenchSkippedForMissingPackage(plainStdout),
			]),
		].filter((name) => name && !notPackages.has(name.toLowerCase()));
		// An id pytest cannot COLLECT does not exist in this checkout — requests 2.27's ids embed a runtime path
		// that does not reproduce. That is not a regression; it is an id with nothing behind it, and the seal
		// names it rather than counting it against the model.
		const uncollectable = [
			...new Set([...stdout.matchAll(/SWEBENCH_ID_NOT_COLLECTED (\S+)/gu)].map((m) => m[1] ?? "")),
		]
			.filter(Boolean)
			.map((id) => ({ id, cause: "not collectable in this checkout" }));
		// A pass-to-pass test that fails in a PRISTINE tree cannot be the model's fault — there is no fix in the
		// tree to have broken it. Where the environment cause could not be removed, the honest answer is to seal
		// those ids with that reason and NAME them on every receipt, rather than let each instance of the spec
		// report them as regressions.
		//
		// Only a MINORITY qualifies. Past a quarter of the set it is not a handful of quirky tests, it is a broken
		// environment, and sealing it would hide exactly what the control exists to find — so it stays dirty.
		const pristineShare = plan.passToPass.length > 0 ? verdict.passToPassFailed.length / plan.passToPass.length : 1;
		// …and only from a run that learned nothing new. Sealing and recording fired in the SAME pass, so a test
		// that failed FOR WANT of a package we were in the act of discovering got filed as unexplainable in the
		// same breath — the seal then outlived the fix and kept excluding a test the next closure would have
		// passed. When this run added a requirement the environment is known-incomplete; the next control, run
		// against the completed closure, is the one entitled to seal anything.
		const learnedSomething = discovered.some(
			(name) => !readRuntimeRequirements(input.cacheRoot, input.entry).includes(name),
		);
		const pristineFailures =
			pristineShare > 0 && pristineShare <= 0.25 && !learnedSomething
				? verdict.passToPassFailed.map((id) => ({ id, cause: "fails in the pristine control" }))
				: [];
		const networkBound = [...networkBoundFailures(passToPassOutput), ...uncollectable, ...pristineFailures];
		if (networkBound.length > 0) {
			try {
				const dir = join(input.cacheRoot, "wheels", swebenchWheelCacheKey(input.entry));
				const existing = readSealedPassToPassExclusions(input.cacheRoot, input.entry);
				const merged = [...existing];
				for (const entry of networkBound) {
					if (!merged.some((row) => row.id === entry.id)) {
						merged.push(entry);
					}
				}
				await writeFile(
					join(dir, SWEBENCH_SEALED_P2P),
					`${merged.map((row) => `${row.id}\t${row.cause}`).join("\n")}\n`,
				);
			} catch {
				// A diagnostic sink must never change a verdict.
			}
		}
		const known = readRuntimeRequirements(input.cacheRoot, input.entry);
		const added = discovered.filter((name) => !known.includes(name));
		if (added.length > 0) {
			try {
				const dir = join(input.cacheRoot, "wheels", swebenchWheelCacheKey(input.entry));
				await writeFile(join(dir, SWEBENCH_RUNTIME_REQUIREMENTS), `${[...known, ...added].join("\n")}\n`);
				// The closure is no longer complete once we know it lacks something, so the marker goes: the next
				// `prepare` re-proves it, and its probe — which installs these too — pulls the wheels in.
				await rm(join(dir, SWEBENCH_PREPARE_MARKER), { force: true });
			} catch {
				// A diagnostic sink must never change a verdict.
			}
		}
	}
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
		resolved: verdict.resolved && resolvable && environmentRefusal === null,
		reason: environmentRefusal ? `${environmentRefusal}; ${reason}` : reason,
		installFailures,
		environmentRefusal,
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
