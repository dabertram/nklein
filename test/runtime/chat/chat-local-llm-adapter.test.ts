import { describe, expect, it } from "vitest";
import { type ChatCompletionClient, createChatModelDeps } from "../../../src/chat/chat-local-llm-adapter";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";
import type { LocalLlmChatMessage } from "../../../src/nklein-sdk/nklein-local-llm-client";

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
