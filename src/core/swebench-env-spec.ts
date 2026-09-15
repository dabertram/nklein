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

/** The runner invocation for one selection group, per parser. */
export function buildSwebenchSelectionCommand(input: {
	readonly logParser: SwebenchLogParser;
	readonly testCmd: string;
	readonly selections: readonly string[];
	readonly testPatch: string;
}): readonly string[] {
	const base = input.testCmd.split(/\s+/).filter(Boolean);
	if (input.logParser === "django") {
		return [...base, ...[...new Set(input.selections.map(djangoTestLabel))]];
	}
	if (input.logParser === "sympy") {
		return [...base, ...sympyTestFiles(input.testPatch)];
	}
	return [...base, ...input.selections];
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

export function passedIdsFromOutput(logParser: SwebenchLogParser, output: string): Set<string> {
	if (logParser === "django") {
		return passedIdsFromDjangoOutput(output);
	}
	if (logParser === "sympy") {
		return passedIdsFromSympyOutput(output);
	}
	return passedIdsFromPytestOutput(output);
}
