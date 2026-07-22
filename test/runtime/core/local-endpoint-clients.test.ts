import { describe, expect, it, vi } from "vitest";
import {
	callLocalAnthropicMessages,
	callLocalNativeChat,
	callLocalNativeChatStream,
	LocalEndpointError,
} from "../../../src/core/local-endpoint-clients";

/** Build a mock `fetch` that captures the request and returns a canned JSON body / status. */
function mockFetch(body: unknown, status = 200) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		} as Response;
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const LOCAL_URL = "http://127.0.0.1:1234/v1/messages";
const LOCAL_NATIVE_URL = "http://127.0.0.1:1234/api/v1/chat";

describe("local endpoint clients (§5.AB)", () => {
	describe("callLocalAnthropicMessages", () => {
		it("posts the built request and returns the parsed response", async () => {
			const { impl, calls } = mockFetch({
				content: [{ type: "tool_use", id: "t1", name: "write_file", input: { path: "a.ts" } }],
				stop_reason: "tool_use",
			});
			const result = await callLocalAnthropicMessages({
				url: LOCAL_URL,
				model: "local-messages",
				maxTokens: 256,
				messages: [{ role: "user", content: "edit" }],
				tools: [{ name: "write_file", inputSchema: {} }],
				forceToolUse: true,
				fetchImpl: impl,
			});
			// Sent the right body (forced tool choice, tools mapped).
			const sent = JSON.parse(String((calls[0]?.init as { body?: string } | undefined)?.body));
			expect(sent).toMatchObject({ model: "local-messages", max_tokens: 256, tool_choice: { type: "any" } });
			// Parsed the response.
			expect(result.toolCalls).toEqual([{ id: "t1", name: "write_file", args: { path: "a.ts" } }]);
			expect(result.stopReason).toBe("tool_use");
		});

		it("REFUSES a non-local endpoint (prime directive #1)", async () => {
			const { impl } = mockFetch({});
			await expect(
				callLocalAnthropicMessages({
					url: "https://api.example.com/v1/messages",
					model: "m",
					maxTokens: 8,
					messages: [{ role: "user", content: "hi" }],
					fetchImpl: impl,
				}),
			).rejects.toBeInstanceOf(LocalEndpointError);
			// fetch was never called — the guard trips before any network attempt.
			expect((impl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
		});

		it("throws a LocalEndpointError with the status on a non-2xx response", async () => {
			const { impl } = mockFetch({ error: "bad" }, 500);
			await expect(
				callLocalAnthropicMessages({
					url: LOCAL_URL,
					model: "m",
					maxTokens: 8,
					messages: [{ role: "user", content: "hi" }],
					fetchImpl: impl,
				}),
			).rejects.toMatchObject({ name: "LocalEndpointError", status: 500 });
		});
	});

	describe("callLocalNativeChat", () => {
		it("posts the current native request shape and parses the aggregate body", async () => {
			const { impl, calls } = mockFetch({
				model_instance_id: "native",
				output: [
					{ type: "reasoning", content: "think" },
					{ type: "message", content: "ok" },
				],
				response_id: "resp_1",
				stats: { input_tokens: 10, total_output_tokens: 4 },
			});
			const result = await callLocalNativeChat({
				url: LOCAL_NATIVE_URL,
				model: "native",
				maxOutputTokens: 128,
				messages: [{ role: "user", content: "test" }],
				fetchImpl: impl,
			});
			const sent = JSON.parse(String((calls[0]?.init as { body?: string } | undefined)?.body));
			expect(sent).toEqual({
				model: "native",
				max_output_tokens: 128,
				input: "test",
			});
			expect(result.text).toBe("ok");
			expect(result.reasoning).toBe("think");
			expect(result.responseId).toBe("resp_1");
			expect(result.stats.inputTokens).toBe(10);
		});

		it("streams through the state machine and marks chat.end as authoritative", async () => {
			const raw = [
				'event: chat.start\ndata: {"type":"chat.start","model_instance_id":"native"}\n\n',
				'event: message.delta\ndata: {"type":"message.delta","content":"o"}\n\n',
				'event: message.delta\ndata: {"type":"message.delta","content":"k"}\n\n',
				'event: chat.end\ndata: {"type":"chat.end","result":{"model_instance_id":"native","output":[{"type":"message","content":"ok"}],"stats":{"input_tokens":1,"total_output_tokens":1,"reasoning_output_tokens":0,"tokens_per_second":2,"time_to_first_token_seconds":0.1}}}\n\n',
			];
			const encoder = new TextEncoder();
			const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
				const sent = JSON.parse(String(init?.body)) as { stream?: boolean };
				expect(sent.stream).toBe(true);
				return new Response(
					new ReadableStream({
						start(controller) {
							for (const part of raw) controller.enqueue(encoder.encode(part));
							controller.close();
						},
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				);
			}) as unknown as typeof fetch;
			const events: string[] = [];
			const parsed = await callLocalNativeChatStream({
				url: LOCAL_NATIVE_URL,
				model: "native",
				maxOutputTokens: 8,
				messages: [{ role: "user", content: "test" }],
				fetchImpl: impl,
				onEvent: (event) => events.push(event.type),
			});
			expect(parsed.termination).toBe("chat_end");
			expect(parsed.result.text).toBe("ok");
			expect(events).toEqual(["chat.start", "message.delta", "message.delta", "chat.end"]);
		});

		it("REFUSES a non-local native endpoint", async () => {
			const { impl } = mockFetch({});
			await expect(
				callLocalNativeChat({
					url: "http://8.8.8.8:1234/api/v1/chat",
					model: "m",
					maxOutputTokens: 8,
					messages: [{ role: "user", content: "hi" }],
					fetchImpl: impl,
				}),
			).rejects.toBeInstanceOf(LocalEndpointError);
		});
	});
});
