import { describe, expect, it } from "vitest";
import {
	buildAnthropicMessagesRequest,
	parseAnthropicMessagesResponse,
} from "../../../src/core/local-anthropic-messages-shape";

describe("local Anthropic-messages wire shape (§5.AB endpoint kind)", () => {
	describe("buildAnthropicMessagesRequest", () => {
		it("hoists system messages into the top-level `system` field and keeps user/assistant in messages[]", () => {
			const body = buildAnthropicMessagesRequest({
				model: "local-messages-model",
				maxTokens: 512,
				messages: [
					{ role: "system", content: "You are a coding agent." },
					{ role: "user", content: "cap the score" },
					{ role: "assistant", content: "on it" },
					{ role: "system", content: "Be terse." },
				],
			});
			expect(body.system).toBe("You are a coding agent.\n\nBe terse."); // joined, hoisted out of messages
			expect(body.messages).toEqual([
				{ role: "user", content: "cap the score" },
				{ role: "assistant", content: "on it" },
			]);
			expect(body).toMatchObject({ model: "local-messages-model", max_tokens: 512 });
			expect(body.tools).toBeUndefined();
			expect(body.tool_choice).toBeUndefined();
		});

		it("maps tools to {name, description, input_schema} and sets tool_choice auto by default", () => {
			const body = buildAnthropicMessagesRequest({
				model: "m",
				maxTokens: 256,
				messages: [{ role: "user", content: "edit the file" }],
				tools: [
					{ name: "write_file", description: "write a file", inputSchema: { type: "object", properties: {} } },
				],
			});
			expect(body.tools).toEqual([
				{ name: "write_file", description: "write a file", input_schema: { type: "object", properties: {} } },
			]);
			expect(body.tool_choice).toEqual({ type: "auto" });
		});

		it("forces a tool call with tool_choice:{type:'any'} when forceToolUse is set", () => {
			const body = buildAnthropicMessagesRequest({
				model: "m",
				maxTokens: 256,
				messages: [{ role: "user", content: "edit the file" }],
				tools: [{ name: "write_file", inputSchema: {} }],
				forceToolUse: true,
			});
			expect(body.tool_choice).toEqual({ type: "any" });
			expect(body.tools?.[0]).toEqual({ name: "write_file", input_schema: {} }); // no description omitted cleanly
		});

		it("threads temperature and omits blank system messages", () => {
			const body = buildAnthropicMessagesRequest({
				model: "m",
				maxTokens: 128,
				temperature: 0.2,
				messages: [
					{ role: "system", content: "   " }, // blank → dropped
					{ role: "user", content: "hi" },
				],
			});
			expect(body.temperature).toBe(0.2);
			expect(body.system).toBeUndefined();
		});
	});

	describe("parseAnthropicMessagesResponse", () => {
		it("extracts concatenated text + tool_use blocks + stop_reason from a documented response", () => {
			// A representative /v1/messages response body (Messages API content-block format).
			const response = {
				id: "msg_1",
				type: "message",
				role: "assistant",
				content: [
					{ type: "text", text: "I'll cap it. " },
					{ type: "tool_use", id: "toolu_1", name: "write_file", input: { path: "a.ts", content: "x" } },
					{ type: "text", text: "Done." },
				],
				stop_reason: "tool_use",
			};
			const parsed = parseAnthropicMessagesResponse(response);
			expect(parsed.text).toBe("I'll cap it. Done.");
			expect(parsed.toolCalls).toEqual([
				{ id: "toolu_1", name: "write_file", args: { path: "a.ts", content: "x" } },
			]);
			expect(parsed.stopReason).toBe("tool_use");
		});

		it("is defensive — a malformed/partial body yields empty text + no tool calls, never throws", () => {
			expect(parseAnthropicMessagesResponse(null)).toEqual({ text: "", toolCalls: [], stopReason: null });
			expect(parseAnthropicMessagesResponse("nonsense")).toEqual({ text: "", toolCalls: [], stopReason: null });
			expect(parseAnthropicMessagesResponse({ content: "not-an-array" })).toEqual({
				text: "",
				toolCalls: [],
				stopReason: null,
			});
			// A tool_use block missing its input defaults args to {} and a missing id to "".
			const parsed = parseAnthropicMessagesResponse({ content: [{ type: "tool_use", name: "t" }] });
			expect(parsed.toolCalls).toEqual([{ id: "", name: "t", args: {} }]);
		});

		it("round-trips: a forced request's tool is what a tool_use response reports", () => {
			const req = buildAnthropicMessagesRequest({
				model: "m",
				maxTokens: 64,
				messages: [{ role: "user", content: "go" }],
				tools: [{ name: "run_tests", inputSchema: {} }],
				forceToolUse: true,
			});
			const parsed = parseAnthropicMessagesResponse({
				content: [{ type: "tool_use", id: "t1", name: req.tools?.[0]?.name, input: {} }],
				stop_reason: "tool_use",
			});
			expect(parsed.toolCalls[0]?.name).toBe("run_tests");
		});
	});
});
