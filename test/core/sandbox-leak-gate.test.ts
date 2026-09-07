import { describe, expect, it } from "vitest";
import { decideSandboxLeak } from "../../src/core/sandbox-leak-gate";

// A condensed replay of the v31 s03-prng-tree delivery (commit cac0249): every hack the sandbox leak produced.
const LEAKY_DIFF = [
	"diff --git a/vitest_node_modules b/vitest_node_modules",
	"new file mode 120000",
	"index 0000000..1111111",
	"--- /dev/null",
	"+++ b/vitest_node_modules",
	"@@ -0,0 +1 @@",
	"+/opt/nklein/node_modules",
	"\\ No newline at end of file",
	"diff --git a/_run_test.js b/_run_test.js",
	"new file mode 100644",
	"--- /dev/null",
	"+++ b/_run_test.js",
	"@@ -0,0 +1,3 @@",
	"+import { execSync } from 'child_process';",
	"+const out = execSync('/opt/nklein/node_modules/.bin/vitest run test/kernel/prng.test.ts');",
	"+console.log(out);",
	"diff --git a/package.json b/package.json",
	"--- a/package.json",
	"+++ b/package.json",
	"@@ -1,5 +1,9 @@",
	' "scripts": {',
	'-    "test": "vitest run",',
	'+    "test": "node vitest_node_modules/vitest/vitest.mjs run",',
	'+    "typecheck": "tsc --noEmit || /usr/local/bin/tsc --noEmit"',
	" },",
	'+  "repository": { "type": "git", "url": "/repos/688e91180e56" },',
	"diff --git a/install.out b/install.out",
	"new file mode 100644",
	"--- /dev/null",
	"+++ b/install.out",
	"@@ -0,0 +1,2 @@",
	"+npm error code EAI_AGAIN",
	"+npm error A complete log of this run can be found in: /tmp/nklein-home-77142-s07/.npm/_logs/x.log",
].join("\n");

describe("decideSandboxLeak (P0.SANDBOXLEAK)", () => {
	it("bounces the v31 workaround delivery and names every leak with its evidence", () => {
		const decision = decideSandboxLeak(LEAKY_DIFF);
		expect(decision.verdict).toBe("bounce");
		const kinds = decision.findings.map((finding) => `${finding.path}:${finding.kind}`);
		expect(kinds).toEqual(
			expect.arrayContaining([
				"vitest_node_modules:symlink_outside_repo",
				"_run_test.js:sandbox_path",
				"package.json:absolute_toolchain_path",
				"package.json:sandbox_path",
				"install.out:install_log",
				"install.out:sandbox_path",
			]),
		);
		expect(decision.feedback).toContain("vitest_node_modules (symlink into the sandbox image)");
		expect(decision.feedback).toContain("`vitest run`");
		expect(decision.feedback).toContain("dependencies installed before your first turn");
	});

	it("passes ordinary work, relative symlinks, and text that merely mentions /usr/bin outside a manifest", () => {
		const clean = [
			"diff --git a/src/kernel/prng.ts b/src/kernel/prng.ts",
			"--- a/src/kernel/prng.ts",
			"+++ b/src/kernel/prng.ts",
			"@@ -1,2 +1,3 @@",
			"+export const seed = 1; // not /usr/bin/anything",
			"diff --git a/docs/link b/docs/link",
			"new file mode 120000",
			"--- /dev/null",
			"+++ b/docs/link",
			"@@ -0,0 +1 @@",
			"+../README.md",
			"diff --git a/test/fixtures/npm.txt b/test/fixtures/npm.txt",
			"--- a/test/fixtures/npm.txt",
			"+++ b/test/fixtures/npm.txt",
			"@@ -1 +1,2 @@",
			"+npm error a fixture line in an EXISTING file is not an install log",
		].join("\n");
		expect(decideSandboxLeak(clean)).toMatchObject({ verdict: "pass", findings: [] });
		expect(decideSandboxLeak(null).verdict).toBe("pass");
		expect(decideSandboxLeak("").verdict).toBe("pass");
	});

	it("flags a manifest script bound to an absolute binary even without sandbox-specific paths", () => {
		const diff = [
			"diff --git a/package.json b/package.json",
			"--- a/package.json",
			"+++ b/package.json",
			"@@ -1 +1 @@",
			'+    "lint": "/usr/local/bin/eslint ."',
		].join("\n");
		const decision = decideSandboxLeak(diff);
		expect(decision.verdict).toBe("bounce");
		expect(decision.findings).toEqual([
			{ path: "package.json", kind: "absolute_toolchain_path", evidence: '"lint": "/usr/local/bin/eslint ."' },
		]);
	});
});
