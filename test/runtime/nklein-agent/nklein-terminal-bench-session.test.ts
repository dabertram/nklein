import { describe, expect, it, vi } from "vitest";
import type {
	NKleinSessionRuntime,
	StartNKleinSessionRuntimeRequest,
} from "../../../src/nklein-agent/nklein-session-runtime-types";
import { runTerminalBenchSession } from "../../../src/nklein-agent/nklein-terminal-bench-session";

const config = {
	taskId: "tb-session",
	instruction: "Fix the task environment.",
	providerId: "lmstudio",
	modelId: "local/model",
	baseUrl: "http://127.0.0.1:1234/v1",
	contextWindow: 32_768,
	maxTokensPerTurn: 4_096,
	workingDirectory: "/root",
};

describe("!Klein Terminal-Bench native session", () => {
	it("exposes only Harbor exec and submit tools, then disposes the runtime", async () => {
		let request: StartNKleinSessionRuntimeRequest | undefined;
		const dispose = vi.fn(async () => undefined);
		const exec = vi.fn(async () => ({ returnCode: 0, stdout: "/root\n", stderr: "" }));
		const runtime = {
			async startTaskSession(input: StartNKleinSessionRuntimeRequest) {
				request = input;
				const execTool = input.extraTools?.find((tool) => tool.name === "terminal_exec");
				const submitTool = input.extraTools?.find((tool) => tool.name === "terminal_submit");
				expect(await execTool?.execute({ command: "pwd" }, {} as never)).toContain("exit_code: 0");
				expect(await submitTool?.execute({ summary: "Repaired and checked." }, {} as never)).toContain(
					"independent verification",
				);
				return { sessionId: "sdk-session", result: { done: true }, warnings: ["one warning"] };
			},
			dispose,
		} as unknown as NKleinSessionRuntime;

		const result = await runTerminalBenchSession(config, { exec }, { createRuntime: () => runtime });

		expect(request?.toolPolicies).toEqual({
			"*": { enabled: false },
			terminal_exec: { enabled: true, autoApprove: true },
			terminal_submit: { enabled: true, autoApprove: true },
		});
		expect(request?.extraTools?.map((tool) => tool.name)).toEqual(["terminal_exec", "terminal_submit"]);
		expect(exec).toHaveBeenCalledWith({ command: "pwd", cwd: "/root", timeoutSeconds: 300 });
		expect(result).toEqual({
			sessionId: "sdk-session",
			result: { done: true },
			submittedSummary: "Repaired and checked.",
			warnings: ["one warning"],
		});
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("rejects non-local model endpoints before starting the runtime", async () => {
		const startTaskSession = vi.fn();
		const dispose = vi.fn(async () => undefined);
		const runtime = { startTaskSession, dispose } as unknown as NKleinSessionRuntime;
		await expect(
			runTerminalBenchSession(
				{ ...config, baseUrl: "https://api.example.com/v1" },
				{ exec: vi.fn() },
				{
					createRuntime: () => runtime,
				},
			),
		).rejects.toThrow(/private LAN/);
		expect(startTaskSession).not.toHaveBeenCalled();
		expect(dispose).not.toHaveBeenCalled();
	});
});
