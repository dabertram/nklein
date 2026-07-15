import { describe, expect, it } from "vitest";
import type { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";
import {
	AGENT_SANDBOX_EXTRA_TOOL_RUNNER,
	createAgentSandboxExtraTools,
} from "../../../src/nklein-agent/nklein-agent-sandbox-extra-tools";

interface RunToolCall {
	taskId: string;
	runner: string;
	payload: { toolName: string; input: unknown; sessionId: string; contextWindow: unknown; maxFileLines: unknown };
}

function fakeManager(resultFor: string) {
	const calls: RunToolCall[] = [];
	const manager = {
		runTool: async (taskId: string, runner: string, payload: RunToolCall["payload"]) => {
			calls.push({ taskId, runner, payload });
			return resultFor;
		},
	} as unknown as AgentSandboxManager;
	return { manager, calls };
}

describe("createAgentSandboxExtraTools", () => {
	it("proxies a tool's execute through the sandbox manager with the extra-tool envelope", async () => {
		const { manager, calls } = fakeManager('{"ok":true}');
		const tools = createAgentSandboxExtraTools(manager, "task-1", {
			sessionId: "s1",
			contextWindow: 32768,
			maxFileLines: 500,
		});
		expect(tools.length).toBeGreaterThan(0);

		const result = await tools[0]?.execute({ foo: "bar" }, {} as never);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.runner).toBe(AGENT_SANDBOX_EXTRA_TOOL_RUNNER);
		expect(calls[0]?.taskId).toBe("task-1");
		expect(calls[0]?.payload).toMatchObject({
			toolName: tools[0]?.name,
			input: { foo: "bar" },
			sessionId: "s1",
			contextWindow: 32768,
			maxFileLines: 500,
		});
		expect(result).toEqual({ ok: true }); // JSON result is parsed
	});

	it("returns a raw string when the sandbox result is not JSON", async () => {
		const { manager } = fakeManager("plain text result");
		const tools = createAgentSandboxExtraTools(manager, "task-2", { sessionId: "s2" });
		expect(await tools[0]?.execute({}, {} as never)).toBe("plain text result");
	});
});
