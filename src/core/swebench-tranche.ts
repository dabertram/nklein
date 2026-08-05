/**
 * N8 — THE tranche: the ten SWE-bench instances the nightly drains, each with the grader-env facts PROVEN by
 * the 2026-08-05 probe (real py3.9 venv per instance; the sole fail-to-pass selection must RUN and FAIL
 * pre-fix — an instance whose F2P passes unfixed cannot discriminate and is excluded by name below).
 *
 * Everything here is evidence, not guesswork:
 *  - `python` is 3.9 for the whole tranche — the era SWE-bench maps these repos to, and the probe ran on it.
 *  - `preInstallRequirements` land BEFORE the editable install (modern setuptools ≥81 removed `pkg_resources`,
 *    which 4.x–6.x pytest imports at runtime).
 *  - `installEnv` carries SETUPTOOLS_SCM_PRETEND_VERSION for pytest-repo instances: codeload tarballs have no
 *    git history, so setuptools_scm invents `0.1.dev1+g…` and pytest's own minversion check rejects itself.
 *  - `installArgs` carries `--no-build-isolation` where the repo pins a build backend without PEP 660
 *    (pylint 2.15/2.16 era) — the venv's modern setuptools provides `build_editable` instead. (Grade-time
 *    installs ALWAYS run --no-build-isolation regardless: an isolated build env fetches from the index, which
 *    `--network none` forbids — the flag here records which instances need it even ONLINE.)
 *  - `buildRequirements` are the PEP 517 build deps beyond setuptools+wheel (pytest builds need
 *    setuptools-scm) — offline grading must have their wheels cached.
 *  - pytest-repo instances install NO pytest of their own (empty `extraRequirements`): the editable install IS
 *    the pytest under test, and a modern one would shadow it. Where a range appears, it is probe-proven
 *    (pytest 8's bundled `py` shim breaks `from py._path.local import …` in old pylint test modules;
 *    `pytest<8` + real `py` restores them).
 */

export interface SwebenchTrancheEntry {
	readonly instanceId: string;
	readonly repo: string;
	/** Interpreter the grader env is built with (probe-proven). */
	readonly python: "3.9";
	/** Installed BEFORE `pip install -e .` (build/runtime prerequisites of the era). */
	readonly preInstallRequirements: readonly string[];
	/** Env for the editable install itself. */
	readonly installEnv: Readonly<Record<string, string>>;
	/** Extra args for the editable install. */
	readonly installArgs: readonly string[];
	/** PEP 517 build requirements beyond setuptools+wheel (grade runs offline with --no-build-isolation). */
	readonly buildRequirements: readonly string[];
	/** Installed AFTER the editable install (test runner + era pins); [] means the repo brings its own. */
	readonly extraRequirements: readonly string[];
}

export const SWEBENCH_TRANCHE: readonly SwebenchTrancheEntry[] = [
	{
		instanceId: "pallets__flask-5014",
		repo: "pallets/flask",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		// flask 2.3 leaves Werkzeug unbounded (>=2.3.3); werkzeug 3 removed `__version__` (probe-caught).
		extraRequirements: ["werkzeug<3", "pytest"],
	},
	{
		instanceId: "psf__requests-1921",
		repo: "psf/requests",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: ["pytest"],
	},
	{
		instanceId: "psf__requests-2317",
		repo: "psf/requests",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: ["pytest"],
	},
	{
		instanceId: "psf__requests-5414",
		repo: "psf/requests",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: ["pytest"],
	},
	{
		instanceId: "pytest-dev__pytest-5227",
		repo: "pytest-dev/pytest",
		python: "3.9",
		preInstallRequirements: ["setuptools<81"],
		installEnv: { SETUPTOOLS_SCM_PRETEND_VERSION: "4.4.0" },
		installArgs: [],
		buildRequirements: ["setuptools-scm"],
		extraRequirements: [],
	},
	{
		instanceId: "pytest-dev__pytest-6202",
		repo: "pytest-dev/pytest",
		python: "3.9",
		preInstallRequirements: ["setuptools<81"],
		installEnv: { SETUPTOOLS_SCM_PRETEND_VERSION: "5.2.0" },
		installArgs: [],
		buildRequirements: ["setuptools-scm"],
		extraRequirements: [],
	},
	{
		instanceId: "pytest-dev__pytest-7521",
		repo: "pytest-dev/pytest",
		python: "3.9",
		preInstallRequirements: ["setuptools<81"],
		installEnv: { SETUPTOOLS_SCM_PRETEND_VERSION: "6.0.0" },
		installArgs: [],
		buildRequirements: ["setuptools-scm"],
		extraRequirements: [],
	},
	{
		instanceId: "pylint-dev__pylint-4970",
		repo: "pylint-dev/pylint",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: ["pytest"],
	},
	{
		instanceId: "pylint-dev__pylint-6903",
		repo: "pylint-dev/pylint",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: ["pytest<8", "py"],
	},
	{
		instanceId: "pylint-dev__pylint-7993",
		repo: "pylint-dev/pylint",
		python: "3.9",
		preInstallRequirements: ["setuptools<81"],
		installEnv: {},
		installArgs: ["--no-build-isolation"],
		buildRequirements: [],
		extraRequirements: ["pytest<8", "py"],
	},
];

/** Candidates REJECTED by the probe, with the disqualifying evidence — an exclusion must never look like an oversight. */
export const SWEBENCH_TRANCHE_EXCLUSIONS: readonly { instanceId: string; reason: string }[] = [
	{
		instanceId: "pylint-dev__pylint-7277",
		reason:
			"its ONLY fail-to-pass selection (tests/test_self.py::TestRunTC::test_modify_sys_path) PASSES pre-fix in the py3.9 grader env (probe 2026-08-05) — the instance cannot discriminate a fix from no fix here, failing the deterministic-grading bar; replaced by pylint-dev__pylint-7993",
	},
];
