import { describe, expect, it } from "vitest";

import { AgentSandboxExecutionError } from "../../../src/nklein-agent/nklein-agent-sandbox";
import {
	formatStartWarnings,
	isBenignSandboxPatchStagingTeardown,
	resolveNKleinTaskRole,
	toErrorMessage,
} from "../../../src/nklein-agent/nklein-task-session-helpers";

describe("resolveNKleinTaskRole", () => {
	it("maps a ::review task to reviewer regardless of the decomposition flag", () => {
		expect(resolveNKleinTaskRole("task-1::review", false)).toBe("reviewer");
		expect(resolveNKleinTaskRole("task-1::review", true)).toBe("reviewer");
	});

	it("maps a decomposition to architect and everything else to worker", () => {
		expect(resolveNKleinTaskRole("task-1", true)).toBe("architect");
		expect(resolveNKleinTaskRole("task-1", false)).toBe("worker");
	});
});

describe("toErrorMessage", () => {
	it("reads the message from an Error or a message-bearing object, else falls back to 'Unknown error'", () => {
		expect(toErrorMessage(new Error("boom"))).toBe("boom");
		expect(toErrorMessage({ message: "from object" })).toBe("from object");
		expect(toErrorMessage("plain string")).toBe("Unknown error");
		expect(toErrorMessage(undefined)).toBe("Unknown error");
		expect(toErrorMessage({})).toBe("Unknown error");
	});
});

describe("isBenignSandboxPatchStagingTeardown", () => {
	const stagingError = (stderr: string, stdout = "") =>
		new AgentSandboxExecutionError("Could not stage sandbox workspace changes.", { exitCode: 1, stdout, stderr });

	it("is false for non-sandbox errors", () => {
		expect(isBenignSandboxPatchStagingTeardown(new Error("nope"))).toBe(false);
		expect(isBenignSandboxPatchStagingTeardown("string")).toBe(false);
	});

	it("is false when the sandbox error is not the patch-staging failure", () => {
		const other = new AgentSandboxExecutionError("Something else", {
			exitCode: 1,
			stdout: "",
			stderr: "not a git repository",
		});
		expect(isBenignSandboxPatchStagingTeardown(other)).toBe(false);
	});

	it("is true when staging failed because the cwd vanished mid-stage (teardown race)", () => {
		expect(isBenignSandboxPatchStagingTeardown(stagingError("fatal: not a git repository"))).toBe(true);
		expect(isBenignSandboxPatchStagingTeardown(stagingError("", "chdir to cwd failed"))).toBe(true);
		expect(isBenignSandboxPatchStagingTeardown(stagingError("No such file or directory"))).toBe(true);
		expect(isBenignSandboxPatchStagingTeardown(stagingError("unable to get current working directory"))).toBe(true);
	});

	it("is false when staging failed for an unrelated reason", () => {
		expect(isBenignSandboxPatchStagingTeardown(stagingError("permission denied"))).toBe(false);
	});
});

describe("formatStartWarnings", () => {
	it("returns null for absent, empty, or blank-only warnings", () => {
		expect(formatStartWarnings(undefined)).toBeNull();
		expect(formatStartWarnings([])).toBeNull();
		expect(formatStartWarnings(["   ", ""])).toBeNull();
	});

	it("returns a single warning verbatim", () => {
		expect(formatStartWarnings(["mcp server X failed"])).toBe("mcp server X failed");
	});

	it("collapses multiple warnings into a count line (singular vs plural)", () => {
		expect(formatStartWarnings(["a", "b"])).toBe("a (+1 more MCP warning)");
		expect(formatStartWarnings(["a", "b", "c"])).toBe("a (+2 more MCP warnings)");
	});
});
