import { describe, expect, it } from "vitest";
import {
	buildSwebenchEnvDockerfile,
	buildSwebenchSelectionArguments,
	classifySwebenchPackages,
	djangoTestLabel,
	djangoTestModules,
	flattenSwebenchRequirements,
	isSwebenchRequirementsSentinel,
	normalizeSwebenchSpecRow,
	parseCondaEnvironmentYml,
	parsePep518BuildRequires,
	parseSetupRequires,
	parseSwebenchSpecDump,
	passedIdsFromDjangoOutput,
	passedIdsFromOutput,
	passedIdsFromSympyOutput,
	resolveSwebenchEnv,
	rewriteSwebenchRepoLine,
	SWEBENCH_LEGACY_C_DIAGNOSTICS,
	SWEBENCH_REPO_REQUIREMENTS_PATHS,
	sealedInstallCommand,
	splitSwebenchPreInstall,
	stripAnsiEscapes,
	swebenchEraConstraintLines,
	swebenchGraderImageFor,
	swebenchInstallExtras,
	swebenchLegacyCBuildEnvLines,
	swebenchSpecKey,
	swebenchTestCommand,
	sympyTestFiles,
} from "../../../src/core/swebench-env-spec";
import type { SwebenchInstanceMetadata } from "../../../src/core/swebench-instance";
import type { SwebenchTrancheEntry } from "../../../src/core/swebench-tranche";

// P1.SWEBENCHFULL (1)+(2): any instance resolves to an environment from upstream's spec table, a hand-proven
// tranche entry still wins, a missing row refuses by name; django/sympy runners and parsers.

const table = parseSwebenchSpecDump({
	source: { package: "swebench", version: "4.0.0", sha256: "ab".repeat(32), generatedAt: "2026-09-15T00:00:00Z" },
	specs: {
		"django/django": {
			"4.0": {
				python: "3.8",
				packages: "requirements.txt",
				install: "python -m pip install -e .",
				pre_install: ["apt-get update && apt-get install -y locales"],
				pip_packages: ["pytz"],
				test_cmd: "./tests/runtests.py --verbosity 2 --settings=test_sqlite --parallel 1",
			},
		},
		"sympy/sympy": {
			"1.1": {
				python: "3.9",
				install: "pip install -e .",
				test_cmd: "bin/test -C --verbose",
				pip_packages: ["mpmath==1.3.0"],
			},
		},
		"psf/requests": { "2.3": { python: "3.9", install: "pip install .", test_cmd: "pytest -rA" } },
	},
});

const instance = (overrides: Partial<SwebenchInstanceMetadata>): SwebenchInstanceMetadata => ({
	instanceId: "x__y-1",
	repo: "x/y",
	baseCommit: "0".repeat(40),
	datasets: ["princeton-nlp/SWE-bench_Verified"],
	failToPass: [],
	passToPass: [],
	testPatch: "",
	problemStatement: "",
	goldPatchBytes: 1,
	goldPatchFiles: 1,
	version: "1.0",
	...overrides,
});

describe("parseSwebenchSpecDump / normalizeSwebenchSpecRow", () => {
	it("flattens the upstream dump, picks the repo's parser, and never yields an empty runner", () => {
		expect(table.specs.map((spec) => swebenchSpecKey(spec.repo, spec.version))).toEqual([
			"django__django__4.0",
			"psf__requests__2.3",
			"sympy__sympy__1.1",
		]);
		const django = table.specs[0];
		expect(django?.logParser).toBe("django");
		expect(django?.preInstall).toEqual(["apt-get update && apt-get install -y locales"]);
		expect(table.specs[1]?.logParser).toBe("pytest");
		expect(normalizeSwebenchSpecRow("a/b", "1", {}).testCmd).toBe("pytest -rA");
	});
});

describe("resolveSwebenchEnv", () => {
	it("resolves an instance from the spec table by (repo, version)", () => {
		const env = resolveSwebenchEnv({
			instance: instance({ instanceId: "django__django-1", repo: "django/django", version: "4.0" }),
			table,
			overrides: [],
		});
		expect(env.resolvedFrom).toBe("spec");
		expect(env.specKey).toBe("django__django__4.0");
		expect(env.pythonVersion).toBe("3.8");
		expect(env.installCommand).toBe("python -m pip install -e .");
		expect(env.extraRequirements).toEqual(["pytz"]);
		expect(env.logParser).toBe("django");
	});

	it("lets a hand-proven tranche entry win over the table", () => {
		const proven: SwebenchTrancheEntry = {
			instanceId: "psf__requests-2317",
			repo: "psf/requests",
			python: "3.9",
			preInstallRequirements: [],
			installEnv: {},
			installArgs: [],
			buildRequirements: [],
			extraRequirements: ["pytest", "pytest-httpbin"],
			httpbinService: { port: 8998 },
		};
		const env = resolveSwebenchEnv({
			instance: instance({ instanceId: "psf__requests-2317", repo: "psf/requests", version: "2.3" }),
			table,
			overrides: [proven],
		});
		expect(env.resolvedFrom).toBe("tranche");
		expect(env.httpbinService).toEqual({ port: 8998 });
		expect(env.extraRequirements).toEqual(["pytest", "pytest-httpbin"]);
		expect(env.logParser).toBe("pytest");
	});

	it("refuses by name when neither the tranche nor the table knows the instance", () => {
		expect(() =>
			resolveSwebenchEnv({ instance: instance({ repo: "astropy/astropy", version: "5.0" }), table, overrides: [] }),
		).toThrow(/astropy\/astropy @ 5\.0/);
		expect(() => resolveSwebenchEnv({ instance: instance({}), table: null, overrides: [] })).toThrow(
			/spec table is absent/,
		);
	});
});

describe("django runner", () => {
	it("turns dataset ids into dotted labels, including subtest ids", () => {
		expect(djangoTestLabel("test_a (auth_tests.test_views.LoginTest)")).toBe(
			"auth_tests.test_views.LoginTest.test_a",
		);
		expect(djangoTestLabel("test_a (auth_tests.test_views.LoginTest.test_a)")).toBe(
			"auth_tests.test_views.LoginTest.test_a",
		);
		expect(
			buildSwebenchSelectionArguments({
				logParser: "django",
				selections: ["test_a (m.C)", "test_b (m.C)", "test_a (m.C)"],
				testPatch: "",
			}),
		).toEqual(["m.C.test_a", "m.C.test_b"]);
	});

	it("reads only `... ok` lines as passes, crediting every id form the line could be", () => {
		const passed = passedIdsFromDjangoOutput(
			[
				"test_a (m.C) ... ok",
				"test_b (m.C)",
				"A docstring on the next line ... ok",
				"test_c (m.C) With a docstring ... ok",
				"test_d (m.C) ... FAIL",
				"test_e (m.C) ... ERROR",
				"test_f (m.C) ... skipped 'no'",
			].join("\n"),
		);
		expect([...passed]).toEqual([
			"test_a (m.C)",
			"A docstring on the next line",
			"test_b (m.C)",
			"test_c (m.C) With a docstring",
			"test_c (m.C)",
		]);
	});
});

describe("sympy runner", () => {
	it("runs the test files the test patch touches and reads `test_x ok` lines", () => {
		const testPatch =
			"diff --git a/sympy/core/tests/test_x.py b/sympy/core/tests/test_x.py\n--- a\n+++ b\ndiff --git a/sympy/core/x.py b/sympy/core/x.py\n";
		expect(sympyTestFiles(testPatch)).toEqual(["sympy/core/tests/test_x.py"]);
		expect(buildSwebenchSelectionArguments({ logParser: "sympy", selections: ["test_one"], testPatch })).toEqual([
			"sympy/core/tests/test_x.py",
		]);
		expect([...passedIdsFromSympyOutput("test_one ok\ntest_two F\ntest_three E\ntest_four ok\n")]).toEqual([
			"test_one",
			"test_four",
		]);
	});
});

describe("sealed grading per spec (P1.SWEBENCHFULL slice 4)", () => {
	it("chooses the stock image for tranche entries, the base image for plain specs, the env image for pre-install specs", () => {
		const specEnv = resolveSwebenchEnv({
			instance: instance({ instanceId: "psf__requests-9", repo: "psf/requests", version: "2.3" }),
			table,
			overrides: [],
		});
		const djangoEnv = resolveSwebenchEnv({
			instance: instance({ instanceId: "django__django-1", repo: "django/django", version: "4.0" }),
			table,
			overrides: [],
		});
		const tranche = resolveSwebenchEnv({
			instance: instance({ instanceId: "psf__requests-2317", repo: "psf/requests", version: "2.3" }),
			table,
			overrides: [
				{
					instanceId: "psf__requests-2317",
					repo: "psf/requests",
					python: "3.9",
					preInstallRequirements: [],
					installEnv: {},
					installArgs: [],
					buildRequirements: [],
					extraRequirements: [],
				},
			],
		});
		expect(swebenchGraderImageFor(tranche)).toBe("python:3.9-slim");
		expect(swebenchGraderImageFor(specEnv)).toBe("nklein/swebench-base:3.9");
		expect(swebenchGraderImageFor(djangoEnv)).toBe("nklein/swebench-env:django__django__4.0");
	});

	it("writes a Dockerfile with the toolchain layer and the spec's pre-install joined into one layer", () => {
		const dockerfile = buildSwebenchEnvDockerfile({
			pythonVersion: "3.8",
			preInstall: [
				"apt-get update && apt-get install -y locales",
				"locale-gen en_US.UTF-8",
				"export LC_ALL=C.UTF-8",
			],
		});
		expect(dockerfile).toContain("FROM python:3.8-slim");
		expect(dockerfile).toContain("build-essential");
		// Archived-release fallback: the era interpreters' Debian mirrors are gone from deb.debian.org.
		expect(dockerfile).toContain("archive.debian.org");
		// Only the CONTIGUOUS system prefix is baked; `export LC_ALL=…` starts the workspace stage (a later line
		// may depend on it), so it must NOT appear in the image.
		expect(dockerfile).toContain("RUN apt-get update && apt-get install -y locales && locale-gen en_US.UTF-8");
		expect(dockerfile).not.toContain("LC_ALL");
	});

	it("classifies upstream package lists and reads conda environment files as pip pins", () => {
		expect(classifySwebenchPackages("requirements.txt")).toEqual({ requirementsFile: "requirements.txt", pins: [] });
		expect(classifySwebenchPackages("environment.yml")).toEqual({ environmentYml: "environment.yml", pins: [] });
		expect(classifySwebenchPackages("numpy scipy pandas")).toEqual({ pins: ["numpy", "scipy", "pandas"] });
		expect(classifySwebenchPackages(null)).toEqual({ pins: [] });
		const yml = [
			"name: xarray-tests",
			"channels:",
			"  - conda-forge",
			"dependencies:",
			"  - python=3.10",
			"  - numpy=1.23",
			"  - conda-forge::pandas>=1.4",
			"  - pip",
			"  - pip:",
			"    - numbagg",
			"    - cfgrib==0.9",
			"  - scipy  # trailing comment",
			"prefix: /x",
		].join("\n");
		expect(parseCondaEnvironmentYml(yml)).toEqual(["numpy==1.23", "pandas>=1.4", "numbagg", "cfgrib==0.9", "scipy"]);
	});

	it("turns the spec's install command into the cache-only sealed install, keeping extras", () => {
		const wheels = "--no-index --find-links /cache/wheels/x";
		expect(sealedInstallCommand("pip install -e .[test]", wheels)).toBe(
			"python -m pip install --disable-pip-version-check -q --no-index --find-links /cache/wheels/x --no-build-isolation -e /work[test]",
		);
		expect(sealedInstallCommand("python -m pip install -e .", wheels)).toContain("-e /work");
		expect(sealedInstallCommand("pip install .", wheels)).toContain(" /work");
		expect(sealedInstallCommand("python setup.py develop", wheels)).toBe("cd /work && python setup.py develop");
	});
});

describe("pre_install split (P1.SWEBENCHFULL 4b)", () => {
	it("keeps system setup in the image and sends repo edits to grade time with /testbed rewritten", () => {
		const { image, repo } = splitSwebenchPreInstall([
			"apt-get update && apt-get install -y locales",
			"locale-gen en_US.UTF-8",
			'sed -i \'s/requires = \\["setuptools",/requires = ["setuptools==68.0.0",/\' pyproject.toml',
			"pip install -U setuptools",
			"mkdir -p /testbed/build && tar -xzf /tmp/qhull.tgz -C /testbed/build",
		]);
		expect(image).toEqual(["apt-get update && apt-get install -y locales", "locale-gen en_US.UTF-8"]);
		expect(repo).toHaveLength(3);
		expect(rewriteSwebenchRepoLine(repo[2] ?? "", "/work")).toBe(
			"mkdir -p /work/build && tar -xzf /tmp/qhull.tgz -C /work/build",
		);
		// A spec whose pre_install is repo-only grades on the plain base image, not an env image.
		const dockerfile = buildSwebenchEnvDockerfile({ pythonVersion: "3.9", preInstall: ["sed -i 's/a/b/' setup.py"] });
		// The base apt layer has its own `sed -i` (the archived-release fallback) — the REPO edit is what must be absent.
		expect(dockerfile).not.toContain("setup.py");
	});
});

describe("repo requirements sentinel (upstream MAP_REPO_TO_REQS_PATHS)", () => {
	it("recognises the sentinel and flattens -r includes, dropping -e . comments and extras", () => {
		expect(isSwebenchRequirementsSentinel("requirements.txt")).toBe(true);
		expect(isSwebenchRequirementsSentinel("numpy scipy")).toBe(false);
		expect(SWEBENCH_REPO_REQUIREMENTS_PATHS["django/django"]).toEqual(["tests/requirements/py3.txt"]);
		const files: Record<string, string> = {
			"tests/requirements/py3.txt": [
				"-r base.txt",
				"# a comment",
				"-e .",
				".[test]",
				"aiosmtpd",
				"docutils >= 0.19",
			].join("\n"),
			"tests/requirements/base.txt": ["sqlparse >= 0.3", ""].join("\n"),
		};
		expect(flattenSwebenchRequirements("tests/requirements/py3.txt", (path) => files[path] ?? null)).toEqual([
			"sqlparse >= 0.3",
			"aiosmtpd",
			"docutils >= 0.19",
		]);
		expect(flattenSwebenchRequirements("tests/requirements/missing.txt", () => null)).toEqual([]);
	});
});

describe("PEP 518 build requirements", () => {
	it("reads build-system.requires and ignores the rest of the file", () => {
		const toml = [
			"[build-system]",
			'requires = ["setuptools",',
			'            "setuptools_scm>=6.2",',
			'            "extension-helpers",',
			'            "numpy>=1.18"]',
			'build-backend = "setuptools.build_meta"',
			"",
			"[project]",
			'dependencies = ["never-a-build-require"]',
		].join("\n");
		expect(parsePep518BuildRequires(toml)).toEqual([
			"setuptools",
			"setuptools_scm>=6.2",
			"extension-helpers",
			"numpy>=1.18",
		]);
		expect(parsePep518BuildRequires("[project]\nname='x'\n")).toEqual([]);
		expect(parsePep518BuildRequires("[build-system]\nbuild-backend = 'x'\n")).toEqual([]);
	});
});

describe("PEP 518 requirements with environment markers", () => {
	it("keeps a double-quoted requirement whose marker contains single quotes intact", () => {
		const toml = [
			"[build-system]",
			"requires = [",
			'    "setuptools<60.0",',
			'    "Cython>=0.29.33",',
			"    # a comment",
			`    "oldest-supported-numpy; python_version!='3.10' or platform_system!='Windows'",`,
			"]",
		].join("\n");
		expect(parsePep518BuildRequires(toml)).toEqual([
			"setuptools<60.0",
			"Cython>=0.29.33",
			"oldest-supported-numpy; python_version!='3.10' or platform_system!='Windows'",
		]);
	});
});

describe("legacy C build environment", () => {
	it("probes each flag against the compiler that will use it", () => {
		const lines = swebenchLegacyCBuildEnvLines().join("\n");
		// An OLD gcc treats `-Wno-error=<unknown warning>` as a hard ERROR, so the flag set cannot be fixed
		// host-side across images spanning GCC 8 to GCC 14.
		expect(lines).toContain('gcc "$flag" -x c -c /dev/null');
		expect(lines).toContain("-Wno-error=incompatible-pointer-types");
	});

	it("appends to any CFLAGS already in the environment rather than replacing it", () => {
		expect(swebenchLegacyCBuildEnvLines().at(-1)).toBe('export CFLAGS="${CFLAGS:-}$SWEBENCH_CFLAGS"');
	});

	it("carries no single quote — the flags ride inside a single-quoted shell string", () => {
		expect(SWEBENCH_LEGACY_C_DIAGNOSTICS.some((flag) => flag.includes("'"))).toBe(false);
	});
});

describe("coloured test output", () => {
	it("reads a PASSED line that pytest wrapped in ANSI colour", () => {
		const coloured =
			"\u001B[32mPASSED\u001B[0m astropy/units/tests/test_quantity.py::\u001B[1mTestQuantityCreation::test_1\u001B[0m";
		expect([...passedIdsFromOutput("pytest", coloured)]).toEqual([
			"astropy/units/tests/test_quantity.py::TestQuantityCreation::test_1",
		]);
	});

	it("leaves plain output untouched", () => {
		expect(stripAnsiEscapes("PASSED a/b.py::test")).toBe("PASSED a/b.py::test");
	});

	it("reads a coloured django `... ok` line", () => {
		const coloured = "\u001B[32mtest_x (app.tests.T) ... ok\u001B[0m";
		expect([...passedIdsFromOutput("django", coloured)]).toEqual(["test_x (app.tests.T)"]);
	});
});

describe("install extras", () => {
	it("reads the extra an install command asks for", () => {
		expect(swebenchInstallExtras("python -m pip install -e .[test]")).toBe("[test]");
		expect(swebenchInstallExtras("pip install -v --no-build-isolation -e .")).toBe("");
		expect(swebenchInstallExtras("pip install .[dev,test]")).toBe("[dev,test]");
	});
});

describe("tox current-env", () => {
	it("rewrites the inert --current-env flag to the runner form", () => {
		expect(swebenchTestCommand("tox --current-env -epy39 -v --")).toBe("tox --runner current-env -epy39 -v --");
	});

	it("leaves a plain pytest command alone", () => {
		expect(swebenchTestCommand("pytest -rA")).toBe("pytest -rA");
	});
});

describe("era constraints", () => {
	it("points every pip invocation at a constraints file it writes first", () => {
		const lines = swebenchEraConstraintLines();
		expect(lines[0]).toContain("setuptools<82");
		expect(lines[1]).toBe("export PIP_CONSTRAINT=/tmp/swebench-era-constraints.txt");
	});
});

describe("setup_requires", () => {
	it("reads the literal list a legacy setup.py declares", () => {
		const setupPy = [
			"setup(",
			'    name="matplotlib",',
			"    setup_requires=[",
			'        "certifi>=2020.06.20",',
			'        "numpy>=1.19",',
			'        "setuptools_scm>=7",',
			"    ],",
			")",
		].join("\n");
		expect(parseSetupRequires(setupPy)).toEqual(["certifi>=2020.06.20", "numpy>=1.19", "setuptools_scm>=7"]);
	});

	it("reads nothing when there is no setup_requires", () => {
		expect(parseSetupRequires('setup(name="x", install_requires=["a"])')).toEqual([]);
	});
});

describe("django selections", () => {
	const patch = [
		"diff --git a/tests/migrations/test_autodetector.py b/tests/migrations/test_autodetector.py",
		"--- a/tests/migrations/test_autodetector.py",
		"+++ b/tests/migrations/test_autodetector.py",
		"diff --git a/tests/admin_views/__init__.py b/tests/admin_views/__init__.py",
	].join("\n");

	it("runs the patched MODULES, because half the dataset ids are docstrings", () => {
		expect(djangoTestModules(patch)).toEqual(["migrations.test_autodetector", "admin_views"]);
	});

	it("matches an id printed as a docstring, not just the parenthesised form", () => {
		const output = [
			"test_add_field (migrations.test_autodetector.AutodetectorTests) ... ok",
			"Test change detection of new constraints ... ok",
			"Tests autodetection of new fields ... FAIL",
		].join("\n");
		expect([...passedIdsFromDjangoOutput(output)]).toEqual([
			"test_add_field (migrations.test_autodetector.AutodetectorTests)",
			"Test change detection of new constraints",
		]);
		// A docstring printed on the line AFTER the id credits the id too.
		expect([...passedIdsFromDjangoOutput("test_b (m.C)\nA docstring ... ok")]).toEqual([
			"A docstring",
			"test_b (m.C)",
		]);
	});
});

describe("PEP 518 build requires with an extras marker", () => {
	it("scans the array by bracket depth, so `pkg[extra]` does not truncate the list", () => {
		const pyproject = [
			"[build-system]",
			"requires = [",
			'    "setuptools>=42",',
			'    "wheel",',
			'    "setuptools_scm[toml]>=3.4",',
			'    "setuptools_scm_git_archive",',
			"]",
			'build-backend = "setuptools.build_meta"',
		].join("\n");
		expect(parsePep518BuildRequires(pyproject)).toEqual([
			"setuptools>=42",
			"wheel",
			"setuptools_scm[toml]>=3.4",
			"setuptools_scm_git_archive",
		]);
	});
});
