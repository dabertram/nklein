import { describe, expect, it } from "vitest";
import { type ChatAgentModelResponse, type ChatToolCall, runChatAgentLoop } from "../../../src/chat/chat-agent-loop";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";

const start: ChatPromptMessage[] = [{ role: "user", content: "what's in README?" }];

// A simple fold: append a system note recording each tool result, so the next turn "sees" them.
const appendToolExchange = (
	messages: readonly ChatPromptMessage[],
	_response: ChatAgentModelResponse,
	results: readonly { callId: string; content: string }[],
): ChatPromptMessage[] => [
	...messages,
	...results.map((result) => ({ role: "system" as const, content: `tool ${result.callId}: ${result.content}` })),
];

describe("runChatAgentLoop", () => {
	it("executes tool calls then returns the model's final answer", async () => {
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "The README explains the project.", toolCalls: [] },
		];
		const executed: ChatToolCall[] = [];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => {
					executed.push(call);
					return { callId: call.id, content: "# Project" };
				},
				appendToolExchange,
			},
		);
		expect(executed.map((c) => c.name)).toEqual(["read_file"]);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.result.content).toBe("# Project");
		expect(result.finalText).toBe("The README explains the project.");
		expect(result.hitIterationLimit).toBe(false);
	});

	it("returns immediately when the first response has no tool calls", async () => {
		let calls = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => {
					calls++;
					return { text: "Direct answer.", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("should not execute tools");
				},
				appendToolExchange,
			},
		);
		expect(result.finalText).toBe("Direct answer.");
		expect(result.steps).toEqual([]);
		expect(calls).toBe(1);
	});

	it("forces a final answer (tools disabled) when it hits the iteration limit", async () => {
		const allowTools: boolean[] = [];
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 2 },
			{
				complete: async (_messages, allow) => {
					allowTools.push(allow);
					// Always asks for a tool while allowed; the final forced turn (allow=false) concludes.
					return allow
						? { text: "", toolCalls: [{ id: `c${allowTools.length}`, name: "loop", arguments: {} }] }
						: { text: "Best effort answer.", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "ok" }),
				appendToolExchange,
			},
		);
		expect(allowTools).toEqual([true, true, false]);
		expect(result.steps).toHaveLength(2);
		expect(result.finalText).toBe("Best effort answer.");
		expect(result.hitIterationLimit).toBe(true);
	});
});
