import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

import {
	parseSwebenchSpecDump,
	resolveSwebenchEnv,
	stripAnsiEscapes,
	swebenchPipRequirement,
} from "../../../src/core/swebench-env-spec";
import {
	applyTestPatchToCopy,
	buildSwebenchGradeScript,
	buildSwebenchPrepareScript,
	buildSwebenchProbeScript,
	exactRequirementPins,
	networkBoundFailures,
	planSealedGrade,
	resolutionFailures,
	specExactPins,
	splitSwebenchGradeOutput,
	swebenchEnvironmentRefusal,
	swebenchSkippedForMissingPackage,
	swebenchWheelCacheKey,
} from "../../../src/core/swebench-grader";
import type { SwebenchInstanceMetadata } from "../../../src/core/swebench-instance";
import { buildSwebenchGradePlan } from "../../../src/core/swebench-instance";
import type { SwebenchTrancheEntry } from "../../../src/core/swebench-tranche";

/**
 * N8 — sealed-grader script construction: cache-only installs at grade time (`--no-index` on every pip), the
 * era pins and pretend-version riding exactly where the probe proved they belong, and malformed output
 * degrading to the honest all-failed verdict.
 */
const entry: SwebenchTrancheEntry = {
	instanceId: "pytest-dev__pytest-9999",
	repo: "pytest-dev/pytest",
	python: "3.9",
	preInstallRequirements: ["setuptools<81"],
	installEnv: { SETUPTOOLS_SCM_PRETEND_VERSION: "5.0.0" },
	installArgs: ["--no-build-isolation"],
	buildRequirements: ["setuptools-scm"],
	extraRequirements: ["py"],
};

const instance: SwebenchInstanceMetadata = {
	instanceId: "pytest-dev__pytest-9999",
	repo: "pytest-dev/pytest",
	baseCommit: "0".repeat(40),
	datasets: ["synthetic"],
	failToPass: ["testing/test_x.py::test_new"],
	passToPass: ["testing/test_x.py::test_old"],
	testPatch: "diff --git …",
	problemStatement: "x",
	goldPatchBytes: 1,
	goldPatchFiles: 1,
	version: "5.0",
};

describe("buildSwebenchPrepareScript", () => {
	it("downloads the repo's resolved deps, every pin, AND the offline build toolchain into the wheel dir", () => {
		const script = buildSwebenchPrepareScript(entry);
		expect(script).toContain("pip download");
		expect(script).toContain("/cache/wheels/pytest-dev__pytest-9999");
		expect(script).toContain("'setuptools<81'");
		expect(script).toContain("'py'");
		// pip download never includes PEP 517 build requirements in a source's closure — they must be explicit,
		// or grade-time (--network none) dies fetching setuptools (control-caught on the whole first sweep).
		expect(script).toContain("'wheel'");
		expect(script).toContain("'setuptools-scm'");
	});
});

describe("buildSwebenchGradeScript", () => {
	it("cache-only installs, toolchain first, --no-build-isolation ALWAYS, pretend version on the editable install", () => {
		const script = buildSwebenchGradeScript(entry, buildSwebenchGradePlan(instance));
		const pipLines = script.split("\n").filter((line) => line.includes("pip install"));
		// pip-upgrade, toolchain, packages, editable — the venv's bundled pip is too old to read modern wheel tags.
		expect(pipLines.length).toBe(4);
		for (const line of pipLines) {
			expect(line, `not cache-only: ${line}`).toContain("--no-index --find-links /cache/wheels/");
			expect(line, `not diagnosable: ${line}`).toContain("SWEBENCH_PIP_FAILED");
		}
		const [pipUpgrade, toolchain, editable, extras] = pipLines;
		expect(pipUpgrade).toContain("--upgrade 'pip'");
		expect(toolchain).toContain("'wheel'");
		expect(toolchain).toContain("'setuptools<81'");
		expect(toolchain).toContain("'setuptools-scm'");
		expect(editable).toContain("env SETUPTOOLS_SCM_PRETEND_VERSION='5.0.0'");
		expect(editable).toContain("--no-build-isolation");
		expect(editable).toContain("-e /work");
		expect(extras).toContain("'py'");
		// pytest diagnostics (collection errors land on stderr) must reach the parsed stream.
		expect(script).toContain("===SWEBENCH_F2P===");
		// A tranche entry's plan carries the whole runner argv, not bare node ids, so it keeps the plain call —
		// which is also what keeps pass-1 comparability. Only pure-node-id selections get the collect intersection.
		expect(
			script.split("\n").filter((line) => line.includes("'pytest' '-rA'") && line.includes("2>&1")),
		).toHaveLength(2);
		expect(script).not.toContain("--collect-only");
	});
});

describe("splitSwebenchGradeOutput", () => {
	it("splits the two pytest outputs by marker", () => {
		const { failToPassOutput, passToPassOutput } = splitSwebenchGradeOutput(
			"noise\n===SWEBENCH_F2P===\nPASSED a\n===SWEBENCH_P2P===\nPASSED b\n===SWEBENCH_END===\n",
		);
		expect(failToPassOutput).toContain("PASSED a");
		expect(passToPassOutput).toContain("PASSED b");
		expect(failToPassOutput).not.toContain("PASSED b");
	});

	it("malformed output (env death before markers) reads as empty — every selection then counts failed", () => {
		expect(splitSwebenchGradeOutput("docker: no such image")).toEqual({
			failToPassOutput: "",
			passToPassOutput: "",
		});
	});
});

describe("applyTestPatchToCopy", () => {
	it("refuses with a named reason when the agent edited the graded tests, instead of throwing", async () => {
		// Live-found 2026-08-08 (pallets__flask-5014): the model changed ONLY tests/test_blueprints.py, so the
		// instance's own test_patch no longer applied and the grader died on the raw git error. Refusal has to be
		// a VERDICT — a crash reads as infrastructure trouble, and "grade it anyway" would score a tampered suite.
		const dir = await mkdtemp(join(tmpdir(), "swebench-apply-"));
		await execFileAsync("git", ["-C", dir, "init", "-q"]);
		await writeFile(join(dir, "test_thing.py"), "def test_one():\n    assert 2 == 2\n");

		const result = await applyTestPatchToCopy(
			dir,
			// A test_patch written against the PRISTINE line ("assert 1 == 1") — the agent's edit moved it.
			"diff --git a/test_thing.py b/test_thing.py\n--- a/test_thing.py\n+++ b/test_thing.py\n@@ -1,2 +1,2 @@\n def test_one():\n-    assert 1 == 1\n+    assert 1 == 2\n",
		);

		expect(result.applied).toBe(false);
		if (!result.applied) {
			expect(result.reason).toBe("graded_tests_modified");
			expect(result.detail).toContain("test_thing.py");
		}
		// …and the scratch patch file never survives a refusal.
		expect(existsSync(join(dir, ".swebench-test.patch"))).toBe(false);
		await rm(dir, { recursive: true, force: true });
	});

	it("applies cleanly and reports success when the agent left the graded tests alone", async () => {
		const dir = await mkdtemp(join(tmpdir(), "swebench-apply-"));
		await execFileAsync("git", ["-C", dir, "init", "-q"]);
		await writeFile(join(dir, "test_thing.py"), "def test_one():\n    assert 1 == 1\n");

		const result = await applyTestPatchToCopy(
			dir,
			"diff --git a/test_thing.py b/test_thing.py\n--- a/test_thing.py\n+++ b/test_thing.py\n@@ -1,2 +1,2 @@\n def test_one():\n-    assert 1 == 1\n+    assert 1 == 2\n",
		);

		expect(result.applied).toBe(true);
		expect(await readFile(join(dir, "test_thing.py"), "utf8")).toContain("assert 1 == 2");
		await rm(dir, { recursive: true, force: true });
	});
});

describe("planSealedGrade — sealed fail-to-pass exclusions", () => {
	it("drops a declared internet-bound fail-to-pass id, counts it, and names it for the receipt", async () => {
		const dir = await mkdtemp(join(tmpdir(), "swebench-sealed-f2p-"));
		try {
			await writeFile(join(dir, "test_requests.py"), "def test_a(): pass\n");
			const sealedEntry: SwebenchTrancheEntry = {
				...entry,
				sealedFailToPassExclusions: [
					{
						id: "test_requests.py::T::test_history_is_saved",
						cause: "hardcodes https://httpbin.org — impossible offline",
					},
				],
			};
			const sealedInstance: SwebenchInstanceMetadata = {
				...instance,
				failToPass: ["test_requests.py::T::test_history_is_saved", "test_requests.py::T::test_a"],
				passToPass: ["test_requests.py::T::test_old"],
			};
			const sealed = planSealedGrade(sealedEntry, sealedInstance, dir);
			expect(sealed.plan.failToPass).toEqual(["test_requests.py::T::test_a"]);
			expect(sealed.excludedCount).toBe(1);
			expect(sealed.sealedFailToPassExcluded.map((exclusion) => exclusion.id)).toEqual([
				"test_requests.py::T::test_history_is_saved",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("only reports an exclusion the instance actually lists — a stale id is not counted", async () => {
		const dir = await mkdtemp(join(tmpdir(), "swebench-sealed-f2p-"));
		try {
			await writeFile(join(dir, "test_requests.py"), "");
			const sealed = planSealedGrade(
				{ ...entry, sealedFailToPassExclusions: [{ id: "test_requests.py::T::gone", cause: "x" }] },
				{ ...instance, failToPass: ["test_requests.py::T::test_a"], passToPass: [] },
				dir,
			);
			expect(sealed.plan.failToPass).toEqual(["test_requests.py::T::test_a"]);
			expect(sealed.excludedCount).toBe(0);
			expect(sealed.sealedFailToPassExcluded).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("planSealedGrade + grade script for a spec-resolved entry (P1.SWEBENCHFULL slice 4)", () => {
	it("runs django's runner with dotted labels and installs the spec's requirements before the repo", async () => {
		const dir = await mkdtemp(join(tmpdir(), "swebench-spec-grade-"));
		try {
			await writeFile(join(dir, "tests"), "");
			const table = parseSwebenchSpecDump({
				source: {
					package: "swebench",
					version: "4.0.0",
					sha256: "ab".repeat(32),
					generatedAt: "2026-09-15T00:00:00Z",
				},
				specs: {
					"django/django": {
						"4.0": {
							python: "3.8",
							packages: "requirements.txt",
							install: "python -m pip install -e .",
							pip_packages: ["pytz"],
							test_cmd: "./tests/runtests.py --verbosity 2 --settings=test_sqlite --parallel 1",
						},
					},
				},
			});
			const djangoInstance: SwebenchInstanceMetadata = {
				...instance,
				instanceId: "django__django-1",
				repo: "django/django",
				version: "4.0",
				failToPass: ["test_a (auth_tests.test_views.LoginTest)"],
				passToPass: ["test_b (auth_tests.test_views.LoginTest)"],
			};
			const env = resolveSwebenchEnv({ instance: djangoInstance, table, overrides: [] });
			const sealed = planSealedGrade(env, djangoInstance, dir);
			// The plan carries only the SELECTION ARGUMENTS; the spec's test_cmd is prefixed as a shell string.
			// For django those arguments are MODULES — `runtests.py` cannot load the docstring ids the dataset
			// records, so the ids are matched against the output instead.
			expect(sealed.plan.failToPassCommand).toEqual(["auth_tests"]);
			// `packages: "requirements.txt"` is upstream's SENTINEL: the real file is resolved from the checkout and
			// passed in (here: the flattened file the grader writes beside the tree).
			const script = buildSwebenchGradeScript(env, sealed.plan, [], ".nklein-swebench-requirements.txt");
			const pipLines = script.split("\n").filter((line) => line.includes("pip install"));
			expect(pipLines[0]).toContain("--upgrade 'pip'");
			// Order matters more than position: requirements file, then the spec's pins, then the BUILD
			// prerequisites, then the editable install. (The pin stage emits a per-pin fallback too.)
			const at = (needle: string) => pipLines.findIndex((line) => line.includes(needle));
			expect(at("-r '/work/.nklein-swebench-requirements.txt'")).toBeGreaterThan(0);
			expect(at("'pytz'")).toBeGreaterThan(at("-r '/work/.nklein-swebench-requirements.txt'"));
			expect(at("SWEBENCH_PIP_FAILED build-requirements")).toBeGreaterThan(at("'pytz'"));
			expect(pipLines[at("SWEBENCH_PIP_FAILED build-requirements")]).toContain("'wheel'");
			expect(at("--no-build-isolation -e /work")).toBeGreaterThan(at("SWEBENCH_PIP_FAILED build-requirements"));
			// Without a resolved file the sentinel must NOT become a literal `-r requirements.txt`.
			expect(buildSwebenchGradeScript(env, sealed.plan)).not.toContain("-r '/work/requirements.txt'");
			expect(script).toContain("./tests/runtests.py --verbosity 2 --settings=test_sqlite --parallel 1 'auth_tests'");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("wheel-cache key (P1.SWEBENCHFULL: one prepare per spec, not per instance)", () => {
	it("uses the instance id for a hand-proven tranche entry and the spec key for a resolved one", () => {
		expect(swebenchWheelCacheKey(entry)).toBe("pytest-dev__pytest-9999");
		const table = parseSwebenchSpecDump({
			source: {
				package: "swebench",
				version: "3.0.17",
				sha256: "cd".repeat(32),
				generatedAt: "2026-09-15T00:00:00Z",
			},
			specs: {
				"django/django": { "4.0": { python: "3.8", install: "pip install -e .", test_cmd: "./tests/runtests.py" } },
			},
		});
		const resolved = resolveSwebenchEnv({
			instance: { ...instance, instanceId: "django__django-11001", repo: "django/django", version: "4.0" },
			table,
			overrides: [],
		});
		expect(swebenchWheelCacheKey(resolved)).toBe("django__django__4.0");
		const sibling = resolveSwebenchEnv({
			instance: { ...instance, instanceId: "django__django-12002", repo: "django/django", version: "4.0" },
			table,
			overrides: [],
		});
		expect(swebenchWheelCacheKey(sibling)).toBe(swebenchWheelCacheKey(resolved));
		expect(buildSwebenchGradeScript(resolved, buildSwebenchGradePlan(instance))).toContain(
			"/cache/wheels/django__django__4.0",
		);
	});
});

describe("spec pin re-assertion", () => {
	it("keeps only exact pins — a range would let pip choose again", () => {
		expect(specExactPins(["numpy==1.25.2", "pytest>=7", "attrs==23.1.0", "-r reqs.txt", "wheel"])).toEqual([
			"numpy==1.25.2",
			"attrs==23.1.0",
		]);
	});

	it("drops an environment-marker pin, which --no-deps cannot honour safely", () => {
		expect(specExactPins(['numpy==1.19.3; python_version == "3.9"'])).toEqual([]);
	});
});

describe("prepare completion marker", () => {
	it("gates the marker on every non-fatal stage having closed", () => {
		const entry = resolveSwebenchEnv({
			instance: {
				instanceId: "astropy__astropy-12907",
				repo: "astropy/astropy",
				version: "4.3",
				failToPass: [],
				passToPass: [],
				testPatch: "",
			} as never,
			table: parseSwebenchSpecDump({
				source: {
					package: "swebench",
					version: "3.0.17",
					sha256: "0".repeat(64),
					generatedAt: "2026-09-16T00:00:00Z",
				},
				specs: { "astropy/astropy": { "4.3": { python: "3.9", pip_packages: ["numpy==1.25.2"] } } },
			}),
			overrides: [],
		});
		const script = buildSwebenchPrepareScript(entry);
		expect(script).toContain('incomplete=""');
		expect(script).toContain('if [ -n "$incomplete" ]; then echo "SWEBENCH_PREPARE_INCOMPLETE');
		// The container never writes the marker: the driver does, host-side, once the sealed install has proved
		// the closure as well. A script that could touch it would mark a cache the probe has not yet seen.
		expect(script).not.toContain("SWEBENCH_PREPARE_OK");
	});
});

describe("closure probe", () => {
	const entry = {
		instanceId: "x__y-1",
		repo: "x/y",
		python: "3.9",
		pythonVersion: "3.9",
		preInstallRequirements: [],
		installEnv: {},
		installArgs: [],
		buildRequirements: [],
		extraRequirements: [],
		specKey: "x__y__1.0",
		preInstallShell: [],
		packages: null,
		installCommand: "python -m pip install -e .",
		testCmd: "pytest -rA",
		evalCommands: [],
		logParser: "pytest",
		resolvedFrom: "spec",
	} as never;

	it("installs the checkout at /src and keeps pip offline, so a gap cannot be papered over", () => {
		const script = buildSwebenchProbeScript({ entry });
		expect(script).toContain("export PIP_NO_INDEX=1");
		expect(script).toContain("-e /src");
		expect(script).not.toContain("-e /work");
	});

	it("keeps whatever the repo's own pre_install fetched into build/", () => {
		expect(buildSwebenchProbeScript({ entry })).toContain("/cache/build/");
	});
});

describe("resolution failures", () => {
	it("treats an exact pin whose version is not among the candidates as ABSENT", () => {
		const line =
			"ERROR: Could not find a version that satisfies the requirement numpy==1.14.5 (from versions: 1.19.2, 1.19.5)";
		expect(resolutionFailures(line)).toEqual([{ requirement: "numpy==1.14.5", absent: true }]);
	});

	it("treats a requirement whose candidates were all discarded as UNUSABLE", () => {
		const line = "ERROR: Could not find a version that satisfies the requirement matplotlib (from versions: 3.3.4)";
		expect(resolutionFailures(line)).toEqual([{ requirement: "matplotlib", absent: false }]);
	});

	it("treats `from versions: none` as ABSENT", () => {
		const line =
			"ERROR: Could not find a version that satisfies the requirement cython>=3.0.10 (from versions: none)";
		expect(resolutionFailures(line)).toEqual([{ requirement: "cython>=3.0.10", absent: true }]);
	});
});

describe("pip era", () => {
	it("keeps the pip that still HAS --no-use-pep517 when the spec passes it", () => {
		expect(swebenchPipRequirement("python -m pip install -v --no-use-pep517 --no-build-isolation -e .")).toBe(
			"pip<23.1",
		);
	});

	it("takes the newest pip otherwise", () => {
		expect(swebenchPipRequirement("python -m pip install -e .")).toBe("pip");
	});
});

describe("network-bound failures", () => {
	it("recognises a failure the sealed namespace caused, not the code", () => {
		const output = [
			"FAILED lib/matplotlib/tests/test_image.py::test_https_imread_smoketest - urllib.error.URLError: <urlopen error>",
			"FAILED test_requests.py::TestTimeout::test_connect_timeout - requests.exceptions.ConnectionError: nope",
		].join("\n");
		expect(networkBoundFailures(output).map((row) => row.id)).toEqual([
			"lib/matplotlib/tests/test_image.py::test_https_imread_smoketest",
			"test_requests.py::TestTimeout::test_connect_timeout",
		]);
	});

	it("leaves an ordinary assertion failure alone", () => {
		expect(networkBoundFailures("FAILED tests/test_x.py::test_y - AssertionError: 1 != 2")).toEqual([]);
	});

	it("reads through ANSI colour", () => {
		const coloured = "\u001B[31mFAILED\u001B[0m tests/t.py::test_a - requests.exceptions.ConnectTimeout: x";
		expect(networkBoundFailures(coloured).map((row) => row.id)).toEqual(["tests/t.py::test_a"]);
	});
});

describe("an install that failed is a REFUSAL, not a score (live 2026-09-17: astropy 13398)", () => {
	// The exact shape the first instance of the Haiku Verified run produced: the closure held the spec SIBLING's
	// cython pin, the build requirements could not resolve, the editable install died on the missing
	// `extension_helpers`, and pytest then aborted parsing setup.cfg's warning filters. Scored naively that is a
	// PRISTINE tree "regressing" all 68 of its own pass-to-pass tests.
	const brokenInstall = [
		"SWEBENCH_PIP_FAILED build-requirements",
		"ERROR: Could not find a version that satisfies the requirement cython==0.29.30 (from versions: 0.29.22)",
		"SWEBENCH_PIP_FAILED editable",
		"  ModuleNotFoundError: No module named 'extension_helpers'",
		"error: metadata-generation-failed",
		"===SWEBENCH_F2P===",
		"ModuleNotFoundError: No module named 'astropy'",
		"===SWEBENCH_P2P===",
		"ModuleNotFoundError: No module named 'astropy'",
		"===SWEBENCH_END===",
	].join("\n");

	it("refuses when the repo under test did not install, and names every failed stage", () => {
		const { installFailures, refusal } = swebenchEnvironmentRefusal(brokenInstall);
		expect(installFailures).toEqual(["build-requirements", "editable"]);
		expect(refusal).toContain("environment refused");
		expect(refusal).toContain("the repo under test did not install");
		expect(refusal).toContain("build-requirements, editable");
	});

	it("refuses a build-requirements failure only when a module was then missing at test time", () => {
		expect(swebenchEnvironmentRefusal("SWEBENCH_PIP_FAILED build-requirements\n1 passed").refusal).toBeNull();
		expect(
			swebenchEnvironmentRefusal(
				"SWEBENCH_PIP_FAILED build-requirements\nModuleNotFoundError: No module named 'roman'",
			).refusal,
		).toContain("a module was missing at test time");
	});

	it("does not read the grade SCRIPT's own echo lines as failures that happened", () => {
		// When docker exits nonzero the caller substitutes the error message, which quotes the whole script. Every
		// `|| echo "SWEBENCH_PIP_FAILED editable"` in that source must stay inert — xarray 0.12 was refused with a
		// stage list of `build-requirements",editable",pins-reassert";,…`, which is script text, not a result.
		const scriptEchoedBack =
			'Command failed: docker run … bash -lc \'pip install -e /work || echo "SWEBENCH_PIP_FAILED editable"\n' +
			'pip install -r r.txt || echo "SWEBENCH_PIP_FAILED pins-reassert";\'';
		expect(swebenchEnvironmentRefusal(scriptEchoedBack)).toEqual({ installFailures: [], refusal: null });
	});

	it("says nothing about a grade that installed cleanly, however many tests failed", () => {
		const honestRed = "===SWEBENCH_F2P===\nFAILED testing/test_x.py::test_new\n===SWEBENCH_END===";
		expect(swebenchEnvironmentRefusal(honestRed)).toEqual({ installFailures: [], refusal: null });
	});
});

describe("a spec's closure covers its SIBLING instances' build requirements (live 2026-09-17)", () => {
	// A closure is keyed per (repo, version), but a spec spans base commits and their declared build requirements
	// move: astropy 5.0 asks for cython==0.29.22 at one commit and cython==0.29.30 at another. Both wheels have to
	// be IN the cache — and neither may reach an install, because together they are unsatisfiable.
	it("downloads the sibling pins without ever installing them", () => {
		const script = buildSwebenchPrepareScript(entry, [], null, ["cython==0.29.30"], [], [], ["cython==0.29.22"]);
		const download = script.split("\n").filter((line) => line.includes("pip download"));
		const install = script.split("\n").filter((line) => line.includes("pip install"));
		expect(download.some((line) => line.includes("'cython==0.29.22'"))).toBe(true);
		expect(download.some((line) => line.includes("'cython==0.29.30'"))).toBe(true);
		for (const line of install) {
			expect(line, `a sibling pin reached an install: ${line}`).not.toContain("cython==0.29.22");
		}
	});
});

describe("exactRequirementPins", () => {
	it("takes every name==version a declaration file names", () => {
		expect(exactRequirementPins('requires = ["cython==0.29.30", "extension-helpers"]\nhypothesis==6.46.7')).toEqual([
			"cython==0.29.30",
			"hypothesis==6.46.7",
		]);
	});

	it("keeps a wildcard pin whole — `numpy==1.21.` is a requirement pip cannot parse", () => {
		expect(exactRequirementPins("numpy==1.21.*")).toEqual(["numpy==1.21.*"]);
	});

	it("ignores environment-marker comparisons, which share the syntax", () => {
		const marker = "numpy==1.22.3; python_version=='3.10' and platform_system=='Windows'; extra == \"test\"";
		expect(exactRequirementPins(marker)).toEqual(["numpy==1.22.3"]);
	});
});

describe("swebenchSkippedForMissingPackage — a skip is not a pass", () => {
	it("reads both phrasings", () => {
		const output = [
			"SKIPPED [1] xarray/tests/test_variable.py:1616: requires bottleneck",
			"SKIPPED [1] sklearn/utils/tests/test_set_output.py:16: could not import 'pandas': No module named 'pandas'",
		].join("\n");
		expect(swebenchSkippedForMissingPackage(output)).toEqual(["bottleneck", "pandas"]);
	});

	it("finds nothing in COLOURED output — which is why the caller strips it first", () => {
		const coloured = "\u001b[33mSKIPPED\u001b[0m [1] t.py:16: could not import 'pandas': No module named 'pandas'";
		expect(swebenchSkippedForMissingPackage(coloured)).toEqual([]);
		expect(swebenchSkippedForMissingPackage(stripAnsiEscapes(coloured))).toEqual(["pandas"]);
	});
});
