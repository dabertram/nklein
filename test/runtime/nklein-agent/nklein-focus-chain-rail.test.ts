import { describe, expect, it } from "vitest";
import type { FocusChain } from "../../../src/core/focus-chain";
import { FOCUS_CHAIN_RAIL_KIND, reanchorFocusChainMessages } from "../../../src/nklein-agent/nklein-focus-chain-rail";
import type { AgentMessage } from "../../../src/nklein-agent/sdk-agent-types";

function userMessage(text: string, kind?: string): AgentMessage {
	return {
		id: `m-${text}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: 0,
		...(kind ? { metadata: { kind } } : {}),
	};
}

const CHAIN: FocusChain = {
	steps: [
		{ text: "Write the parser", status: "done" },
		{ text: "Add tests", status: "in_progress" },
	],
	updatedAt: 1,
};

function railCount(messages: readonly AgentMessage[]): number {
	return messages.filter((message) => message.metadata?.kind === FOCUS_CHAIN_RAIL_KIND).length;
}

describe("reanchorFocusChainMessages", () => {
	it("is a no-op (same reference) when there is no chain and no stale rail", () => {
		const messages = [userMessage("hello")];
		expect(reanchorFocusChainMessages(messages, null)).toBe(messages);
	});

	it("prepends a single focus-chain rail carrying the current chain", () => {
		const result = reanchorFocusChainMessages([userMessage("hello")], CHAIN);
		expect(railCount(result)).toBe(1);
		expect(result[0].metadata?.kind).toBe(FOCUS_CHAIN_RAIL_KIND);
		const text = (result[0].content[0] as { text: string }).text;
		expect(text).toContain("focus chain");
		expect(text).toContain("Write the parser");
		expect(result).toHaveLength(2);
	});

	it("replaces a stale rail rather than stacking (always exactly one, always current)", () => {
		const withStale = [userMessage("[old chain]", FOCUS_CHAIN_RAIL_KIND), userMessage("hello")];
		const result = reanchorFocusChainMessages(withStale, CHAIN);
		expect(railCount(result)).toBe(1);
		expect(result).toHaveLength(2);
		expect((result[0].content[0] as { text: string }).text).toContain("Write the parser");
	});

	it("strips a stale rail when the chain is cleared (no chain → no rail)", () => {
		const withStale = [userMessage("[old chain]", FOCUS_CHAIN_RAIL_KIND), userMessage("hello")];
		const result = reanchorFocusChainMessages(withStale, null);
		expect(railCount(result)).toBe(0);
		expect(result).toHaveLength(1);
	});

	it("treats an empty chain as no chain", () => {
		const messages = [userMessage("hello")];
		const result = reanchorFocusChainMessages(messages, { steps: [], updatedAt: 1 });
		expect(result).toBe(messages);
	});
});
