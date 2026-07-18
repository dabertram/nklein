import { describe, expect, it, vi } from "vitest";
import { runChatAgentTurn } from "../../../src/chat/chat-agent-turn";
import type { ChatSession } from "../../../src/chat/chat-session-store";

const session: ChatSession = {
	schemaVersion: 1,
	id: "s1",
	title: "t",
	scope: "project",
	role: "assistant",
	goal: null,
	riskAcknowledged: false,
	browserEnabled: false,
	sandboxWritablePaths: [],
	boardFeedbackMuted: false,
	createdAt: 0,
	updatedAt: 0,
} as unknown as ChatSession;

function baseDeps(overrides: object = {}) {
	return {
		readTranscript: vi.fn(async () => []),
		readMemories: vi.fn(async () => []),
		appendMessage: vi.fn(async (_id: string, m: { role: string; content: string }) => ({
			id: "m1",
			role: m.role,
			content: m.content,
			createdAt: 0,
		})),
		summarize: vi.fn(async () => ""),
		estimateTokens: (text: string) => Math.ceil(text.length / 4),
		model: vi.fn(async (messages: readonly { role: string; content: string }[]) => ({
			text: "answer",
			toolCalls: [],
			messagesSeen: messages,
		})),
		executeTool: vi.fn(async () => ({ name: "x", output: "" })),
		appendToolExchange: (m: readonly unknown[]) => [...m] as never,
		...overrides,
	};
}

describe("F4.17 chat skill-fragments seam", () => {
	it("inserts the resolved skill block as a system message; absent resolver stays byte-identical", async () => {
		const deps = baseDeps({
			buildSkillFragmentsNote: vi.fn(async () => "SKILL BLOCK: repo conventions"),
		});
		await runChatAgentTurn({ session, userMessage: "hi", tokenBudget: 4000 }, deps as never);
		const seen = (deps.model as ReturnType<typeof vi.fn>).mock.calls[0][0] as { role: string; content: string }[];
		expect(seen.some((m) => m.role === "system" && m.content.includes("SKILL BLOCK"))).toBe(true);

		const plain = baseDeps();
		await runChatAgentTurn({ session, userMessage: "hi", tokenBudget: 4000 }, plain as never);
		const seenPlain = (plain.model as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
			role: string;
			content: string;
		}[];
		expect(seenPlain.some((m) => typeof m.content === "string" && m.content.includes("SKILL BLOCK"))).toBe(false);
	});

	it("a throwing resolver never breaks the turn (fail-soft)", async () => {
		const deps = baseDeps({
			buildSkillFragmentsNote: vi.fn(async () => {
				throw new Error("store down");
			}),
		});
		const result = await runChatAgentTurn({ session, userMessage: "hi", tokenBudget: 4000 }, deps as never);
		expect(result.assistantMessage.content).toBe("answer");
	});
});
