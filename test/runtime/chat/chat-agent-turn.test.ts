import { describe, expect, it } from "vitest";
import type { ChatAgentModelResponse } from "../../../src/chat/chat-agent-loop";
import { runChatAgentConversation, runChatAgentTurn } from "../../../src/chat/chat-agent-turn";
import { appendChatToolExchange } from "../../../src/chat/chat-local-llm-adapter";
import type { ChatSession } from "../../../src/chat/chat-session-store";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";

function session(): ChatSession {
	return {
		schemaVersion: 1,
		id: "s1",
		title: "t",
		scope: "project_sandboxed",
		role: "planner_architect",
		goal: null,
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("runChatAgentTurn", () => {
	it("drives the agent loop (tool call → execute → final answer) and persists the turn", async () => {
		const appended: Array<{ role: string; content: string }> = [];
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "The README documents the project.", toolCalls: [] },
		];
		let turn = 0;
		const executed: string[] = [];

		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "what's in the readme?", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) => {
					appended.push({ role: input.role, content: input.content });
					return {
						schemaVersion: 1,
						id: `m${appended.length}`,
						role: input.role,
						content: input.content,
						createdAt: 0,
					};
				},
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => {
					executed.push(call.name);
					return { callId: call.id, content: "# Project" };
				},
				appendToolExchange: appendChatToolExchange,
			},
		);

		expect(executed).toEqual(["read_file"]);
		expect(result.steps).toHaveLength(1);
		expect(result.assistantMessage.content).toBe("The README documents the project.");
		expect(appended.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect((appended[1] as { content: string }).content).toBe("The README documents the project.");
		expect(result.hitIterationLimit).toBe(false);
	});

	it("persists a direct answer when the model uses no tools", async () => {
		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "hi", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => ({ text: "hello there", toolCalls: [] }),
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(result.steps).toEqual([]);
		expect(result.assistantMessage.content).toBe("hello there");
	});

	it("cleans a narrated tool call from the final reply, confirming the action instead (§5.O)", async () => {
		// Weak model: first turn calls the tool, then narrates another call as its final text (gemma-4-e2b live).
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "greet.js", content: "x" } }] },
			{ text: "<|tool_call>call:write_file\nfile_name: greet.js", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "create greet.js", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "wrote 1 byte" }),
				appendToolExchange: appendChatToolExchange,
			},
		);
		// The raw `<|tool_call>…` markup never reaches the user; a brief confirmation replaces the all-narration reply.
		expect(result.assistantMessage.content).not.toContain("tool_call");
		expect(result.assistantMessage.content).toBe("Done. (used: write_file)");
	});
});

describe("runChatAgentConversation", () => {
	it("runs a tool-using turn per line, surfaces tools used, and stops at /exit", async () => {
		const lines = ["read the readme", "", "/exit", "never reached"];
		let cursor = 0;
		const output: string[] = [];
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "It documents the project.", toolCalls: [] },
		];
		let turn = 0;

		const taken = await runChatAgentConversation(
			{ session: session(), tokenBudget: 1000 },
			{
				readLine: async () => lines[cursor++] ?? null,
				write: (text) => output.push(text),
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "# Project" }),
				appendToolExchange: appendChatToolExchange,
			},
		);

		expect(taken).toBe(1);
		expect(output).toEqual(["  (used: read_file)\n", "It documents the project.\n"]);
	});
});
