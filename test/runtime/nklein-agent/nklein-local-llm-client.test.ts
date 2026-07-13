import { describe, expect, it, vi } from "vitest";
import { LocalLlmClient, LocalLlmRequestError } from "../../../src/nklein-agent/nklein-local-llm-client";

function jsonResponse(content: string, finishReason = "stop"): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function abortError(): DOMException {
	return new DOMException("The operation was aborted", "AbortError");
}

function sseResponse(content: string, finishReason = "stop"): Response {
	const payload = JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] });
	return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
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
	it("retries an abort-shaped provider/runtime failure then succeeds", async () => {
		const caller = new AbortController();
		const fetchImpl = vi.fn().mockRejectedValueOnce(abortError()).mockResolvedValueOnce(jsonResponse("recovered"));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.complete({ messages: [{ role: "user", content: "hi" }], signal: caller.signal }),
		).resolves.toMatchObject({
			content: "recovered",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("retries a non-stream finish_reason:aborted response before returning content", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse("discarded partial", "aborted"))
			.mockResolvedValueOnce(jsonResponse("recovered"));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await expect(client.complete({ messages: [{ role: "user", content: "hi" }] })).resolves.toMatchObject({
			content: "recovered",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("bounds persistent abort retries to two retries after the first attempt", async () => {
		const caller = new AbortController();
		const fetchImpl = vi.fn(async () => {
			throw abortError();
		});
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.complete({ messages: [{ role: "user", content: "hi" }], signal: caller.signal }),
		).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it("does not retry an explicit caller cancellation", async () => {
		const caller = new AbortController();
		const fetchImpl = vi.fn(async () => {
			caller.abort();
			throw abortError();
		});
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.complete({ messages: [{ role: "user", content: "hi" }], signal: caller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("does not guess that raw cancellation text is transient when the caller supplied no signal", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("user stopped / cancelled");
		});
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await expect(client.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("cancelled");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("retries a transient failure then succeeds (§5.AF), with a fresh request per attempt", async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async () => {
			calls += 1;
			if (calls === 1) {
				throw new Error("Body Timeout Error");
			}
			return jsonResponse("recovered");
		});
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.complete({ messages: [{ role: "user", content: "hi" }] });
		expect(result.content).toBe("recovered");
		expect(calls).toBe(2);
	});

	it("does NOT retry a non-transient 500 (a generic server error is a real failure)", async () => {
		const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(client.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
			LocalLlmRequestError,
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("§5.AN: rejects an illegal json_schema name PRE-FLIGHT (no wasted network call)", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse("ok"));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.complete({
				messages: [{ role: "user", content: "hi" }],
				format: { jsonSchema: { name: "bad name!", schema: { type: "object" } } },
			}),
		).rejects.toBeInstanceOf(LocalLlmRequestError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("§5.AN: rejects a strict schema missing additionalProperties PRE-FLIGHT with a machine-stable code", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse("ok"));
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.complete({
				messages: [{ role: "user", content: "hi" }],
				format: {
					jsonSchema: { name: "ok_name", schema: { type: "object", properties: { x: { type: "string" } } } },
				},
			}),
		).rejects.toThrow(/strict_missing_additional_properties/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

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

	it("retries a finish_reason:aborted tools response before parsing any partial call", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse("partial", "aborted"))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: '{"path":"a"}' } }],
								},
								finish_reason: "tool_calls",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const result = await client.completeWithTools({ messages: [{ role: "user", content: "read" }] }, [
			{ name: "read_file", description: "Read", parameters: { type: "object" } },
		]);
		expect(result.toolCalls).toEqual([{ id: "call-1", name: "read_file", arguments: { path: "a" } }]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("retries an abort-shaped provider/runtime failure before returning a tool call", async () => {
		const caller = new AbortController();
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(abortError())
			.mockImplementationOnce(async () => toolCallResponse());
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools(
			{ messages: [{ role: "user", content: "read it" }], signal: caller.signal },
			[{ name: "read_file", description: "Read a file", parameters: { type: "object" } }],
		);
		expect(result.toolCalls[0]).toMatchObject({ name: "read_file", arguments: { path: "README.md" } });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("does not retry a tools call after explicit caller cancellation", async () => {
		const caller = new AbortController();
		const fetchImpl = vi.fn(async () => {
			caller.abort();
			throw abortError();
		});
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.completeWithTools({ messages: [{ role: "user", content: "read it" }], signal: caller.signal }, [
				{ name: "read_file", description: "Read a file", parameters: { type: "object" } },
			]),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

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

	it("captures reasoningTokens from usage.completion_tokens_details (§5.AN reasoning-overhead signal)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "4" }, finish_reason: "stop" }],
						usage: { completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 544 } },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "x" }] }, []);
		expect(result.reasoningTokens).toBe(544);
		// Absent usage ⇒ null (not 0), so callers can tell "not reported" from "zero reasoning".
		const fetchNoUsage = vi.fn(async () => toolCallResponse());
		const client2 = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchNoUsage as unknown as typeof fetch,
		});
		const r2 = await client2.completeWithTools({ messages: [{ role: "user", content: "x" }] }, []);
		expect(r2.reasoningTokens).toBeNull();
	});

	it("forces a call with tool_choice:required when opts.toolChoice is set (§5.AA/§5.AN native lever)", async () => {
		const fetchImpl = vi.fn(async () => toolCallResponse());
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await client.completeWithTools(
			{ messages: [{ role: "user", content: "read it" }] },
			[{ name: "read_file", description: "Read a file", parameters: { type: "object" } }],
			{ toolChoice: "required" },
		);
		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.tool_choice).toBe("required");
	});

	it("§5.AB: under toolChoice:required, DROPS a structured tool_call for a tool that was NOT offered (endpoint violation)", async () => {
		// Live 2026-07-01: LM Studio/MLX does NOT constrain tool_choice:required to the offered `tools` — qwopus3.6-27b,
		// fixated on read_file, returned a STRUCTURED read_file even when ONLY run_command was offered on the force call.
		// That off-menu call would dedupe to "no progress" and stall the chain, so the client must drop it.
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									// Endpoint returns read_file structurally, but only run_command is offered below.
									tool_calls: [{ id: "x", function: { name: "read_file", arguments: '{"path":"FACT.txt"}' } }],
								},
								finish_reason: "tool_calls",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwopus3.6-27b-v2-mlx",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools(
			{ messages: [{ role: "user", content: "next step" }] },
			[{ name: "run_command", description: "Run a command", parameters: { type: "object" } }],
			{ toolChoice: "required" },
		);
		// read_file was off-menu → dropped; no fabricated done-tool call survives to dedupe on.
		expect(result.toolCalls).toEqual([]);
	});

	it("§5.AB: under toolChoice:required, KEEPS a structured tool_call that IS offered (normal forced advance)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{ id: "ok", function: { name: "run_command", arguments: '{"command":"cat FACT.txt"}' } },
									],
								},
								finish_reason: "tool_calls",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwopus3.6-27b-v2-mlx",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools(
			{ messages: [{ role: "user", content: "next step" }] },
			[{ name: "run_command", description: "Run a command", parameters: { type: "object" } }],
			{ toolChoice: "required" },
		);
		expect(result.toolCalls).toEqual([{ id: "ok", name: "run_command", arguments: { command: "cat FACT.txt" } }]);
	});

	it("defaults tool_choice to auto when opts is omitted (byte-identical to prior behavior)", async () => {
		const fetchImpl = vi.fn(async () => toolCallResponse());
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await client.completeWithTools({ messages: [{ role: "user", content: "read it" }] }, [
			{ name: "read_file", description: "Read a file", parameters: { type: "object" } },
		]);
		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.tool_choice).toBe("auto");
	});

	it("ignores toolChoice:required when no tools are offered (nothing to force)", async () => {
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
		await client.completeWithTools({ messages: [{ role: "user", content: "hi" }] }, [], { toolChoice: "required" });
		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body.tools).toBeUndefined();
		expect(body.tool_choice).toBeUndefined();
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

	it("recovers a NARRATED tool call from content when the model emits no structured tool_call (§5.Z chat-path parity)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content:
										'Sure, I will do that.\n<tool_call>\n{"name": "create_card", "arguments": {"title": "X"}}\n</tool_call>',
									tool_calls: [],
								},
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "phi",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "make a card" }] }, [
			{ name: "create_card", description: "Create a card", parameters: { type: "object" } },
		]);
		// The model narrated the call as text instead of a structured tool_call — recovered so the chat loop dispatches it.
		expect(result.toolCalls).toEqual([{ id: "narrated_0", name: "create_card", arguments: { title: "X" } }]);
	});

	it("§5.AB: REJECTS a narrated call whose tool was NOT offered this turn (force-advance steer must bind)", async () => {
		// The §5.AB loop-spin failure on qwopus3.6-27b: when we FORCE the next undone step with a REDUCED tool set
		// (already-done read_file EXCLUDED, tool_choice:"required"), the model kept narrating `read_file(...)` in a
		// tool_code block. Marker-based recovery used to land that read_file regardless of the offered set → the loop
		// deduped it → no progress. The recovery must reject a call to a tool we didn't offer this turn.
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									// Narrates read_file — but read_file is NOT in the offered set below (we're forcing the next step).
									content:
										'<tool_call>\n{"name": "read_file", "arguments": {"path": "FACT.txt"}}\n</tool_call>',
									tool_calls: [],
								},
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwopus3.6-27b-v2-mlx",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		// Offer ONLY create_card (read_file already done, excluded from the forced set).
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "next step" }] }, [
			{ name: "create_card", description: "Create a card", parameters: { type: "object" } },
		]);
		// read_file was narrated but not offered → rejected (no fabricated done-tool call to dedupe on).
		expect(result.toolCalls).toEqual([]);
	});

	it("recovers Gemma `tool_code` Python-call narration through the client seam (§5.Z e2e capstone dialect)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									// gemma-4-e2b's live e2e dialect: a Python `tool_code` call instead of a structured tool_call.
									content: 'tool_code = create_card(title="E2E-CARD-7777", prompt="from e2e")',
									tool_calls: [],
								},
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "gemma",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "make a card" }] }, [
			{ name: "create_card", description: "Create a card", parameters: { type: "object" } },
		]);
		expect(result.toolCalls).toEqual([
			{ id: "narrated_0", name: "create_card", arguments: { title: "E2E-CARD-7777", prompt: "from e2e" } },
		]);
	});

	it("recovers a Phi `[TOOL_REQUEST]` call narrated in reasoning_content (§5.Z reasoning channel + Phi format)", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									// phi-4 reasoning models put narration in `reasoning_content`, using the Microsoft `[TOOL_REQUEST]` form.
									reasoning_content:
										'I should call the tool.\n[TOOL_REQUEST]{"name": "create_card", "arguments": {"title": "DIAG"}}[END_TOOL_REQUEST]',
									tool_calls: [],
								},
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "microsoft/phi-4-mini-reasoning",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "make a card" }] }, [
			{ name: "create_card", description: "Create a card", parameters: { type: "object" } },
		]);
		expect(result.toolCalls).toEqual([{ id: "narrated_0", name: "create_card", arguments: { title: "DIAG" } }]);
	});

	it("does NOT recover narrated text when a structured call exists, or when no tools are offered", async () => {
		const narrated = '<tool_call>{"name": "create_card", "arguments": {}}</tool_call>';
		// (a) a structured tool_call is already present → the narrated content is ignored.
		const structured = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: narrated,
									tool_calls: [{ id: "c1", function: { name: "read_file", arguments: "{}" } }],
								},
								finish_reason: "tool_calls",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const clientA = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "m",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: structured as unknown as typeof fetch,
		});
		const resA = await clientA.completeWithTools({ messages: [{ role: "user", content: "x" }] }, [
			{ name: "read_file", description: "", parameters: { type: "object" } },
		]);
		expect(resA.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: {} }]);

		// (b) no tools were offered → a narrated call in a plain chat reply stays text (no recovery).
		const noTools = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ choices: [{ message: { content: narrated, tool_calls: [] }, finish_reason: "stop" }] }),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const clientB = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "m",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: noTools as unknown as typeof fetch,
		});
		const resB = await clientB.completeWithTools({ messages: [{ role: "user", content: "x" }] }, []);
		expect(resB.toolCalls).toEqual([]);
	});
});

describe("LocalLlmClient.completeStream", () => {
	it("retries an abort before the first visible chunk and emits only the recovered stream", async () => {
		const caller = new AbortController();
		const fetchImpl = vi.fn().mockRejectedValueOnce(abortError()).mockResolvedValueOnce(sseResponse("recovered"));
		const chunks: string[] = [];
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.completeStream(
			{ messages: [{ role: "user", content: "hi" }], signal: caller.signal },
			(delta) => chunks.push(delta),
		);
		expect(result.content).toBe("recovered");
		expect(chunks).toEqual(["recovered"]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("retries stream finish_reason:aborted when it arrived before visible content", async () => {
		const abortedPayload = JSON.stringify({ choices: [{ delta: {}, finish_reason: "aborted" }] });
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(`data: ${abortedPayload}\n\ndata: [DONE]\n\n`, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
			)
			.mockResolvedValueOnce(sseResponse("recovered"));
		const chunks: string[] = [];
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const result = await client.completeStream({ messages: [{ role: "user", content: "hi" }] }, (delta) =>
			chunks.push(delta),
		);
		expect(result.content).toBe("recovered");
		expect(chunks).toEqual(["recovered"]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("does not retry after a partial chunk was visible (no duplicated stream prefix)", async () => {
		const encoded = new TextEncoder().encode(
			`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: null }] })}\n\n`,
		);
		const fakeReader = {
			read: vi.fn().mockResolvedValueOnce({ done: false, value: encoded }).mockRejectedValueOnce(abortError()),
			cancel: vi.fn(async () => undefined),
		};
		const fakeResponse = { ok: true, status: 200, body: { getReader: () => fakeReader } } as unknown as Response;
		const fetchImpl = vi.fn(async () => fakeResponse);
		const chunks: string[] = [];
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.completeStream({ messages: [{ role: "user", content: "hi" }] }, (delta) => chunks.push(delta)),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(chunks).toEqual(["partial"]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fakeReader.cancel).toHaveBeenCalledTimes(1);
	});

	it("does not retry a stream canceled by the caller before output", async () => {
		const caller = new AbortController();
		const fetchImpl = vi.fn(async () => {
			caller.abort();
			throw abortError();
		});
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.completeStream({ messages: [{ role: "user", content: "hi" }], signal: caller.signal }, () => undefined),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("cancels the stream reader when a read errors mid-stream (no leaked reader/connection)", async () => {
		// Old finally only cleared the timeout, so a rejected reader.read() left the reader locked + the undici
		// socket checked out of the keep-alive pool until GC. The finally must reader.cancel() on the throw path.
		let cancelCalled = false;
		const fakeReader = {
			read: vi.fn().mockRejectedValue(new Error("read boom")),
			cancel: vi.fn(async () => {
				cancelCalled = true;
			}),
		};
		const fakeResponse = { ok: true, status: 200, body: { getReader: () => fakeReader } } as unknown as Response;
		const client = new LocalLlmClient({
			providerId: "lmstudio",
			modelId: "qwen",
			baseUrl: "http://127.0.0.1:1234",
			fetchImpl: (async () => fakeResponse) as unknown as typeof fetch,
		});
		await expect(client.completeStream({ messages: [{ role: "user", content: "hi" }] }, () => {})).rejects.toThrow();
		expect(cancelCalled).toBe(true);
	});
});
