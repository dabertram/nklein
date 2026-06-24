import { describe, expect, it, vi } from "vitest";
import { LocalLlmClient, LocalLlmRequestError } from "../../../src/nklein-sdk/nklein-local-llm-client";

function jsonResponse(content: string, finishReason = "stop"): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("LocalLlmClient local-only enforcement", () => {
	it("refuses a non-local (cloud) endpoint", () => {
		expect(
			() => new LocalLlmClient({ providerId: "openai", modelId: "gpt-4o", baseUrl: "https://api.openai.com/v1" }),
		).toThrow();
	});

	it("allows a localhost endpoint", () => {
		expect(
			() => new LocalLlmClient({ providerId: "lmstudio", modelId: "qwen", baseUrl: "http://127.0.0.1:1234/v1" }),
		).not.toThrow();
	});
});

describe("LocalLlmClient.complete", () => {
	it("sends full sampling params and json_schema response_format to the endpoint", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse("ok"));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await client.complete({
			messages: [{ role: "user", content: "hi" }],
			sampling: {
				temperature: 0.1,
				topP: 0.9,
				topK: 40,
				minP: 0.05,
				repetitionPenalty: 1.1,
				maxTokens: 256,
				stop: ["</end>"],
			},
			format: { jsonSchema: { name: "out", schema: { type: "object" } } },
		});
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			model: "qwen",
			temperature: 0.1,
			top_p: 0.9,
			top_k: 40,
			min_p: 0.05,
			repeat_penalty: 1.1,
			max_tokens: 256,
			stop: ["</end>"],
		});
		expect(body.response_format.type).toBe("json_schema");
		expect(body.response_format.json_schema.name).toBe("out");
	});

	it("passes a llama.cpp grammar through", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse("ok"));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234/v1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await client.complete({ messages: [{ role: "user", content: "hi" }], format: { grammar: 'root ::= "yes"' } });
		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.grammar).toBe('root ::= "yes"');
	});

	it("throws LocalLlmRequestError on a non-200", async () => {
		const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234/v1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(client.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
			LocalLlmRequestError,
		);
	});
});

describe("LocalLlmClient.generateStructured", () => {
	it("parses constrained JSON output", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse('{"value": 42}'));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234/v1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.generateStructured<{ value: number }>({
			messages: [{ role: "user", content: "give me 42" }],
			jsonSchema: { name: "out", schema: { type: "object", properties: { value: { type: "number" } } } },
			parse: (value) => value as { value: number },
		});
		expect(result.value).toBe(42);
	});

	it("recovers JSON wrapped in prose / code fences, then retries on hard failure", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse('here you go: ```json\n{"value": 7}\n```'));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234/v1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.generateStructured<{ value: number }>({
			messages: [{ role: "user", content: "x" }],
			jsonSchema: { name: "out", schema: { type: "object" } },
			parse: (value) => value as { value: number },
		});
		expect(result.value).toBe(7);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("retries once with a corrective message when the first reply is not JSON", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse("I cannot do that"))
			.mockResolvedValueOnce(jsonResponse('{"value": 1}'));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234/v1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.generateStructured<{ value: number }>({
			messages: [{ role: "user", content: "x" }],
			jsonSchema: { name: "out", schema: { type: "object" } },
			parse: (value) => value as { value: number },
		});
		expect(result.value).toBe(1);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const retryBody = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
		expect(retryBody.messages.at(-1).content).toContain("valid JSON");
	});
});

describe("LocalLlmClient.completeWithTools", () => {
	function toolCallResponse(): Response {
		return new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: "",
							tool_calls: [
								{ id: "call_1", function: { name: "read_file", arguments: '{"path":"README.md"}' } },
								{ function: { name: "bad_args", arguments: "{not json" } },
								{ function: { name: "", arguments: "{}" } },
							],
						},
						finish_reason: "tool_calls",
					},
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}

	it("offers tools to the endpoint and parses tool_calls (decoding JSON-string args; malformed → {})", async () => {
		const fetchImpl = vi.fn(async () => toolCallResponse());
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "read it" }] }, [
			{ name: "read_file", description: "Read a file", parameters: { type: "object" } },
		]);

		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "read_file" } });
		expect(body.tool_choice).toBe("auto");

		// The unnamed call is dropped; the malformed-args call yields {}.
		expect(result.toolCalls).toEqual([
			{ id: "call_1", name: "read_file", arguments: { path: "README.md" } },
			{ id: "call_1", name: "bad_args", arguments: {} },
		]);
	});

	it("is a plain completion when no tools are offered (no tools field sent)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "hi" }] }, []);
		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.tools).toBeUndefined();
		expect(result).toMatchObject({ content: "hi", toolCalls: [] });
	});
});
