import { describe, expect, it } from "vitest";
import { buildNativeChatRequest, parseNativeChatResponse } from "../../../src/core/local-native-chat-shape";

describe("local native /api/v1/chat wire shape (§5.AB endpoint kind)", () => {
	describe("buildNativeChatRequest", () => {
		it("maps messages + tools (OpenAI-compatible) and forces a call with tool_choice:'required'", () => {
			const body = buildNativeChatRequest({
				model: "native-model",
				maxTokens: 512,
				temperature: 0.1,
				messages: [
					{ role: "system", content: "be terse" },
					{ role: "user", content: "edit" },
				],
				tools: [{ name: "write_file", description: "write", parameters: { type: "object" } }],
				forceToolUse: true,
			});
			expect(body).toMatchObject({ model: "native-model", max_tokens: 512, temperature: 0.1 });
			expect(body.messages).toEqual([
				{ role: "system", content: "be terse" },
				{ role: "user", content: "edit" },
			]);
			expect(body.tools).toEqual([
				{
					type: "function",
					function: { name: "write_file", description: "write", parameters: { type: "object" } },
				},
			]);
			expect(body.tool_choice).toBe("required");
		});

		it("sets tool_choice:'auto' when tools are offered without forcing, omits tools when none", () => {
			expect(
				buildNativeChatRequest({ model: "m", maxTokens: 64, messages: [{ role: "user", content: "hi" }] })
					.tool_choice,
			).toBeUndefined();
			expect(
				buildNativeChatRequest({
					model: "m",
					maxTokens: 64,
					messages: [{ role: "user", content: "hi" }],
					tools: [{ name: "t", parameters: {} }],
				}).tool_choice,
			).toBe("auto");
		});
	});

	describe("parseNativeChatResponse", () => {
		it("parses the OpenAI-compatible choices[0].message envelope with tool_calls (arguments as a JSON string)", () => {
			const parsed = parseNativeChatResponse({
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							content: "I'll write it.",
							reasoning: "the file needs a clamp",
							tool_calls: [
								{ id: "c1", type: "function", function: { name: "write_file", arguments: '{"path":"a.ts"}' } },
							],
						},
					},
				],
			});
			expect(parsed.text).toBe("I'll write it.");
			expect(parsed.reasoning).toBe("the file needs a clamp");
			expect(parsed.toolCalls).toEqual([{ id: "c1", name: "write_file", args: { path: "a.ts" } }]);
			expect(parsed.finishReason).toBe("tool_calls");
		});

		it("parses a flat top-level message shape with reasoning_content + a singular native tool_call", () => {
			const parsed = parseNativeChatResponse({
				message: {
					content: "done",
					reasoning_content: "thought",
					tool_call: { id: "n1", name: "run_tests", arguments: { suite: "fast" } },
				},
				stop_reason: "stop",
			});
			expect(parsed.text).toBe("done");
			expect(parsed.reasoning).toBe("thought");
			expect(parsed.toolCalls).toEqual([{ id: "n1", name: "run_tests", args: { suite: "fast" } }]);
			expect(parsed.finishReason).toBe("stop");
		});

		it("reads reasoning from `thinking` and args already-parsed (not a string)", () => {
			const parsed = parseNativeChatResponse({
				content: "x",
				thinking: "hmm",
				tool_calls: [{ id: "", name: "t", arguments: { a: 1 } }],
			});
			expect(parsed.reasoning).toBe("hmm");
			expect(parsed.toolCalls[0]?.args).toEqual({ a: 1 });
		});

		it("is defensive — malformed args / unrecognized body never throw", () => {
			expect(parseNativeChatResponse(null)).toEqual({ text: "", reasoning: "", toolCalls: [], finishReason: null });
			expect(parseNativeChatResponse("nope")).toEqual({
				text: "",
				reasoning: "",
				toolCalls: [],
				finishReason: null,
			});
			// Un-parseable arguments string → args default to {}; a nameless call is skipped.
			const parsed = parseNativeChatResponse({
				content: "",
				tool_calls: [{ function: { name: "t", arguments: "not json" } }, { function: { arguments: "{}" } }],
			});
			expect(parsed.toolCalls).toEqual([{ id: "", name: "t", args: {} }]);
		});

		it("round-trips: a forced request's tool name is what a tool_calls response reports", () => {
			const req = buildNativeChatRequest({
				model: "m",
				maxTokens: 64,
				messages: [{ role: "user", content: "go" }],
				tools: [{ name: "apply_patch", parameters: {} }],
				forceToolUse: true,
			});
			const parsed = parseNativeChatResponse({
				choices: [
					{ message: { tool_calls: [{ function: { name: req.tools?.[0]?.function.name, arguments: "{}" } }] } },
				],
			});
			expect(parsed.toolCalls[0]?.name).toBe("apply_patch");
		});
	});
});
