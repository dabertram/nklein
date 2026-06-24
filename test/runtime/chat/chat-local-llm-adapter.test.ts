import { describe, expect, it } from "vitest";
import type { ChatAgentModelResponse } from "../../../src/chat/chat-agent-loop";
import {
	appendChatToolExchange,
	type ChatAgentCompletionClient,
	type ChatCompletionClient,
	createChatAgentModel,
	createChatModelDeps,
} from "../../../src/chat/chat-local-llm-adapter";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";
import type { LocalLlmChatMessage, LocalLlmToolDefinition } from "../../../src/nklein-sdk/nklein-local-llm-client";

function fakeClient(reply: string): { client: ChatCompletionClient; calls: LocalLlmChatMessage[][] } {
	const calls: LocalLlmChatMessage[][] = [];
	const client: ChatCompletionClient = {
		complete: async (request) => {
			calls.push(request.messages);
			return { content: reply, finishReason: "stop", raw: {} };
		},
	};
	return { client, calls };
}

describe("createChatModelDeps", () => {
	it("maps the rendered prompt to the client and strips inline reasoning from the reply", async () => {
		const { client, calls } = fakeClient("<think>hmm let me consider</think>The answer is 42.");
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([
			{ role: "system", content: "be helpful" },
			{ role: "user", content: "what is the answer?" },
		]);
		expect(reply).toBe("The answer is 42.");
		expect(calls[0]).toEqual([
			{ role: "system", content: "be helpful" },
			{ role: "user", content: "what is the answer?" },
		]);
	});

	it("streams via completeStream when an onToken is provided, returning the stripped reply", async () => {
		const tokens: string[] = [];
		const client: ChatCompletionClient = {
			complete: async () => {
				throw new Error("should stream, not call complete");
			},
			completeStream: async (_request, onChunk) => {
				onChunk("<think>x</think>");
				onChunk("Hello");
				onChunk(" world");
				return { content: "<think>x</think>Hello world", finishReason: "stop", raw: {} };
			},
		};
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([{ role: "user", content: "hi" }], (delta) => tokens.push(delta));
		expect(tokens).toEqual(["<think>x</think>", "Hello", " world"]);
		expect(reply).toBe("Hello world");
	});

	it("falls back to non-streaming complete when no onToken is given", async () => {
		const { client, calls } = fakeClient("plain reply");
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([{ role: "user", content: "hi" }]);
		expect(reply).toBe("plain reply");
		expect(calls).toHaveLength(1);
	});

	it("summarizes the overflow via a system+user prompt", async () => {
		const { client, calls } = fakeClient("Summary: discussed the merge.");
		const deps = createChatModelDeps(client);
		const overflow: ChatMessage[] = [
			{ schemaVersion: 1, id: "1", role: "user", content: "about the merge", createdAt: 1 },
			{ schemaVersion: 1, id: "2", role: "assistant", content: "ok", createdAt: 2 },
		];
		const summary = await deps.summarize(overflow);
		expect(summary).toBe("Summary: discussed the merge.");
		expect(calls[0]?.[0]?.role).toBe("system");
		expect(calls[0]?.[1]?.content).toContain("user: about the merge");
		expect(calls[0]?.[1]?.content).toContain("assistant: ok");
	});
});

describe("createChatAgentModel + appendChatToolExchange", () => {
	function toolClient(): { client: ChatAgentCompletionClient; toolsOffered: number[] } {
		const toolsOffered: number[] = [];
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (_request, tools) => {
				toolsOffered.push(tools.length);
				return {
					content: "<think>plan</think>done",
					toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		return { client, toolsOffered };
	}

	const tools: LocalLlmToolDefinition[] = [{ name: "read_file", description: "read", parameters: { type: "object" } }];

	it("offers tools only when allowTools is set and strips reasoning from the text", async () => {
		const { client, toolsOffered } = toolClient();
		const model = createChatAgentModel(client, tools);
		const withTools = await model([{ role: "user", content: "go" }], true);
		expect(withTools.text).toBe("done");
		expect(withTools.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: { path: "a" } }]);
		await model([{ role: "user", content: "go" }], false);
		expect(toolsOffered).toEqual([1, 0]);
	});

	it("folds assistant text + tool results back as system notes", () => {
		const base: ChatPromptMessage[] = [{ role: "user", content: "go" }];
		const response: ChatAgentModelResponse = { text: "let me check", toolCalls: [] };
		const folded = appendChatToolExchange(base, response, [{ callId: "c1", content: "file body" }]);
		expect(folded).toEqual([
			{ role: "user", content: "go" },
			{ role: "assistant", content: "let me check" },
			{ role: "system", content: "Tool result (c1):\nfile body" },
		]);
		// No assistant note when the turn produced no text.
		const noText = appendChatToolExchange(base, { text: "", toolCalls: [] }, [{ callId: "c2", content: "x" }]);
		expect(noText.map((m) => m.role)).toEqual(["user", "system"]);
	});
});
