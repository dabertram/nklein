import { describe, expect, it } from "vitest";
import { appendChatSteeringMessages, type ChatSteeringMessage } from "../../../src/chat/chat-steering";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";

const baseMessages: ChatPromptMessage[] = [
	{ role: "system", content: "sys" },
	{ role: "user", content: "hi" },
];

function steer(id: string, content: string): ChatSteeringMessage {
	return { id, content, createdAt: 1 };
}

describe("appendChatSteeringMessages (§12 turn-loop steering)", () => {
	it("returns a copy of the messages when there is nothing to steer", () => {
		const result = appendChatSteeringMessages(baseMessages, []);
		expect(result).toEqual(baseMessages);
		expect(result).not.toBe(baseMessages); // fresh array, not the input reference
	});

	it("appends each steering message as a user turn with the in-flight-update framing", () => {
		const result = appendChatSteeringMessages(baseMessages, [steer("a", "use TypeScript"), steer("b", "add tests")]);
		expect(result).toHaveLength(4);
		// Original messages preserved in order.
		expect(result.slice(0, 2)).toEqual(baseMessages);
		// Steering messages become user turns, framed as mid-turn updates.
		expect(result[2]).toEqual({
			role: "user",
			content: "User steering update received while this turn is still running:\nuse TypeScript",
		});
		expect(result[3]?.content).toContain("add tests");
		expect(result[3]?.role).toBe("user");
	});
});
