/**
 * N8 — THE tranche: the ten SWE-bench instances the nightly drains, each with the grader-env facts PROVEN by
 * the 2026-08-05 probe (real py3.9 venv per instance; the sole fail-to-pass selection must RUN and FAIL
 * pre-fix — an instance whose F2P passes unfixed cannot discriminate and is excluded by name below).
 *
 * Everything here is evidence, not guesswork:
 *  - `python` is 3.9 for the whole tranche — the era SWE-bench maps these repos to, and the probe ran on it.
 *  - `preInstallRequirements` land BEFORE the editable install. The pytest pin is `setuptools<71`, for TWO
 *    probe/control-caught reasons: ≥81 removed `pkg_resources` (old pytest imports it at runtime), and ≥71
 *    VENDORS typeguard, whose auto-registered pytest plugin calls `addini(type="string")` — old pytest's
 *    argparsing asserts on it and the whole collection dies.
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
	/**
	 * PASS_TO_PASS ids excluded from SEALED grading, each with cause. Only for tests that are inherently
	 * online (real connect timeouts etc.) — `--network none` changes their failure mode regardless of any fix.
	 * Kept per-instance and tiny so a trimmed regression guard is a recorded decision, never a silent one.
	 */
	readonly sealedPassToPassExclusions?: readonly { id: string; cause: string }[];
	/**
	 * Start a loopback httpbin INSIDE the grade container and export HTTPBIN_URL before the selections run —
	 * for the 2014/15-era requests suites that build URLs from that env (their tests otherwise call
	 * httpbin.org live, which --network none forbids and determinism abhors). Loopback works fine inside the
	 * none-network namespace, so the seal holds.
	 */
	readonly httpbinService?: { readonly port: number };
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
		// pytest-httpbin supplies the httpbin package the loopback service runs; the era suite reads HTTPBIN_URL.
		extraRequirements: ["pytest", "pytest-httpbin"],
		httpbinService: { port: 8998 },
		sealedPassToPassExclusions: [
			{
				id: "test_requests.py::RequestsTestCase::test_mixed_case_scheme_acceptable",
				cause: "iterates HTTPS scheme variants — the loopback httpbin serves plain HTTP only",
			},
			{
				id: "test_requests.py::RequestsTestCase::test_pyopenssl_redirect",
				cause: "hits an external HTTPS endpoint explicitly — TLS egress under --network none",
			},
		],
	},
	{
		instanceId: "psf__requests-2317",
		repo: "psf/requests",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		// pytest-httpbin supplies the httpbin package the loopback service runs; the era suite reads HTTPBIN_URL.
		extraRequirements: ["pytest", "pytest-httpbin"],
		httpbinService: { port: 8998 },
		sealedPassToPassExclusions: [
			{
				id: "test_requests.py::RequestsTestCase::test_mixed_case_scheme_acceptable",
				cause: "iterates HTTPS scheme variants — the loopback httpbin serves plain HTTP only",
			},
			{
				id: "test_requests.py::RequestsTestCase::test_pyopenssl_redirect",
				cause: "hits an external HTTPS endpoint explicitly — TLS egress under --network none",
			},
			{
				id: "test_requests.py::RequestsTestCase::test_auth_is_stripped_on_redirect_off_host",
				cause: "redirects to a SECOND host — a single loopback httpbin cannot serve an off-host hop",
			},
			{
				id: "test_requests.py::TestTimeout::test_stream_timeout",
				cause: "real network timeout to an external host — --network none changes the failure mode",
			},
			{
				id: "test_requests.py::TestTimeout::test_connect_timeout",
				cause: "real network timeout to an external host — --network none changes the failure mode",
			},
			{
				id: "test_requests.py::TestTimeout::test_total_timeout_connect",
				cause: "real network timeout to an external host — --network none changes the failure mode",
			},
		],
	},
	{
		instanceId: "psf__requests-5414",
		repo: "psf/requests",
		python: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		// 2020-era suite serves httpbin IN-PROCESS via the pytest-httpbin fixture — fully sealed-compatible.
		extraRequirements: ["pytest", "pytest-httpbin"],
		sealedPassToPassExclusions: [
			"tests/test_requests.py::TestTimeout::test_connect_timeout[timeout0]",
			"tests/test_requests.py::TestTimeout::test_connect_timeout[timeout1]",
			"tests/test_requests.py::TestTimeout::test_total_timeout_connect[timeout0]",
			"tests/test_requests.py::TestTimeout::test_total_timeout_connect[timeout1]",
		].map((id) => ({
			id,
			cause: "real connect-timeout to an external host — --network none changes the failure mode regardless of fix",
		})),
	},
	{
		instanceId: "pytest-dev__pytest-5227",
		repo: "pytest-dev/pytest",
		python: "3.9",
		preInstallRequirements: ["setuptools<71"],
		installEnv: { SETUPTOOLS_SCM_PRETEND_VERSION: "4.4.0" },
		installArgs: [],
		buildRequirements: ["setuptools-scm"],
		extraRequirements: [],
	},
	{
		instanceId: "pytest-dev__pytest-6202",
		repo: "pytest-dev/pytest",
		python: "3.9",
		preInstallRequirements: ["setuptools<71"],
		installEnv: { SETUPTOOLS_SCM_PRETEND_VERSION: "5.2.0" },
		installArgs: [],
		buildRequirements: ["setuptools-scm"],
		extraRequirements: [],
	},
	{
		instanceId: "pytest-dev__pytest-7521",
		repo: "pytest-dev/pytest",
		python: "3.9",
		preInstallRequirements: ["setuptools<71"],
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
