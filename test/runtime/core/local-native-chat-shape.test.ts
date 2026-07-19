import { describe, expect, it } from "vitest";
import { buildNativeChatRequest, parseNativeChatResponse } from "../../../src/core/local-native-chat-shape";

/**
 * F4.33 — fixtures RE-DERIVED FROM LIVE 200s (2026-07-19, LM Studio 0.3.x /api/v1/chat, ministral-3-14b):
 * request {model,input:[{type:"text",content}],max_output_tokens}; response {model_instance_id,output[],
 * response_id,stats}. The multi-item alternation 500 is the live-probed reason the builder merges to ONE item.
 */
describe("native /api/v1/chat shape (F4.33 probed contract)", () => {
	it("builds the single-merged-item request (each text item is its own user turn server-side)", () => {
		const body = buildNativeChatRequest({
			model: "mistralai/ministral-3-14b-reasoning",
			maxOutputTokens: 200,
			temperature: 0,
			messages: [
				{ role: "system", content: "You are terse." },
				{ role: "user", content: "Say OK" },
			],
		});
		expect(body).toEqual({
			model: "mistralai/ministral-3-14b-reasoning",
			max_output_tokens: 200,
			temperature: 0,
			input: [{ type: "text", content: "[system]\nYou are terse.\n\nSay OK" }],
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

	it("accepts a defensive tool_call output item without guessing beyond name/arguments", () => {
		const parsed = parseNativeChatResponse({
			model_instance_id: "m",
			output: [{ type: "tool_call", id: "t1", name: "read_file", arguments: '{"path":"a.ts"}' }],
			response_id: "resp_x",
			stats: {},
		});
		expect(parsed.toolCalls).toEqual([{ id: "t1", name: "read_file", args: { path: "a.ts" } }]);
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
