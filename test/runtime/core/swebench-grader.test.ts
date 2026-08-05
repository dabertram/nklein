import { describe, expect, it } from "vitest";
import {
	buildSwebenchGradeScript,
	buildSwebenchPrepareScript,
	splitSwebenchGradeOutput,
} from "../../../src/core/swebench-grader";
import type { SwebenchInstanceMetadata } from "../../../src/core/swebench-instance";
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
	it("downloads the repo's resolved deps plus every pin into the instance's wheel dir", () => {
		const script = buildSwebenchPrepareScript(entry);
		expect(script).toContain("pip download");
		expect(script).toContain("/cache/wheels/pytest-dev__pytest-9999");
		expect(script).toContain("'setuptools<81'");
		expect(script).toContain("'py'");
	});
});

describe("buildSwebenchGradeScript", () => {
	it("every install is cache-only, pins land in probe-proven order, and the pretend version wraps the editable install", () => {
		const script = buildSwebenchGradeScript(entry, instance);
		const pipLines = script.split("\n").filter((line) => line.includes("pip install"));
		expect(pipLines.length).toBeGreaterThanOrEqual(3);
		for (const line of pipLines) {
			expect(line, `not cache-only: ${line}`).toContain("--no-index --find-links /cache/wheels/");
		}
		const [pre, editable, extras] = pipLines;
		expect(pre).toContain("'setuptools<81'");
		expect(editable).toContain("env SETUPTOOLS_SCM_PRETEND_VERSION='5.0.0'");
		expect(editable).toContain("'--no-build-isolation' -e /work");
		expect(extras).toContain("'py'");
		expect(script).toContain("===SWEBENCH_F2P===");
		expect(script).toContain("===SWEBENCH_P2P===");
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
