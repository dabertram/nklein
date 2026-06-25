import { describe, expect, it } from "vitest";
import type { ChatMemory } from "../../../src/chat/chat-memory-store";
import { runChatConversation, runChatTurn } from "../../../src/chat/chat-runtime";
import type { ChatSession } from "../../../src/chat/chat-session-store";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";

function session(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		schemaVersion: 1,
		id: "s1",
		title: "t",
		scope: "project_sandboxed",
		role: "planner_architect",
		goal: null,
		riskAcknowledged: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function memory(id: string, text: string): ChatMemory {
	return { schemaVersion: 1, id, sessionId: "s1", shared: false, text, embedding: null, createdAt: 0 };
}

const appendMessageStub = async (_sessionId: string, input: { role: ChatMessage["role"]; content: string }) => ({
	schemaVersion: 1 as const,
	id: `m-${input.role}`,
	role: input.role,
	content: input.content,
	createdAt: 0,
});

describe("runChatTurn", () => {
	it("composes context, calls the model, and persists user + assistant messages in order", async () => {
		const appended: Array<{ role: string; content: string }> = [];
		let receivedPrompt: ChatPromptMessage[] = [];
		const result = await runChatTurn(
			{ session: session({ goal: "Ship the feature" }), userMessage: "what next?", tokenBudget: 1000 },
			{
				readTranscript: async () => [
					{ schemaVersion: 1, id: "p1", role: "user", content: "earlier q", createdAt: 1 },
					{ schemaVersion: 1, id: "p2", role: "assistant", content: "earlier a", createdAt: 2 },
				],
				readMemories: async () => [],
				appendMessage: async (sessionId, input) => {
					appended.push({ role: input.role, content: input.content });
					return appendMessageStub(sessionId, input);
				},
				complete: async (prompt) => {
					receivedPrompt = prompt;
					return "do step two";
				},
				summarize: async () => "summary",
				estimateTokens: (text) => text.length,
			},
		);

		expect(result.userMessage.content).toBe("what next?");
		expect(result.assistantMessage.content).toBe("do step two");
		expect(appended.map((m) => m.role)).toEqual(["user", "assistant"]);
		// The goal leads the prompt and the new message is last.
		expect(receivedPrompt[0]?.content).toContain("Ship the feature");
		expect(receivedPrompt.at(-1)).toEqual({ role: "user", content: "what next?" });
	});

	it("feeds query-matching recalled memories into the prompt (lexical fallback)", async () => {
		let receivedPrompt: ChatPromptMessage[] = [];
		await runChatTurn(
			{ session: session(), userMessage: "tabs or spaces?", tokenBudget: 1000, memoryLimit: 5 },
			{
				readTranscript: async () => [],
				readMemories: async () => [memory("hit", "the user prefers tabs"), memory("miss", "weather is nice")],
				appendMessage: appendMessageStub,
				complete: async (prompt) => {
					receivedPrompt = prompt;
					return "tabs";
				},
				summarize: async () => "",
				estimateTokens: (text) => text.length,
			},
		);
		const memoryNote = receivedPrompt.find((m) => m.role === "system" && m.content.includes("remembered"));
		expect(memoryNote?.content).toContain("prefers tabs");
		expect(memoryNote?.content).not.toContain("weather");
	});

	it("runs an interactive conversation: skips blanks, stops on /exit, replies each turn", async () => {
		const lines = ["first question", "", "/exit", "never reached"];
		let index = 0;
		const written: string[] = [];
		const transcript: ChatMessage[] = [];
		const turns = await runChatConversation(
			{ session: session(), tokenBudget: 1000 },
			{
				readLine: async () => (index < lines.length ? (lines[index++] ?? null) : null),
				write: (text) => written.push(text),
				readTranscript: async () => transcript,
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) => {
					const message = appendMessageStub(_sessionId, input);
					transcript.push(await message);
					return message;
				},
				complete: async () => "a reply",
				summarize: async () => "",
				estimateTokens: (text) => text.length,
			},
		);
		expect(turns).toBe(1);
		expect(written).toEqual(["a reply\n"]);
	});
});
