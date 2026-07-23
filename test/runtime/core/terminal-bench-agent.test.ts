import { describe, expect, it } from "vitest";
import {
	buildTerminalBenchAgentSystemPrompt,
	formatTerminalBenchExecResult,
	parseTerminalBenchAgentConfig,
	parseTerminalBenchExecRequest,
} from "../../../src/core/terminal-bench-agent";

describe("Terminal-Bench agent boundary", () => {
	it("accepts only a local-run-sized configuration with an explicit 32k context floor", () => {
		const config = parseTerminalBenchAgentConfig({
			taskId: "tb-task",
			instruction: "Repair the environment.",
			providerId: "lmstudio",
			modelId: "local/model",
			baseUrl: "http://127.0.0.1:1234/v1",
			contextWindow: 32_768,
			maxTokensPerTurn: 4_096,
			workingDirectory: "/root",
		});
		expect(config.contextWindow).toBe(32_768);
		expect(() => parseTerminalBenchAgentConfig({ ...config, contextWindow: 32_767 })).toThrow(/at least 32768/);
		expect(() => parseTerminalBenchAgentConfig({ ...config, workingDirectory: "relative" })).toThrow(/absolute/);
	});

	it("bounds mutable exec requests and renders complete process evidence", () => {
		expect(parseTerminalBenchExecRequest({ command: "pwd", cwd: "/root", timeoutSeconds: 30 })).toEqual({
			command: "pwd",
			cwd: "/root",
			timeoutSeconds: 30,
		});
		expect(() => parseTerminalBenchExecRequest({ command: "pwd", timeoutSeconds: 1_801 })).toThrow(/cannot exceed/);
		expect(formatTerminalBenchExecResult({ returnCode: 7, stdout: "out", stderr: "err" })).toContain(
			"exit_code: 7\nstdout:\nout\nstderr:\nerr",
		);
	});

	it("states the Harbor authority boundary without claiming verifier access", () => {
		const prompt = buildTerminalBenchAgentSystemPrompt("/root");
		expect(prompt).toContain("Harbor—not you and not !Klein—owns");
		expect(prompt).toContain("hidden verifier");
		expect(prompt).toContain("does not certify correctness");
	});
});
