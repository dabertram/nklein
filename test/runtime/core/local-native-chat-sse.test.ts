import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NativeChatSseStateMachine } from "../../../src/core/local-native-chat-sse";

function fixture(name: string): string {
	return readFileSync(new URL(`../../fixtures/lmstudio-native/${name}`, import.meta.url), "utf8");
}

function parseInAwkwardChunks(raw: string) {
	const state = new NativeChatSseStateMachine();
	const sizes = [1, 7, 2, 19, 3, 41];
	let offset = 0;
	let index = 0;
	while (offset < raw.length) {
		const size = sizes[index % sizes.length] ?? 1;
		state.push(raw.slice(offset, offset + size));
		offset += size;
		index += 1;
	}
	return state.finish();
}

describe("NativeChatSseStateMachine (F4.34 live-derived fixtures)", () => {
	it("assembles reasoning, message, usage, ids, and chat.end termination across arbitrary chunks", () => {
		const parsed = parseInAwkwardChunks(fixture("reasoning-message.sse"));
		expect(parsed.termination).toBe("chat_end");
		expect(parsed.result).toMatchObject({
			text: "42",
			reasoning: "17 + 25 = 42",
			responseId: "resp_fixture",
			modelInstanceId: "qwen/qwen3.6-35b-a3b",
			stats: { inputTokens: 29, reasoningOutputTokens: 6 },
		});
		expect(parsed.protocolErrors).toEqual([]);
	});

	it("retains the real tool name/arguments/success result and the undocumented tool_call.name event", () => {
		const parsed = parseInAwkwardChunks(fixture("tool-success.sse"));
		expect(parsed.result.toolCalls).toEqual([
			{
				id: "",
				name: "hub_repo_search",
				args: { query: "qwen3", repo_types: ["model"], limit: 1 },
				output: '[{"type":"text","text":"Found one public model"}]',
				provider: { type: "ephemeral_mcp", pluginId: null, serverLabel: "huggingface" },
			},
		]);
		expect(parsed.result.text).toBe("The model ID is demo/model");
		expect(parsed.eventTypes).toContain("tool_call.name");
	});

	it("preserves a streamed error even though chat.end still arrives", () => {
		const parsed = parseInAwkwardChunks(fixture("error.sse"));
		expect(parsed.termination).toBe("chat_end");
		expect(parsed.errors).toEqual([
			{
				type: "mcp_connection_error",
				message: "Unable to connect to remote MCP server because the URL resolves to a non-public address.",
				code: null,
				param: "integrations",
			},
		]);
	});

	it("does not bless a partial stream whose transport ends before chat.end", () => {
		const state = new NativeChatSseStateMachine();
		state.push('event: message.delta\ndata: {"type":"message.delta","content":"partial"}\n\n');
		const parsed = state.finish();
		expect(parsed.termination).toBe("eof_without_chat_end");
		expect(parsed.result.text).toBe("partial");
	});
});
