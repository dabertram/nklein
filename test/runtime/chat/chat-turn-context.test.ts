import { describe, expect, it } from "vitest";
import type { ChatMemory, ChatMemoryRecall } from "../../../src/chat/chat-memory-store";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";
import { composeChatTurnContext, renderChatTurnPrompt } from "../../../src/chat/chat-turn-context";

function message(id: string, content: string): ChatMessage {
	return { schemaVersion: 1, id, role: "user", content, createdAt: Number(id) };
}
function memory(id: string, text: string, overrides: Partial<ChatMemory> = {}): ChatMemory {
	return { schemaVersion: 1, id, sessionId: "s1", shared: false, text, embedding: null, createdAt: 0, ...overrides };
}

const estimateTokens = (text: string) => text.length;

describe("composeChatTurnContext", () => {
	it("keeps the recent window, summarizes overflow, and recalls associated memories", async () => {
		const transcript = [message("1", "aaaa"), message("2", "bbbb"), message("3", "cccc")];
		const memories = [memory("hit", "how to resolve a merge conflict"), memory("miss", "favorite lunch spots")];
		const summarizeCalls: number[] = [];

		const context = await composeChatTurnContext(
			{
				sessionId: "s1",
				query: "merge conflict",
				goal: "Resolve the board merge conflicts",
				transcript,
				memories,
				tokenBudget: 8,
				estimateTokens,
			},
			{
				summarize: async (overflow) => {
					summarizeCalls.push(overflow.length);
					return `summary(${overflow.length})`;
				},
			},
		);

		expect(context.recentMessages.map((m) => m.id)).toEqual(["2", "3"]);
		expect(context.summary).toBe("summary(1)");
		expect(context.goal).toBe("Resolve the board merge conflicts");
		expect(summarizeCalls).toEqual([1]);
		expect(context.recalledMemories.map((m) => m.id)).toEqual(["hit"]);
	});

	it("skips summarization when nothing overflows and respects the memory limit", async () => {
		const transcript = [message("1", "ab"), message("2", "cd")];
		const memories = [
			memory("m1", "merge conflict one"),
			memory("m2", "merge conflict two"),
			memory("m3", "merge conflict three"),
		];
		const context = await composeChatTurnContext(
			{
				sessionId: "s1",
				query: "merge conflict",
				transcript,
				memories,
				tokenBudget: 100,
				estimateTokens,
				memoryLimit: 2,
			},
			{
				summarize: async () => {
					throw new Error("should not summarize when nothing overflows");
				},
			},
		);
		expect(context.summary).toBeNull();
		expect(context.recentMessages.map((m) => m.id)).toEqual(["1", "2"]);
		expect(context.recalledMemories).toHaveLength(2);
	});

	it("ranks recall by embedding similarity when an embedder is supplied", async () => {
		const transcript = [message("1", "hello")];
		const memories = [memory("near", "near", { embedding: [1, 0] }), memory("far", "far", { embedding: [0, 1] })];
		const context = await composeChatTurnContext(
			{ sessionId: "s1", query: "q", transcript, memories, tokenBudget: 100, estimateTokens, memoryLimit: 1 },
			{ embed: async () => [1, 0], summarize: async () => "" },
		);
		expect(context.recalledMemories.map((m) => m.id)).toEqual(["near"]);
	});

	it("renders the context into ordered model messages (goal + summary + memories + recent + new)", () => {
		const recalled: ChatMemoryRecall[] = [
			{
				schemaVersion: 1,
				id: "m",
				sessionId: "s1",
				shared: false,
				text: "uses zustand",
				embedding: null,
				createdAt: 0,
				score: 1,
			},
		];
		const prompt = renderChatTurnPrompt(
			{
				goal: "Ship it",
				summary: "talked about the board",
				recalledMemories: recalled,
				recentMessages: [message("1", "last user line")],
			},
			"the new question",
		);
		expect(prompt.map((m) => m.role)).toEqual(["system", "system", "system", "user", "user"]);
		expect(prompt[0]?.content).toContain("Ship it");
		expect(prompt[1]?.content).toContain("talked about the board");
		expect(prompt[2]?.content).toContain("uses zustand");
		expect(prompt[3]?.content).toBe("last user line");
		expect(prompt[4]?.content).toBe("the new question");
	});

	it("omits empty leading system notes when there is no goal/summary/memory", () => {
		const prompt = renderChatTurnPrompt(
			{ goal: null, summary: null, recalledMemories: [], recentMessages: [] },
			"hi",
		);
		expect(prompt).toEqual([{ role: "user", content: "hi" }]);
	});

	it("omits the temporal block by default even on a temporal turn (§5.AC off by default)", () => {
		// A clock is injected and the message is temporally relevant ("latest") — but the feature is off by default,
		// so the date block must NOT appear and the prompt keeps its fully cacheable prefix.
		const prompt = renderChatTurnPrompt(
			{ goal: "Ship it", summary: null, recalledMemories: [], recentMessages: [] },
			"what is the latest version?",
			{ now: new Date("2026-06-26T21:05:00Z") },
		);
		expect(prompt.some((m) => m.content.includes("<current_date>"))).toBe(false);
		expect(prompt[0]?.content).toContain("Ship it");
		expect(prompt.at(-1)).toEqual({ role: "user", content: "what is the latest version?" });
	});

	it("appends the temporal block as the LAST system note when enabled + relevant (§5.AC end-placement)", () => {
		const prompt = renderChatTurnPrompt(
			{ goal: "Ship it", summary: null, recalledMemories: [], recentMessages: [message("1", "prior line")] },
			"what is the latest version?",
			{ now: new Date("2026-06-26T21:05:00Z"), enabled: true },
		);
		// The goal (cacheable prefix) still LEADS; the volatile date trails the system prefix (§5.AQ), just before the
		// conversation — so the block is the last `system` message and the recent transcript + new user line follow it.
		expect(prompt[0]?.content).toContain("Ship it");
		const dateIdx = prompt.findIndex((m) => m.content.includes("<current_date>"));
		expect(dateIdx).toBe(1);
		expect(prompt[dateIdx]?.role).toBe("system");
		// Default granularity is date-only (§5.AQ-D cache-aware: no per-minute prefix churn).
		expect(prompt[dateIdx]?.content).toContain("2026-06-26");
		// Everything after the block is the conversation: the recent transcript then the new user message.
		expect(prompt[dateIdx + 1]).toEqual({ role: "user", content: "prior line" });
		expect(prompt.at(-1)).toEqual({ role: "user", content: "what is the latest version?" });
	});

	it("omits the temporal block on a non-temporal turn even when enabled (§5.AE relevance gate)", () => {
		const prompt = renderChatTurnPrompt(
			{ goal: "Ship it", summary: null, recalledMemories: [], recentMessages: [] },
			"implement a binary search",
			{ now: new Date("2026-06-26T21:05:00Z"), enabled: true },
		);
		expect(prompt.some((m) => m.content.includes("<current_date>"))).toBe(false);
	});

	it("leaves the prompt unchanged when no clock is injected (back-compat)", () => {
		const prompt = renderChatTurnPrompt(
			{ goal: null, summary: null, recalledMemories: [], recentMessages: [] },
			"hi",
			{ enabled: true },
		);
		expect(prompt).toEqual([{ role: "user", content: "hi" }]);
	});

	it("W3.1: display-only roles (tool/reasoning/status) never enter the window or the prompt", async () => {
		const transcript: ChatMessage[] = [
			message("1", "user asks"),
			{ schemaVersion: 1, id: "2", role: "tool", content: "Tool: read_file", createdAt: 2 },
			{ schemaVersion: 1, id: "3", role: "status", content: "relayed", createdAt: 3 },
			{ ...message("4", "the reply"), role: "assistant" },
		];
		const context = await composeChatTurnContext(
			{ sessionId: "s1", query: "next", transcript, memories: [], tokenBudget: 1000, estimateTokens },
			{ summarize: async () => "never" },
		);
		expect(context.recentMessages.map((m) => m.id)).toEqual(["1", "4"]);
		const prompt = renderChatTurnPrompt(context, "next");
		expect(prompt.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
	});
});
