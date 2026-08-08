import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildSwebenchCard,
	buildSwebenchGradePlan,
	detectGradedTestTampering,
	listGradedTestFiles,
	parseSwebenchGradeOutput,
	type SwebenchInstanceMetadata,
	verifySwebenchPin,
} from "../../../src/core/swebench-instance";

/**
 * N8 — the SWE-bench instance contract: leakage-safe card mapping, grader-side test_patch, and the verbatim
 * resolution rule (ALL fail-to-pass green AND ALL pass-to-pass held; silence in pytest output = failure).
 */
const instance: SwebenchInstanceMetadata = {
	instanceId: "psf__requests-0000",
	repo: "psf/requests",
	baseCommit: "abcdef0123456789abcdef0123456789abcdef01",
	datasets: ["princeton-nlp/SWE-bench_Verified"],
	failToPass: ["tests/test_requests.py::test_fixed_behavior", "tests/test_requests.py::test_param[1]"],
	passToPass: ["tests/test_requests.py::test_existing"],
	testPatch: "diff --git a/tests/test_requests.py b/tests/test_requests.py\n+...",
	problemStatement: "Session cookies leak across redirects\n\nWhen a redirect crosses hosts, cookies persist.",
	goldPatchBytes: 400,
	goldPatchFiles: 1,
	version: "2.3",
};

describe("verifySwebenchPin", () => {
	it("accepts only the exact pinned bytes; drift names the refetch remedy", () => {
		const tarball = new TextEncoder().encode("tarball-bytes");
		const pin = {
			repo: instance.repo,
			baseCommit: instance.baseCommit,
			tarballSha256: createHash("sha256").update(tarball).digest("hex"),
			bytes: tarball.byteLength,
		};
		expect(verifySwebenchPin(tarball, pin).ok).toBe(true);
		const drifted = verifySwebenchPin(new TextEncoder().encode("tampered"), pin);
		expect(drifted.ok).toBe(false);
		if (!drifted.ok) {
			expect(drifted.reason).toContain("swebench-fetch");
		}
	});
});

describe("buildSwebenchCard", () => {
	it("the issue text IS the prompt, with the two harness ground rules and no gold anywhere", () => {
		const card = buildSwebenchCard(instance);
		expect(card.taskId).toBe("swebench-psf__requests-0000");
		expect(card.title).toContain("Session cookies leak across redirects");
		expect(card.prompt).toContain("Do not modify existing tests");
		expect(card.prompt).toContain(instance.problemStatement.trim());
		expect(card.prompt).not.toContain("diff --git"); // the test patch stays grader-side
	});
});

describe("buildSwebenchGradePlan", () => {
	it("runs exactly the instance's own selections, deterministically", () => {
		const plan = buildSwebenchGradePlan(instance);
		expect(plan.failToPassCommand).toEqual([
			"python",
			"-m",
			"pytest",
			"-rA",
			"-p",
			"no:cacheprovider",
			...instance.failToPass,
		]);
		expect(plan.passToPassCommand.slice(-1)).toEqual(instance.passToPass);
		expect(plan.testPatch).toBe(instance.testPatch);
		expect(plan.droppedSelections).toEqual([]);
	});

	it("drops whitespace-split dataset junk BEFORE pytest sees it (one bad id aborts a whole selection run)", () => {
		const dirty: SwebenchInstanceMetadata = {
			...instance,
			passToPass: [
				"tests/test_requests.py::test_ok",
				"[100%]",
				"[",
				"tests/test_requests.py::test_trunc[\\xd0\\xb8-Basic",
				"tests/a.py::test_split id]",
			],
		};
		const plan = buildSwebenchGradePlan(dirty);
		expect(plan.passToPass).toEqual(["tests/test_requests.py::test_ok"]);
		expect(plan.droppedSelections).toHaveLength(4);
		expect(plan.passToPassCommand.filter((part) => part.includes("["))).toEqual([]);
	});

	it("keeps legit parametrized ids, including pytest's escape-sequence renderings", () => {
		const escaped: SwebenchInstanceMetadata = {
			...instance,
			passToPass: ["tests/t.py::test_url[http://stra\\xdfe.de/-ok]", "tests/t.py::TestX::test_y[\\u30b8-1]"],
		};
		const plan = buildSwebenchGradePlan(escaped);
		expect(plan.passToPass).toHaveLength(2);
		expect(plan.droppedSelections).toEqual([]);
	});
});

describe("parseSwebenchGradeOutput", () => {
	it("resolved = every fail-to-pass PASSED and every pass-to-pass held", () => {
		const verdict = parseSwebenchGradeOutput({
			failToPass: instance.failToPass,
			passToPass: instance.passToPass,
			failToPassOutput:
				"PASSED tests/test_requests.py::test_fixed_behavior\nPASSED tests/test_requests.py::test_param[1]\n",
			passToPassOutput: "PASSED tests/test_requests.py::test_existing\n",
		});
		expect(verdict.resolved).toBe(true);
		expect(verdict.reason).toContain("resolved: 2/2");
	});

	it("a pass-to-pass regression makes the fix unresolved, and says REGRESSED", () => {
		const verdict = parseSwebenchGradeOutput({
			failToPass: instance.failToPass,
			passToPass: instance.passToPass,
			failToPassOutput:
				"PASSED tests/test_requests.py::test_fixed_behavior\nPASSED tests/test_requests.py::test_param[1]\n",
			passToPassOutput: "FAILED tests/test_requests.py::test_existing - AssertionError\n",
		});
		expect(verdict.resolved).toBe(false);
		expect(verdict.passToPassFailed).toEqual(instance.passToPass);
		expect(verdict.reason).toContain("REGRESSED");
	});

	it("SILENCE is failure: a test id missing from the output (collection crash) never counts as passed", () => {
		const verdict = parseSwebenchGradeOutput({
			failToPass: instance.failToPass,
			passToPass: instance.passToPass,
			failToPassOutput: "ERROR tests/test_requests.py - ImportError: cannot import name 'x'\n",
			passToPassOutput: "",
		});
		expect(verdict.resolved).toBe(false);
		expect(verdict.failToPassFailed).toEqual(instance.failToPass);
		expect(verdict.passToPassFailed).toEqual(instance.passToPass);
	});
});

describe("graded-test tampering", () => {
	const TEST_PATCH = [
		"diff --git a/tests/test_blueprints.py b/tests/test_blueprints.py",
		"--- a/tests/test_blueprints.py",
		"+++ b/tests/test_blueprints.py",
		"@@ -1,1 +1,2 @@",
		" x",
		"+y",
		"diff --git a/tests/test_helpers.py b/tests/test_helpers.py",
		"--- a/tests/test_helpers.py",
		"+++ b/tests/test_helpers.py",
		"@@ -1,1 +1,2 @@",
		" x",
		"+y",
	].join("\n");

	it("names the graded files an instance is scored by", () => {
		expect(listGradedTestFiles(TEST_PATCH)).toEqual(["tests/test_blueprints.py", "tests/test_helpers.py"]);
	});

	it("reads a graded file DELETED by the test patch, where +++ is /dev/null", () => {
		// The b/ path in the `diff --git` header survives a deletion; parsing `+++` would drop the file from the
		// guarded set and let an agent edit it undetected.
		const deletion = [
			"diff --git a/tests/test_gone.py b/tests/test_gone.py",
			"--- a/tests/test_gone.py",
			"+++ /dev/null",
		].join("\n");
		expect(listGradedTestFiles(deletion)).toEqual(["tests/test_gone.py"]);
	});

	it("flags an agent that edited the tests INSTEAD of fixing the code", () => {
		// The live 2026-08-08 shape: only the graded test file changed, no library code at all.
		const result = detectGradedTestTampering({
			testPatch: TEST_PATCH,
			changedFiles: ["tests/test_blueprints.py"],
		});
		expect(result.tampered).toBe(true);
		expect(result.modifiedGradedFiles).toEqual(["tests/test_blueprints.py"]);
		// The empty "other" list is what distinguishes "edited tests instead of fixing" from "fixed and also
		// touched a test" — the two deserve different reads, so the detector must not collapse them.
		expect(result.otherChangedFiles).toEqual([]);
	});

	it("stays quiet when the agent changed only library code", () => {
		const result = detectGradedTestTampering({
			testPatch: TEST_PATCH,
			changedFiles: ["src/flask/blueprints.py", "src/flask/app.py"],
		});
		expect(result.tampered).toBe(false);
		expect(result.modifiedGradedFiles).toEqual([]);
		expect(result.otherChangedFiles).toEqual(["src/flask/app.py", "src/flask/blueprints.py"]);
	});

	it("reports both when the agent fixed the code AND touched a graded test", () => {
		const result = detectGradedTestTampering({
			testPatch: TEST_PATCH,
			changedFiles: ["src/flask/blueprints.py", "tests/test_helpers.py"],
		});
		expect(result.tampered).toBe(true);
		expect(result.modifiedGradedFiles).toEqual(["tests/test_helpers.py"]);
		expect(result.otherChangedFiles).toEqual(["src/flask/blueprints.py"]);
	});
});
