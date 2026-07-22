import { MAX_COMMAND_OUTPUT_CHARS } from "@cline/sdk";
import { describe, expect, it } from "vitest";
import { formatToolRunnerThrown } from "../../../src/nklein-agent/agent-sandbox/tool-runner-error";

describe("formatToolRunnerThrown", () => {
	it("preserves the shell executor output carried separately from its generic exit message", () => {
		const error = Object.assign(new Error("Command exited with code 1"), {
			output: "FAIL src/example.test.ts\nExpected: 2\nReceived: 1",
		});

		expect(formatToolRunnerThrown(error)).toBe(
			"Command exited with code 1\nFAIL src/example.test.ts\nExpected: 2\nReceived: 1",
		);
	});

	it("retains compatible stderr and stdout fields without duplicating identical output", () => {
		const error = Object.assign(new Error("process failed"), {
			output: "compiler diagnostic",
			stderr: Buffer.from("compiler diagnostic"),
			stdout: "test summary",
		});

		expect(formatToolRunnerThrown(error)).toBe("process failed\ncompiler diagnostic\ntest summary");
	});

	it("bounds output from executors that do not enforce the SDK command-output limit", () => {
		const rendered = formatToolRunnerThrown(
			Object.assign(new Error("failed"), { output: `HEAD-${"x".repeat(MAX_COMMAND_OUTPUT_CHARS * 2)}-TAIL` }),
		);

		expect(rendered.length).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_CHARS);
		expect(rendered).toContain("HEAD-");
		expect(rendered).toContain("-TAIL");
		expect(rendered).toContain("truncated");
	});
});
