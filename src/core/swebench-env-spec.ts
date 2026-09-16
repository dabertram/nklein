/**
 * P1.SWEBENCHFULL slice (1)+(2) — environment specs for ANY SWE-bench instance, and the per-repo test runners
 * and log parsers that go with them. PURE core.
 *
 * The N8 tranche works because each of its ten instances carries probe-proven env facts in `SWEBENCH_TRANCHE`.
 * That does not scale to Lite (300) / Verified (500) / the full test split (2,294): twelve repos, compiled deps,
 * their own runners (django `tests/runtests.py`, sympy `bin/test`) and their own output formats. Upstream
 * SWE-bench already carries the evidence — `swebench.harness.constants.MAP_REPO_VERSION_TO_SPECS` names, per
 * (repo, version), the python, the pre-install shell, the install command, the pip packages and the test
 * command; `scripts/swebench-specs.mts` dumps that table into `.nklein-bench/swebench/specs.json` with provenance.
 * This module resolves an instance against the table (a hand-proven tranche entry still WINS as an override) and
 * derives the grader entry, the test command for a selection, and the parser for its output.
 */
import type { SwebenchInstanceMetadata } from "./swebench-instance";
import type { SwebenchTrancheEntry } from "./swebench-tranche";

/** How a repo's test runner reports per-test results. */
export type SwebenchLogParser = "pytest" | "django" | "sympy";

/** One upstream (repo, version) environment spec, normalized from `MAP_REPO_VERSION_TO_SPECS`. */
export interface SwebenchEnvSpec {
	readonly repo: string;
	readonly version: string;
	/** Interpreter (e.g. "3.9"); upstream's value verbatim. */
	readonly python: string;
	/** Shell lines run BEFORE install (apt packages, env exports…) — upstream `pre_install`. */
	readonly preInstall: readonly string[];
	/** Upstream `packages`: a requirements file name ("requirements.txt", "environment.yml") or a space list. */
	readonly packages: string | null;
	/** Upstream `install`: the command that installs the repo itself (e.g. "pip install -e ."). */
	readonly install: string | null;
	/** Upstream `pip_packages`: extra pins the era needs. */
	readonly pipPackages: readonly string[];
	/** Upstream `eval_commands`: shell run BEFORE the test command (locale setup, env exports — django). */
	readonly evalCommands: readonly string[];
	/** Upstream `test_cmd`: the runner invocation the selections are appended to. */
	readonly testCmd: string;
	/** Which parser reads this runner's output. */
	readonly logParser: SwebenchLogParser;
}

/** The dumped table with its provenance (the upstream package version and sha256 it came from). */
export interface SwebenchSpecTable {
	readonly source: {
		readonly package: string;
		readonly version: string;
		readonly sha256: string;
		readonly generatedAt: string;
	};
	readonly specs: readonly SwebenchEnvSpec[];
}

/** A grader entry for an instance plus the runner facts the tranche entries never needed. */
export interface SwebenchResolvedEnv extends SwebenchTrancheEntry {
	/** `<owner>__<name>__<version>` — the env image / wheel cache key shared by every instance of the spec. */
	readonly specKey: string;
	readonly python: SwebenchTrancheEntry["python"];
	readonly pythonVersion: string;
	readonly preInstallShell: readonly string[];
	readonly packages: string | null;
	readonly installCommand: string;
	readonly testCmd: string;
	readonly evalCommands: readonly string[];
	readonly logParser: SwebenchLogParser;
	/** "tranche" when a hand-proven entry supplied the env facts, "spec" when the upstream table did. */
	readonly resolvedFrom: "tranche" | "spec";
}

/** Upstream's parser choice per repo (its `MAP_REPO_TO_PARSER`); everything else reads pytest `-rA` output. */
export const SWEBENCH_REPO_LOG_PARSERS: Readonly<Record<string, SwebenchLogParser>> = {
	"django/django": "django",
	"sympy/sympy": "sympy",
};

export function swebenchSpecKey(repo: string, version: string): string {
	return `${repo.replace("/", "__")}__${version}`;
}

export function findSwebenchEnvSpec(
	table: SwebenchSpecTable,
	repo: string,
	version: string | null,
): SwebenchEnvSpec | undefined {
	if (version === null) {
		return undefined;
	}
	return table.specs.find((spec) => spec.repo === repo && spec.version === version);
}

function entryFromSpec(instance: SwebenchInstanceMetadata, spec: SwebenchEnvSpec): SwebenchResolvedEnv {
	return {
		instanceId: instance.instanceId,
		repo: instance.repo,
		// The tranche type pins "3.9" (its probe); a spec may name any interpreter — carried in pythonVersion.
		python: "3.9",
		pythonVersion: spec.python,
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: [...spec.pipPackages],
		specKey: swebenchSpecKey(spec.repo, spec.version),
		preInstallShell: [...spec.preInstall],
		packages: spec.packages,
		installCommand: spec.install ?? "pip install -e .",
		testCmd: spec.testCmd,
		evalCommands: [...spec.evalCommands],
		logParser: spec.logParser,
		resolvedFrom: "spec",
	};
}

function entryFromTranche(entry: SwebenchTrancheEntry, spec: SwebenchEnvSpec | undefined): SwebenchResolvedEnv {
	return {
		...entry,
		specKey: swebenchSpecKey(entry.repo, spec?.version ?? "tranche"),
		pythonVersion: entry.python,
		preInstallShell: [],
		packages: null,
		installCommand: "pip install -e .",
		testCmd: "python -m pytest -rA -p no:cacheprovider",
		evalCommands: [],
		logParser: "pytest",
		resolvedFrom: "tranche",
	};
}

/**
 * The env for an instance: a hand-proven tranche override first (its facts were probed on the sealed grader —
 * they win over the generic table), else the upstream spec for (repo, version), else a named refusal that says
 * which table row is missing — never a silent default that would grade against the wrong environment.
 */
export function resolveSwebenchEnv(input: {
	readonly instance: SwebenchInstanceMetadata;
	readonly table: SwebenchSpecTable | null;
	readonly overrides: readonly SwebenchTrancheEntry[];
}): SwebenchResolvedEnv {
	const { instance, table, overrides } = input;
	const spec = table ? findSwebenchEnvSpec(table, instance.repo, instance.version) : undefined;
	const override = overrides.find((entry) => entry.instanceId === instance.instanceId);
	if (override) {
		return entryFromTranche(override, spec);
	}
	if (spec) {
		return entryFromSpec(instance, spec);
	}
	throw new Error(
		`no environment for ${instance.instanceId}: it is not in SWEBENCH_TRANCHE and the spec table${
			table ? ` (${table.source.package} ${table.source.version})` : " is absent"
		} has no row for ${instance.repo} @ ${instance.version ?? "<no version>"} — run \`tsx scripts/swebench-specs.mts fetch\` (explicit egress step)`,
	);
}

/**
 * Normalize one raw upstream spec row (the dict `MAP_REPO_VERSION_TO_SPECS[repo][version]` as dumped by the
 * fetcher) into a `SwebenchEnvSpec`. Unknown keys are ignored; a missing `test_cmd` falls back to pytest so a
 * table row can never yield an empty runner.
 */
export function normalizeSwebenchSpecRow(repo: string, version: string, row: Record<string, unknown>): SwebenchEnvSpec {
	const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
	const list = (value: unknown): string[] =>
		Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	return {
		repo,
		version,
		python: str(row.python) ?? "3.9",
		preInstall: list(row.pre_install),
		packages: str(row.packages),
		install: str(row.install),
		pipPackages: list(row.pip_packages),
		evalCommands: list(row.eval_commands),
		testCmd: str(row.test_cmd) ?? "pytest -rA",
		logParser: SWEBENCH_REPO_LOG_PARSERS[repo] ?? "pytest",
	};
}

/** Parse the fetcher's dump `{ source, specs: { [repo]: { [version]: row } } }` into the flat table. */
export function parseSwebenchSpecDump(dump: {
	readonly source: SwebenchSpecTable["source"];
	readonly specs: Readonly<Record<string, Readonly<Record<string, Record<string, unknown>>>>>;
}): SwebenchSpecTable {
	const specs: SwebenchEnvSpec[] = [];
	for (const [repo, versions] of Object.entries(dump.specs)) {
		for (const [version, row] of Object.entries(versions)) {
			specs.push(normalizeSwebenchSpecRow(repo, version, row));
		}
	}
	specs.sort((left, right) => left.repo.localeCompare(right.repo) || left.version.localeCompare(right.version));
	return { source: dump.source, specs };
}

// ---------------------------------------------------------------------------------------------------------------
// (2) Per-runner selection commands and output parsers.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Django's runner takes dotted test labels, not pytest node ids. The dataset writes ids as
 * `test_name (module.path.TestClass)` (or `test_name (module.path.TestClass.test_name)` for subtests); the label
 * the runner wants is `module.path.TestClass.test_name`.
 */
export function djangoTestLabel(testId: string): string {
	const match = /^(\S+) \(([^)]+)\)$/.exec(testId.trim());
	if (!match) {
		return testId.trim();
	}
	const [, name, qualified] = match;
	const parts = (qualified ?? "").split(".");
	// A subtest id already ends in the test name — the label is the qualified path itself.
	return parts[parts.length - 1] === name ? (qualified ?? "") : `${qualified}.${name}`;
}

/** Sympy's `bin/test` takes test FILE paths; a dataset id is the bare function name, so the file comes from the test patch. */
export function sympyTestFiles(testPatch: string): string[] {
	const files = new Set<string>();
	for (const match of testPatch.matchAll(/^diff --git a\/(\S+) b\//gm)) {
		if (match[1]?.includes("/tests/")) {
			files.add(match[1]);
		}
	}
	return [...files];
}

/**
 * The SELECTION ARGUMENTS for one group, per runner — NOT the command itself. The spec's `test_cmd` stays a shell
 * string (sympy's is `PYTHONWARNINGS='…' bin/test -C --verbose`: an env-var PREFIX that dies the moment it is
 * quoted as an argv token — live 2026-09-16, every sympy selection reported "command not found"), so the caller
 * emits `<test_cmd> <quoted selections>` and only these arguments are quoted.
 */
export function buildSwebenchSelectionArguments(input: {
	readonly logParser: SwebenchLogParser;
	readonly selections: readonly string[];
	readonly testPatch: string;
}): readonly string[] {
	if (input.logParser === "django") {
		return [...new Set(input.selections.map(djangoTestLabel))];
	}
	if (input.logParser === "sympy") {
		return sympyTestFiles(input.testPatch);
	}
	return [...input.selections];
}

/** Ids reported PASSED by pytest `-rA` (the tranche's parser, kept exact). */
export function passedIdsFromPytestOutput(output: string): Set<string> {
	const passed = new Set<string>();
	for (const line of output.split("\n")) {
		const match = /^PASSED\s+(\S+)/.exec(line.trim());
		if (match?.[1]) {
			passed.add(match[1]);
		}
	}
	return passed;
}

/**
 * Ids reported ok by django's verbose runner: `test_name (module.Class) ... ok` (a docstring may sit between the
 * id and the status on the same line; failures print `FAIL`/`ERROR`, skips `skipped`). Only `ok` counts.
 */
export function passedIdsFromDjangoOutput(output: string): Set<string> {
	const passed = new Set<string>();
	for (const line of output.split("\n")) {
		const match = /^(\S+ \([^)]+\))(?: .*)? \.\.\. ok$/.exec(line.trim());
		if (match?.[1]) {
			passed.add(match[1]);
		}
	}
	return passed;
}

/** Ids reported ok by sympy's `bin/test --verbose`: `test_name ok` (F = failed, E = error, s/f = skipped/xfail). */
export function passedIdsFromSympyOutput(output: string): Set<string> {
	const passed = new Set<string>();
	for (const line of output.split("\n")) {
		const match = /^(test_\w+)\s+ok$/.exec(line.trim());
		if (match?.[1]) {
			passed.add(match[1]);
		}
	}
	return passed;
}

/**
 * Strip ANSI SGR/CSI escapes before parsing. pytest colourises whenever a plugin or a repo conftest forces it
 * (astropy 5.1 does, through pytest-astropy-header) — even with no TTY — and a coloured `\x1b[32mPASSED\x1b[0m`
 * never matches `^PASSED`. Live 2026-09-16: all 322 pass-to-pass tests of `astropy__astropy-13977` PASSED in the
 * container and the parser read every one as a regression. A grader that mistakes green for red is worse than
 * one that crashes, so this strip guards every parser, not just pytest's.
 */
export function stripAnsiEscapes(output: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point.
	return output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
}

export function passedIdsFromOutput(logParser: SwebenchLogParser, output: string): Set<string> {
	const plain = stripAnsiEscapes(output);
	if (logParser === "django") {
		return passedIdsFromDjangoOutput(plain);
	}
	if (logParser === "sympy") {
		return passedIdsFromSympyOutput(plain);
	}
	return passedIdsFromPytestOutput(plain);
}

// ---------------------------------------------------------------------------------------------------------------
// (4) Sealed grading per spec: the env image, the package list, the install command.
// ---------------------------------------------------------------------------------------------------------------

/** The base image every spec-resolved env is built on: the spec's interpreter plus a C toolchain (compiled deps). */
export function swebenchBaseImageTag(pythonVersion: string): string {
	return `nklein/swebench-base:${pythonVersion}`;
}

/** The env image for a spec that has pre-install shell (apt packages…); specs without it grade on the base image. */
export function swebenchEnvImageTag(specKey: string): string {
	return `nklein/swebench-env:${specKey.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

/**
 * Which image grades an entry: the tranche's stock `python:3.9-slim` for hand-proven entries (byte-identical to
 * the N8 runs), the spec's env image when it needs pre-install shell, else the per-interpreter base image.
 */
export function swebenchGraderImageFor(entry: SwebenchTrancheEntry | SwebenchResolvedEnv): string {
	if (!("resolvedFrom" in entry) || entry.resolvedFrom === "tranche") {
		return "python:3.9-slim";
	}
	return splitSwebenchPreInstall(entry.preInstallShell).image.length > 0
		? swebenchEnvImageTag(entry.specKey)
		: swebenchBaseImageTag(entry.pythonVersion);
}

/**
 * The Dockerfile for a base or env image. Built ONLINE once (an explicit egress step, like `prepare`); every
 * grade then runs in it with `--network none`. Upstream `pre_install` lines are joined into ONE layer so an
 * `export` in one line is visible to the next.
 */
export function buildSwebenchEnvDockerfile(input: {
	readonly pythonVersion: string;
	readonly preInstall: readonly string[];
}): string {
	const lines = [
		`FROM python:${input.pythonVersion}-slim`,
		"ENV DEBIAN_FRONTEND=noninteractive PIP_DISABLE_PIP_VERSION_CHECK=1",
		// The era interpreters ride ARCHIVED Debian releases (python:3.5-slim = buster, 3.6 = bullseye). Two failure
		// modes seen live (2026-09-15): `apt-get update` itself fails (buster), or update succeeds while the security
		// pool 404s at install time (bullseye — and `bullseye-security` has no Release file on archive.debian.org
		// either). So: try update+install; on ANY failure point the main suite at archive.debian.org and DROP the
		// security/-updates suites (every toolchain package lives in the main archive), then retry. A live release
		// never takes the fallback.
		[
			"RUN set -eu; \\",
			'\tpkgs="build-essential pkg-config git ca-certificates wget curl"; \\',
			"\t( apt-get update && apt-get install -y --no-install-recommends $pkgs ) || ( \\",
			"\t\tsed -i 's|deb.debian.org|archive.debian.org|g; /security/d; /-updates/d' /etc/apt/sources.list 2>/dev/null || true; \\",
			'\t\tfor f in /etc/apt/sources.list.d/*.sources; do [ -e "$f" ] || continue; \\',
			'\t\t\tgrep -q -e security -e -updates "$f" && rm -f "$f" || sed -i \'s|deb.debian.org|archive.debian.org|g\' "$f"; \\',
			"\t\tdone; \\",
			"\t\tapt-get -o Acquire::Check-Valid-Until=false update && \\",
			"\t\tapt-get -o Acquire::Check-Valid-Until=false install -y --no-install-recommends $pkgs ); \\",
			"\trm -rf /var/lib/apt/lists/*",
		].join("\n"),
	];
	const { image } = splitSwebenchPreInstall(input.preInstall);
	if (image.length > 0) {
		lines.push(`RUN ${image.map((line) => line.replace(/\n/g, " ")).join(" && ")}`);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Upstream `packages` → what to pip-download/install beyond the repo itself: a requirements file name is
 * returned as `{ requirementsFile }`, an `environment.yml` is read by the caller into pins via
 * {@link parseCondaEnvironmentYml}, a space-separated list is pins as-is.
 */
export function classifySwebenchPackages(packages: string | null): {
	requirementsFile?: string;
	environmentYml?: string;
	pins: string[];
} {
	if (!packages) {
		return { pins: [] };
	}
	const value = packages.trim();
	if (/\.txt$/.test(value)) {
		return { requirementsFile: value, pins: [] };
	}
	if (/\.ya?ml$/.test(value)) {
		return { environmentYml: value, pins: [] };
	}
	return { pins: value.split(/\s+/).filter(Boolean) };
}

/**
 * Pins from a conda `environment.yml`: the `dependencies:` entries (minus `python`/`pip` themselves, conda
 * channel markers stripped, `=` pins rewritten to `==`) plus the nested `- pip:` list verbatim. An approximation
 * of conda by pip — recorded as such; the negative control (`control <id>`) is what proves an env grades.
 */
export function parseCondaEnvironmentYml(yml: string): string[] {
	const pins: string[] = [];
	let inDependencies = false;
	let inPip = false;
	for (const raw of yml.split("\n")) {
		const line = raw.replace(/#.*$/, "").trimEnd();
		if (!line.trim()) continue;
		const indent = line.length - line.trimStart().length;
		if (/^dependencies\s*:/.test(line)) {
			inDependencies = true;
			inPip = false;
			continue;
		}
		if (indent === 0) {
			inDependencies = false;
			inPip = false;
			continue;
		}
		if (!inDependencies) continue;
		const item = line.trim();
		if (/^-\s*pip\s*:/.test(item)) {
			inPip = true;
			continue;
		}
		if (!item.startsWith("-")) continue;
		const spec = item.replace(/^-\s*/, "").trim();
		if (inPip) {
			if (indent > 2) {
				pins.push(spec);
				continue;
			}
			inPip = false;
		}
		const name = spec.replace(/^[\w-]+::/, "");
		if (/^(python|pip)(\b|[=<>])/.test(name)) continue;
		pins.push(name.replace(/(?<![=<>!])=(?!=)/, "=="));
	}
	return pins;
}

/**
 * The BUILD prerequisites a spec's source needs before its metadata can even be generated: upstream's `packages`
 * space-list is exactly that (e.g. astropy 1.3 pins `setuptools==38.2.4` — modern setuptools cannot run its
 * `setup.py egg_info`, live 2026-09-15), plus wheel and any cython/numpy pin the era needs at build time. Installed
 * into the prepare/grade environment FIRST, with `--no-build-isolation` so the source actually uses them.
 */
export function swebenchSpecBuildRequirements(entry: SwebenchResolvedEnv): string[] {
	const packages = classifySwebenchPackages(entry.packages);
	const fromPins = packages.pins.filter((pin) => /^(setuptools|wheel|cython|numpy|pip)\b/i.test(pin));
	const fromPip = entry.extraRequirements.filter((pin) => /^(setuptools|wheel|cython)\b/i.test(pin));
	return [...new Set(["wheel", ...fromPins, ...fromPip])];
}

/**
 * Upstream `install` → the cache-only editable install the sealed grade runs from /work. pip-shaped commands
 * keep their extras (`-e .[test]` → `-e /work[test]`) and gain `--no-index --find-links` + `--no-build-isolation`;
 * anything else (`python setup.py develop`) runs verbatim inside /work.
 */
/**
 * The extras the spec's install command asks for, as pip spells them (`"[test]"`, or `""`). The PREPARE download
 * must target the same thing the install does: sphinx's spec installs `-e .[test]`, we downloaded a bare `/src`,
 * and the `[test]` extra's requirements — pytest among them — never entered the wheel closure. Every sealed
 * sphinx grade then failed the editable install with "No matching distribution found for pytest" and tox ran a
 * pristine `.tox/py39` with nothing in it: fifteen specs, every pass-to-pass test scored as a regression.
 */
/**
 * The spec's `test_cmd`, with one rewrite: `tox --current-env` becomes `tox --runner current-env`.
 *
 * tox-current-env 0.0.11 still REGISTERS `--current-env` on tox 4.16 — `tox --help` lists it — but the flag is
 * inert there: tox builds `.tox/py39` anyway and runs its empty interpreter. Proven side by side in the sealed
 * container on 2026-09-16: `--current-env` gave `No module named pytest` from `/work/.tox/py39/bin/python`,
 * while `--runner current-env` ran the tests in the environment we installed. Fifteen sphinx specs depend on it.
 */
/**
 * Caps on packages whose MODERN releases break era code, applied to every pip invocation in both the prepare
 * download and the sealed grade (pip honours `PIP_CONSTRAINT` in nested calls too, which is the point — a
 * repo's own build spawns pip and carries none of our flags).
 *
 * Upstream's published images froze their dependency resolution in 2024; ours resolves today. Where that drift
 * is merely newer, it is harmless. Where a package REMOVED something the era depends on, it is fatal, and the
 * only durable fix is to keep the offending release out of the wheel cache entirely — a constraint the grade
 * cannot then resolve around.
 *
 * Each entry names the evidence:
 * - `setuptools<82`: setuptools 82 removed `pkg_resources`. sphinx 4.1's `sphinx/registry.py` imports
 *   `iter_entry_points` from it, so every sealed sphinx grade aborted at collection with
 *   `No module named 'pkg_resources'`. Capping at 80.10.2 (verified to still ship it) fixes fifteen specs.
 *   The upgrade did not come from our own install line — tox's `usedevelop = True` runs its OWN `pip install -e .`
 *   inside the graded environment, which is exactly why this has to be a constraint and not a pin.
 */
export const SWEBENCH_ERA_CONSTRAINTS: readonly string[] = ["setuptools<82"];

/** The shell lines that materialize the era constraints and point every pip invocation at them. */
export function swebenchEraConstraintLines(extra: readonly string[] = []): string[] {
	return [
		`printf '%s\\n' ${[...SWEBENCH_ERA_CONSTRAINTS, ...extra].map((line) => `'${line}'`).join(" ")} > /tmp/swebench-era-constraints.txt`,
		"export PIP_CONSTRAINT=/tmp/swebench-era-constraints.txt",
	];
}

/**
 * The `setup_requires=[...]` literal from a legacy `setup.py`.
 *
 * These are neither install requirements nor PEP 518 build requirements: setuptools resolves them AT BUILD TIME
 * by spawning its own `pip wheel`, so `pip download /src` never sees them and they never enter the wheel cache.
 * matplotlib 3.6's setup.py asks for `certifi>=2020.06.20`, the nested pip found nothing in the sealed cache,
 * and the editable install died with `metadata-generation-failed` — six specs, every pass-to-pass test lost.
 *
 * Deliberately literal: only a straight list of string literals is read. A computed `setup_requires` cannot be
 * resolved without executing the file, and guessing is worse than the honest miss the prepare now reports.
 */
export function parseSetupRequires(setupPy: string): string[] {
	const block = /setup_requires\s*=\s*\[([\s\S]*?)\]/u.exec(setupPy);
	if (!block?.[1]) {
		return [];
	}
	return [...block[1].matchAll(/"([^"]*)"|'([^']*)'/gu)]
		.map((match) => (match[1] ?? match[2] ?? "").trim())
		.filter(Boolean);
}

export function swebenchTestCommand(testCmd: string): string {
	return testCmd.replace(/(^|\s)--current-env(\s|$)/u, "$1--runner current-env$2");
}

export function swebenchInstallExtras(installCommand: string): string {
	return /(?:^|\s)(?:-e\s+)?\.(\[[^\]]*\])/u.exec(installCommand)?.[1] ?? "";
}

export function sealedInstallCommand(installCommand: string, wheelsArgs: string, root = "/work"): string {
	const pip = /(?:python(?:3)?\s+-m\s+)?pip\s+install\s+(.*)$/.exec(installCommand.trim());
	if (!pip) {
		return `cd ${root} && ${installCommand}`;
	}
	const rest = (pip[1] ?? "")
		.replace(
			/(^|\s)-e\s+\.(\[[^\]]*\])?/,
			(_m, lead: string, extras: string | undefined) => `${lead}-e ${root}${extras ?? ""}`,
		)
		.replace(
			/(^|\s)\.(\[[^\]]*\])?(?=\s|$)/,
			(_m, lead: string, extras: string | undefined) => `${lead}${root}${extras ?? ""}`,
		)
		.replace(/--no-build-isolation/g, "")
		.trim();
	return `python -m pip install --disable-pip-version-check -q ${wheelsArgs} --no-build-isolation ${rest}`.replace(
		/\s+/g,
		" ",
	);
}

// ---------------------------------------------------------------------------------------------------------------
// (4b) Upstream `pre_install` lines: which belong in the env IMAGE and which must run in the REPO at grade time.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Upstream runs every `pre_install` line inside `/testbed` (the checked-out repo) before installing. Two kinds hide
 * in that list: system setup (apt packages, locales, exported variables, tarballs fetched to /tmp) that belongs in
 * the image built once per spec, and repo edits (`sed -i … pyproject.toml`, anything under `/testbed`) that must run
 * against THE instance's checkout right before its install. A repo line at image-build time has no repo to edit; a
 * system line at grade time has no network. This splits them; `/testbed` is rewritten to the sealed workspace path.
 */
export function splitSwebenchPreInstall(preInstall: readonly string[]): { image: string[]; repo: string[] } {
	// The split must keep the block CONTIGUOUS: upstream's lines share shell state (matplotlib assigns
	// `QHULL_BUILD_DIR="/testbed/build"` and three lines later uses `$QHULL_BUILD_DIR`). Cherry-picking the
	// repo-touching lines stranded the assignment in one stage and its use in the other — live 2026-09-16, every
	// matplotlib env image failed on `mkdir -p ""`. So: the longest PREFIX of pure system setup goes into the
	// image; from the first line that touches the repo (or sets a variable a later line may use) everything runs,
	// in order, in the workspace shell.
	const isSystemOnly = (line: string): boolean =>
		/^(apt-get|apt|locale-gen|update-locale|ln -s|mkdir -p \/(etc|usr|opt)|echo .*>\s*\/etc)/.test(line.trim()) ||
		/^(DEBIAN_FRONTEND=\S+\s+)?apt-get\b/.test(line.trim());
	const image: string[] = [];
	let index = 0;
	for (; index < preInstall.length; index += 1) {
		const line = (preInstall[index] ?? "").trim();
		if (!line) continue;
		if (!isSystemOnly(line)) break;
		image.push(line);
	}
	const repo = preInstall
		.slice(index)
		.map((line) => line.trim())
		.filter(Boolean);
	return { image, repo };
}

/** A repo-level pre_install line rewritten for the sealed workspace (`/testbed` → the mounted workspace). */
export function rewriteSwebenchRepoLine(line: string, workspacePath: string): string {
	return line.replace(/\/testbed\b/g, workspacePath);
}

/**
 * Upstream's `packages: "requirements.txt"` is a SENTINEL, not a path: their harness resolves a per-repo file
 * (`MAP_REPO_TO_REQS_PATHS`) at the instance's commit, follows `-r` includes, and drops `-e .`, comments and
 * `.[test…]` extras. Live 2026-09-15 that sentinel made ten django/pylint prepares die with "Could not open
 * requirements file". This is the same table, applied to the LOCAL checkout (no network); the first path that
 * exists wins, exactly as upstream breaks on the first 200.
 */
export const SWEBENCH_REPO_REQUIREMENTS_PATHS: Readonly<Record<string, readonly string[]>> = {
	"dbt-labs/dbt-core": ["dev-requirements.txt", "dev_requirements.txt"],
	"django/django": ["tests/requirements/py3.txt"],
	"matplotlib/matplotlib": ["requirements/dev/dev-requirements.txt", "requirements/testing/travis_all.txt"],
	"pallets/flask": ["requirements/dev.txt"],
	"pylint-dev/pylint": ["requirements_test.txt"],
	"pyvista/pyvista": ["requirements_test.txt", "requirements.txt"],
	"sqlfluff/sqlfluff": ["requirements_dev.txt"],
	"sympy/sympy": ["requirements-dev.txt", "requirements-test.txt"],
};

/** True when upstream's `packages` value is the repo-requirements sentinel rather than a real file name. */
export function isSwebenchRequirementsSentinel(packages: string | null): boolean {
	return (packages ?? "").trim() === "requirements.txt";
}

/**
 * Flatten a repo's requirements file the way upstream does: follow `-r` includes relative to the file's directory,
 * drop `-e .`, comments and `.[test…]` extras. `readFile` returns null for a path that does not exist.
 */
export function flattenSwebenchRequirements(
	entryPath: string,
	readFile: (path: string) => string | null,
	depth = 0,
): string[] {
	const body = readFile(entryPath);
	if (body === null || depth > 4) {
		return [];
	}
	const directory = entryPath.split("/").slice(0, -1).join("/");
	const excluded = (line: string): boolean =>
		["-e .", "#", ".[test"].some((prefix) => line.trim().startsWith(prefix)) || line.trim().length === 0;
	const lines: string[] = [];
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("-r")) {
			const included = trimmed.slice(2).trim();
			lines.push(
				...flattenSwebenchRequirements(directory ? `${directory}/${included}` : included, readFile, depth + 1),
			);
			continue;
		}
		if (!excluded(line)) {
			lines.push(trimmed);
		}
	}
	return lines;
}

/**
 * A repo's PEP 518 build requirements (`[build-system] requires` in pyproject.toml). We install the spec's build
 * pins and then build WITHOUT isolation — which is what lets an era repo use its pinned setuptools — but that also
 * means pip no longer fetches these for us (live 2026-09-15: astropy 4.3 died with
 * `ModuleNotFoundError: No module named 'extension_helpers'`). So they join the build-requirements stage.
 * Parsed with a narrow regex rather than a TOML dependency: the array is a flat list of quoted requirement strings.
 */
export function parsePep518BuildRequires(pyprojectToml: string): string[] {
	const section = /\[build-system\]([\s\S]*?)(?:\n\[|$)/u.exec(pyprojectToml);
	if (!section?.[1]) {
		return [];
	}
	const requires = /requires\s*=\s*\[([\s\S]*?)\]/u.exec(section[1]);
	if (!requires?.[1]) {
		return [];
	}
	// Match TOML strings by their OWN quote type: a double-quoted requirement legitimately contains single quotes
	// (scikit-learn: `"oldest-supported-numpy; python_version!='3.10' or platform_system!='Windows'"`). A naive
	// character class split that marker into fragments and pip died with `InvalidMarker: 'python_version!='`.
	return [...requires[1].matchAll(/"([^"]*)"|'([^']*)'/gu)]
		.map((match) => (match[1] ?? match[2] ?? "").trim())
		.filter(Boolean);
}

/**
 * The C diagnostics GCC 14 promoted from warnings to hard errors. SWE-bench's own images are Ubuntu 22.04 with
 * GCC 11, where these are warnings; our base images are Debian 13 with GCC 14.2, where the SAME pre-2023 sources
 * stop compiling. Live on 2026-09-16: astropy 4.3's `wcslib_celprm_wrap.c` failed its editable install with
 * `initialization of 'PyCelprm *' from incompatible pointer type`, which surfaced downstream as thirteen
 * pass-to-pass "regressions" in a PRISTINE control tree (the package never installed, so `astropy.__version__`
 * was missing). Demoting them back to warnings reproduces the compiler behaviour the dataset was built against.
 */
export const SWEBENCH_LEGACY_C_DIAGNOSTICS: readonly string[] = [
	"-Wno-error=implicit-function-declaration",
	"-Wno-error=implicit-int",
	"-Wno-error=int-conversion",
	"-Wno-error=incompatible-pointer-types",
	"-Wno-error=return-mismatch",
	"-Wno-error=declaration-missing-parameter-type",
];

/**
 * `installEnv` with the legacy C diagnostics appended to `CFLAGS`. distutils APPENDS the environment's `CFLAGS`
 * to the interpreter's own compile options, so appending here is additive for a spec that already sets the
 * variable rather than a silent override of it.
 */
export function withSwebenchLegacyCBuildEnv(installEnv: Readonly<Record<string, string>>): Record<string, string> {
	const flags = SWEBENCH_LEGACY_C_DIAGNOSTICS.join(" ");
	const existing = installEnv.CFLAGS?.trim();
	return { ...installEnv, CFLAGS: existing ? `${existing} ${flags}` : flags };
}
