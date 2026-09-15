import { describe, expect, it } from "vitest";
import {
	buildSwebenchSelectionCommand,
	djangoTestLabel,
	normalizeSwebenchSpecRow,
	parseSwebenchSpecDump,
	passedIdsFromDjangoOutput,
	passedIdsFromSympyOutput,
	resolveSwebenchEnv,
	swebenchSpecKey,
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
			buildSwebenchSelectionCommand({
				logParser: "django",
				testCmd: "./tests/runtests.py --verbosity 2",
				selections: ["test_a (m.C)", "test_b (m.C)", "test_a (m.C)"],
				testPatch: "",
			}),
		).toEqual(["./tests/runtests.py", "--verbosity", "2", "m.C.test_a", "m.C.test_b"]);
	});

	it("reads only `... ok` lines as passes", () => {
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
		expect([...passed]).toEqual(["test_a (m.C)", "test_c (m.C)"]);
	});
});

describe("sympy runner", () => {
	it("runs the test files the test patch touches and reads `test_x ok` lines", () => {
		const testPatch =
			"diff --git a/sympy/core/tests/test_x.py b/sympy/core/tests/test_x.py\n--- a\n+++ b\ndiff --git a/sympy/core/x.py b/sympy/core/x.py\n";
		expect(sympyTestFiles(testPatch)).toEqual(["sympy/core/tests/test_x.py"]);
		expect(
			buildSwebenchSelectionCommand({
				logParser: "sympy",
				testCmd: "bin/test -C --verbose",
				selections: ["test_one"],
				testPatch,
			}),
		).toEqual(["bin/test", "-C", "--verbose", "sympy/core/tests/test_x.py"]);
		expect([...passedIdsFromSympyOutput("test_one ok\ntest_two F\ntest_three E\ntest_four ok\n")]).toEqual([
			"test_one",
			"test_four",
		]);
	});
});
