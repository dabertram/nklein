import { describe, expect, it, vi } from "vitest";
import {
	callLocalAnthropicMessages,
	callLocalNativeChat,
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
		it("posts the built request and returns the parsed response (reasoning + tool calls)", async () => {
			const { impl, calls } = mockFetch({
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							content: "ok",
							reasoning: "think",
							tool_calls: [{ id: "c1", function: { name: "run_tests", arguments: '{"suite":"fast"}' } }],
						},
					},
				],
			});
			const result = await callLocalNativeChat({
				url: LOCAL_NATIVE_URL,
				model: "native",
				maxTokens: 128,
				messages: [{ role: "user", content: "test" }],
				tools: [{ name: "run_tests", parameters: {} }],
				fetchImpl: impl,
			});
			const sent = JSON.parse(String((calls[0]?.init as { body?: string } | undefined)?.body));
			expect(sent).toMatchObject({ model: "native", max_tokens: 128, tool_choice: "auto" });
			expect(result.reasoning).toBe("think");
			expect(result.toolCalls).toEqual([{ id: "c1", name: "run_tests", args: { suite: "fast" } }]);
		});

		it("REFUSES a non-local native endpoint", async () => {
			const { impl } = mockFetch({});
			await expect(
				callLocalNativeChat({
					url: "http://8.8.8.8:1234/api/v1/chat",
					model: "m",
					maxTokens: 8,
					messages: [{ role: "user", content: "hi" }],
					fetchImpl: impl,
				}),
			).rejects.toBeInstanceOf(LocalEndpointError);
		});
	});
});
