import { describe, expect, it } from "vitest";
import {
	type AcceptanceFailureCategory,
	classifyAcceptanceFailure,
} from "../../../src/core/acceptance-failure-taxonomy";

function categoryOf(output: string, exitCode: number | null = 1, timedOut = false): AcceptanceFailureCategory {
	return classifyAcceptanceFailure({ output, exitCode, timedOut }).category;
}

describe("classifyAcceptanceFailure", () => {
	it("classifies a timeout", () => {
		expect(categoryOf("", null, true)).toBe("timeout");
		expect(categoryOf("Command timed out after 300s")).toBe("timeout");
	});

	it("classifies command-not-found (incl. exit 127)", () => {
		expect(categoryOf("bash: pytest: command not found", 127)).toBe("command_not_found");
		expect(categoryOf("anything", 127)).toBe("command_not_found");
	});

	it("classifies stale sandbox working-directory failures before generic command failures", () => {
		expect(categoryOf("sh: 1: cd: can't cd to /workspaces/dev-old-task", 2)).toBe("acceptance_setup_error");
		expect(categoryOf("chdir to cwd /workspaces/task-1 failed: no such file or directory", null)).toBe(
			"acceptance_setup_error",
		);
	});

	it("classifies a missing script", () => {
		expect(categoryOf('npm error Missing script: "test"')).toBe("missing_script");
		expect(categoryOf("Lifecycle script `test` ... no test specified")).toBe("missing_script");
	});

	it("classifies a missing dependency", () => {
		expect(categoryOf("Error: Cannot find module 'vitest'")).toBe("dependency_missing");
		expect(categoryOf("ModuleNotFoundError: No module named 'numpy'")).toBe("dependency_missing");
	});

	it("classifies a type error", () => {
		expect(categoryOf("src/x.ts(10,5): error TS2322: Type 'string' is not assignable")).toBe("type_error");
	});

	it("classifies a lint error", () => {
		expect(categoryOf("biome check failed: 3 errors")).toBe("lint_error");
		expect(categoryOf("eslint found 2 problems")).toBe("lint_error");
	});

	it("classifies a compile/syntax error", () => {
		expect(categoryOf("SyntaxError: Unexpected token )")).toBe("compile_error");
	});

	it("classifies test failures", () => {
		expect(categoryOf("Tests: 2 failed, 5 passed")).toBe("test_failure");
		expect(categoryOf("AssertionError: expected 1 to equal 2")).toBe("test_failure");
	});

	it("returns unknown for unrecognized output", () => {
		const result = classifyAcceptanceFailure({ output: "weird opaque output", exitCode: 1 });
		expect(result.category).toBe("unknown");
		expect(result.label).toBeTruthy();
		expect(result.hint).toBeTruthy();
	});

	it("prefers the more specific timeout over a generic failure", () => {
		// A timeout that also printed test scaffolding should still classify as timeout.
		expect(categoryOf("running tests...\nCommand timed out", null, true)).toBe("timeout");
	});

	it("always returns a label and a hint", () => {
		const result = classifyAcceptanceFailure({ output: "Cannot find module 'x'", exitCode: 1 });
		expect(result.label).toBe("Missing dependency");
		expect(result.hint.length).toBeGreaterThan(0);
	});
});
