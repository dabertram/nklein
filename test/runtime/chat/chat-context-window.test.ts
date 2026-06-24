import { describe, expect, it } from "vitest";
import { consolidateChatContextWindow, splitChatContextWindow } from "../../../src/chat/chat-context-window";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";

function message(id: string, content: string): ChatMessage {
	return { schemaVersion: 1, id, role: "user", content, createdAt: Number(id) };
}

// One "token" per character keeps the budget arithmetic obvious.
const estimateTokens = (text: string) => text.length;

describe("chat-context-window", () => {
	it("keeps the most recent messages within budget and overflows the rest", () => {
		const messages = [message("1", "aaaa"), message("2", "bbbb"), message("3", "cccc")];
		const window = splitChatContextWindow({ messages, tokenBudget: 8, estimateTokens });
		expect(window.recent.map((m) => m.id)).toEqual(["2", "3"]);
		expect(window.overflow.map((m) => m.id)).toEqual(["1"]);
	});

	it("never drops the current/last message even if it alone exceeds the budget", () => {
		const messages = [message("1", "aa"), message("2", "this-one-is-huge")];
		const window = splitChatContextWindow({ messages, tokenBudget: 4, estimateTokens });
		expect(window.recent.map((m) => m.id)).toEqual(["2"]);
		expect(window.overflow.map((m) => m.id)).toEqual(["1"]);
	});

	it("returns no overflow when everything fits", () => {
		const messages = [message("1", "ab"), message("2", "cd")];
		const window = splitChatContextWindow({ messages, tokenBudget: 100, estimateTokens });
		expect(window.overflow).toEqual([]);
		expect(window.recent.map((m) => m.id)).toEqual(["1", "2"]);
	});

	it("summarizes the overflow only when present", async () => {
		const messages = [message("1", "aaaa"), message("2", "bbbb"), message("3", "cccc")];
		const window = splitChatContextWindow({ messages, tokenBudget: 8, estimateTokens });
		const consolidated = await consolidateChatContextWindow(
			window,
			async (overflow) => `summary of ${overflow.length}`,
		);
		expect(consolidated).toEqual({ summary: "summary of 1", recent: window.recent });

		const noOverflow = await consolidateChatContextWindow({ overflow: [], recent: messages }, async () => {
			throw new Error("should not summarize");
		});
		expect(noOverflow.summary).toBeNull();
	});
});
