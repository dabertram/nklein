import { describe, expect, it } from "vitest";
import { NativeChatSessionController } from "../../../src/core/local-native-chat-session";
import type { NativeChatMessage, ParsedNativeChatResponse } from "../../../src/core/local-native-chat-shape";

function response(responseId: string, text = "First answer", reasoning = ""): ParsedNativeChatResponse {
	return {
		text,
		reasoning,
		toolCalls: [],
		invalidToolCalls: [],
		responseId,
		modelInstanceId: "model",
		stats: {
			inputTokens: 1,
			totalOutputTokens: 1,
			reasoningOutputTokens: 0,
			tokensPerSecond: 1,
			timeToFirstTokenSeconds: 0,
			modelLoadTimeSeconds: 0,
		},
	};
}

const firstTurn: NativeChatMessage[] = [
	{ role: "system", content: "Answer faithfully." },
	{ role: "user", content: "First question" },
];

describe("native chat session continuity", () => {
	it("sends only the new delta after proving the stored assistant turn", () => {
		const session = new NativeChatSessionController();
		const first = session.plan(firstTurn, "policy-a");
		expect(first.mode).toBe("stateless_full");
		expect(session.accept(first, response("resp_1"))).toBe(true);

		const next = session.plan(
			[...firstTurn, { role: "assistant", content: "First answer" }, { role: "user", content: "Second question" }],
			"policy-a",
		);
		expect(next).toMatchObject({
			mode: "stateful_delta",
			previousResponseId: "resp_1",
			messages: [{ role: "user", content: "Second question" }],
		});
	});

	it("accepts the exact persisted reasoning+text assistant representation", () => {
		const session = new NativeChatSessionController();
		const first = session.plan(firstTurn, "policy-a");
		session.accept(first, response("resp_1", "Final", "Private reasoning"));
		const next = session.plan(
			[
				...firstTurn,
				{ role: "assistant", content: "[reasoning]\nPrivate reasoning\nFinal" },
				{ role: "user", content: "Next" },
			],
			"policy-a",
		);
		expect(next.mode).toBe("stateful_delta");
	});

	it.each([
		["assistant mismatch", "policy-a", "Changed answer", "Answer faithfully."],
		["system changed", "policy-a", "First answer", "Different system."],
		["policy changed", "policy-b", "First answer", "Answer faithfully."],
	])("fails closed to full replay when %s", (_label, policy, assistant, system) => {
		const session = new NativeChatSessionController();
		const first = session.plan(firstTurn, "policy-a");
		session.accept(first, response("resp_1"));
		const messages: NativeChatMessage[] = [
			{ role: "system", content: system },
			{ role: "user", content: "First question" },
			{ role: "assistant", content: assistant },
			{ role: "user", content: "Second question" },
		];
		const next = session.plan(messages, policy);
		expect(next.mode).toBe("stateless_full");
		expect(next.previousResponseId).toBeNull();
		expect(next.messages).toEqual(messages);
	});

	it("rejects a stale response after invalidation", () => {
		const session = new NativeChatSessionController();
		const plan = session.plan(firstTurn, "policy-a");
		session.invalidate();
		expect(session.accept(plan, response("stale"))).toBe(false);
	});

	it("keeps per-attempt retry instructions on the wire but outside continuity ownership", () => {
		const session = new NativeChatSessionController();
		const first = session.plan(firstTurn, "policy-a", [{ role: "user", content: "Retry instruction one" }]);
		expect(first.messages.at(-1)?.content).toBe("Retry instruction one");
		session.accept(first, response("resp_1"));
		const next = session.plan(
			[...firstTurn, { role: "assistant", content: "First answer" }, { role: "user", content: "Second question" }],
			"policy-a",
			[{ role: "user", content: "Different retry instruction" }],
		);
		expect(next).toMatchObject({
			mode: "stateful_delta",
			messages: [
				{ role: "user", content: "Second question" },
				{ role: "user", content: "Different retry instruction" },
			],
		});
	});
});
