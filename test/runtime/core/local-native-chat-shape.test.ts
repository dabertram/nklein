import { describe, expect, it } from "vitest";
import { buildNativeChatRequest, parseNativeChatResponse } from "../../../src/core/local-native-chat-shape";

/**
 * F4.33/F4.34 — contract refreshed from live LM Studio 0.4.x responses on 2026-07-22.
 */
describe("native /api/v1/chat shape (F4.33 probed contract)", () => {
	it("builds the current input-string request with dedicated system/state/stream controls", () => {
		const body = buildNativeChatRequest({
			model: "mistralai/ministral-3-14b-reasoning",
			maxOutputTokens: 200,
			temperature: 0,
			stream: true,
			reasoning: "off",
			contextLength: 32_768,
			store: false,
			messages: [
				{ role: "system", content: "You are terse." },
				{ role: "assistant", content: "Earlier answer" },
				{ role: "user", content: "Say OK" },
			],
		});
		expect(body).toEqual({
			model: "mistralai/ministral-3-14b-reasoning",
			max_output_tokens: 200,
			temperature: 0,
			input: "[assistant]\nEarlier answer\n\nSay OK",
			system_prompt: "You are terse.",
			stream: true,
			reasoning: "off",
			context_length: 32_768,
			store: false,
		});
	});

	it("parses the live-captured reasoning+message response with stats and the chainable id", () => {
		const live = {
			model_instance_id: "mistralai/ministral-3-14b-reasoning",
			output: [
				{ type: "reasoning", content: 'The user has asked me to say "OK" and nothing else.' },
				{ type: "message", content: "OK" },
			],
			stats: {
				input_tokens: 131,
				total_output_tokens: 138,
				reasoning_output_tokens: 134,
				tokens_per_second: 15.73,
				time_to_first_token_seconds: 0.17,
			},
			response_id: "resp_02be6fe1e098aa44cde5ae3b50d895f2a631620c9d3e7324",
		};
		const parsed = parseNativeChatResponse(live);
		expect(parsed.text).toBe("OK");
		expect(parsed.reasoning).toContain("asked me to say");
		expect(parsed.responseId).toBe("resp_02be6fe1e098aa44cde5ae3b50d895f2a631620c9d3e7324");
		expect(parsed.modelInstanceId).toBe("mistralai/ministral-3-14b-reasoning");
		expect(parsed.stats.inputTokens).toBe(131);
		expect(parsed.stats.reasoningOutputTokens).toBe(134);
		expect(parsed.toolCalls).toEqual([]);
	});

	it("parses the live MCP tool_call output, result, and provider identity", () => {
		const parsed = parseNativeChatResponse({
			model_instance_id: "m",
			output: [
				{
					type: "tool_call",
					tool: "read_file",
					arguments: { path: "a.ts" },
					output: "contents",
					provider_info: { type: "plugin", plugin_id: "mcp/files" },
				},
			],
			response_id: "resp_x",
			stats: {},
		});
		expect(parsed.toolCalls).toEqual([
			{
				id: "",
				name: "read_file",
				args: { path: "a.ts" },
				output: "contents",
				provider: { type: "plugin", pluginId: "mcp/files", serverLabel: null },
			},
		]);
	});

	it("parses an unrecognized body to empty channels, never throwing", () => {
		const parsed = parseNativeChatResponse({ error: { message: "boom" } });
		expect(parsed.text).toBe("");
		expect(parsed.reasoning).toBe("");
		expect(parsed.responseId).toBeNull();
		expect(parsed.stats.inputTokens).toBeNull();
		expect(parseNativeChatResponse(null).text).toBe("");
	});
});
