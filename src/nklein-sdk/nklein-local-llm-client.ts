import { assertLocalProviderAllowed } from "./nklein-local-only-policy";

/**
 * !Klein-owned direct client for local OpenAI-compatible model servers (LM Studio / Ollama / llama.cpp).
 *
 * Why this exists: the bundled NKlein SDK drives the main agent loop, but its LLM layer only forwards
 * `temperature`/`max_tokens`/`stop` to the endpoint — it cannot send the levers that keep small/quantized
 * models reliable: grammar / JSON-schema **constrained decoding** (which *guarantees* valid structured output),
 * `min_p` (dynamic truncation that prevents incoherent generation, arXiv:2407.01082), `top_k`, or
 * `repetition_penalty` (loop suppression). Patching the SDK is forbidden (upstream-clean invariant), so this
 * is a separate, additive path !Klein controls. It does NOT replace the NKlein agent loop; it is used for
 * high-value *structured* operations (decomposition candidates, JSON tool-argument generation/repair, context
 * scoring) where constrained decoding matters most.
 *
 * LOCAL ONLY: every request funnels through `assertLocalProviderAllowed`, so this can never reach cloud.
 */

export interface LocalLlmSamplingOptions {
	/** Low (≈0.1–0.2) for deterministic coding/structured work on quantized models. */
	temperature?: number;
	topP?: number;
	topK?: number;
	/** Dynamic truncation; ≈0.05 keeps small models coherent at higher temperature (arXiv:2407.01082). */
	minP?: number;
	/** llama.cpp/LM Studio `repeat_penalty`; light (≈1.05–1.1) suppresses degenerate loops. */
	repetitionPenalty?: number;
	maxTokens?: number;
	stop?: string[];
}

export interface LocalLlmChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/** OpenAI-compatible `response_format`; also carries a raw llama.cpp `grammar` (GBNF) when provided. */
export interface LocalLlmStructuredFormat {
	/** A JSON Schema object constraining the output (sent as `response_format: json_schema`). */
	jsonSchema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
	/** A raw GBNF grammar string (llama.cpp server `grammar` field). */
	grammar?: string;
}

export interface LocalLlmClientConfig {
	providerId: string;
	modelId: string;
	baseUrl: string;
	apiKey?: string | null;
	/** Injected for testing; defaults to global fetch. */
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

export interface LocalLlmCompletionRequest {
	messages: LocalLlmChatMessage[];
	sampling?: LocalLlmSamplingOptions;
	format?: LocalLlmStructuredFormat;
	signal?: AbortSignal;
}

export interface LocalLlmCompletion {
	content: string;
	finishReason: string | null;
	raw: unknown;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/u, "");
	// Accept both ".../v1" and bare host; the OpenAI route is "/chat/completions" under the v1 base.
	return /\/v\d+$/u.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export class LocalLlmRequestError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null) {
		super(message);
		this.name = "LocalLlmRequestError";
		this.status = status;
	}
}

export class LocalLlmClient {
	private readonly config: LocalLlmClientConfig;
	private readonly fetchImpl: typeof fetch;

	constructor(config: LocalLlmClientConfig) {
		// Fail-closed against cloud before any network work.
		assertLocalProviderAllowed({ providerId: config.providerId, baseUrl: config.baseUrl });
		this.config = config;
		this.fetchImpl = config.fetchImpl ?? fetch;
	}

	private buildBody(request: LocalLlmCompletionRequest): Record<string, unknown> {
		const sampling = request.sampling ?? {};
		const body: Record<string, unknown> = {
			model: this.config.modelId,
			messages: request.messages,
			stream: false,
		};
		if (sampling.temperature !== undefined) body.temperature = sampling.temperature;
		if (sampling.topP !== undefined) body.top_p = sampling.topP;
		if (sampling.topK !== undefined) body.top_k = sampling.topK;
		if (sampling.minP !== undefined) body.min_p = sampling.minP;
		if (sampling.repetitionPenalty !== undefined) body.repeat_penalty = sampling.repetitionPenalty;
		if (sampling.maxTokens !== undefined) body.max_tokens = sampling.maxTokens;
		if (sampling.stop && sampling.stop.length > 0) body.stop = sampling.stop;
		if (request.format?.jsonSchema) {
			body.response_format = {
				type: "json_schema",
				json_schema: {
					name: request.format.jsonSchema.name,
					schema: request.format.jsonSchema.schema,
					strict: request.format.jsonSchema.strict ?? true,
				},
			};
		}
		if (request.format?.grammar) {
			// llama.cpp server honors a top-level `grammar`; harmless to servers that ignore it.
			body.grammar = request.format.grammar;
		}
		return body;
	}

	async complete(request: LocalLlmCompletionRequest): Promise<LocalLlmCompletion> {
		const url = `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const signal = request.signal ? anySignal([request.signal, controller.signal]) : controller.signal;
		try {
			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(this.config.apiKey?.trim() ? { authorization: `Bearer ${this.config.apiKey.trim()}` } : {}),
				},
				body: JSON.stringify(this.buildBody(request)),
				signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new LocalLlmRequestError(
					`Local model request failed (${response.status}): ${text.slice(0, 500)}`,
					response.status,
				);
			}
			const json = (await response.json()) as {
				choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
			};
			const choice = json.choices?.[0];
			return {
				content: choice?.message?.content ?? "",
				finishReason: choice?.finish_reason ?? null,
				raw: json,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Generates a JSON object constrained to `jsonSchema`, parsed/validated by `parse`. Constrained decoding
	 * makes this reliable even on small models; `parse` (e.g. a zod `.parse`) is the post-hoc guarantee. On a
	 * parse failure, retries once with a corrective instruction (reflection).
	 */
	async generateStructured<T>(input: {
		messages: LocalLlmChatMessage[];
		jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
		grammar?: string;
		parse: (value: unknown) => T;
		sampling?: LocalLlmSamplingOptions;
		signal?: AbortSignal;
	}): Promise<T> {
		const format: LocalLlmStructuredFormat = {
			jsonSchema: input.jsonSchema,
			...(input.grammar ? { grammar: input.grammar } : {}),
		};
		const sampling: LocalLlmSamplingOptions = { temperature: 0.1, ...input.sampling };
		const first = await this.complete({ messages: input.messages, sampling, format, signal: input.signal });
		const firstParsed = tryParseJson(first.content);
		if (firstParsed.ok) {
			return input.parse(firstParsed.value);
		}
		const retryMessages: LocalLlmChatMessage[] = [
			...input.messages,
			{ role: "assistant", content: first.content },
			{
				role: "user",
				content:
					"Your previous reply was not valid JSON for the required schema. Reply again with ONLY the JSON object that matches the schema — no prose, no code fences.",
			},
		];
		const second = await this.complete({ messages: retryMessages, sampling, format, signal: input.signal });
		const secondParsed = tryParseJson(second.content);
		if (!secondParsed.ok) {
			throw new LocalLlmRequestError(
				`Local model did not return valid JSON for schema "${input.jsonSchema.name}" after a retry.`,
				null,
			);
		}
		return input.parse(secondParsed.value);
	}

	/**
	 * Streaming chat completion: posts with `stream: true`, parses the OpenAI-style SSE deltas, invoking `onChunk`
	 * for each content delta and returning the accumulated reply. Lets the chat REPL show tokens as they arrive.
	 */
	async completeStream(
		request: LocalLlmCompletionRequest,
		onChunk: (delta: string) => void,
	): Promise<LocalLlmCompletion> {
		const url = `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const signal = request.signal ? anySignal([request.signal, controller.signal]) : controller.signal;
		try {
			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(this.config.apiKey?.trim() ? { authorization: `Bearer ${this.config.apiKey.trim()}` } : {}),
				},
				body: JSON.stringify({ ...this.buildBody(request), stream: true }),
				signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new LocalLlmRequestError(
					`Local model request failed (${response.status}): ${text.slice(0, 500)}`,
					response.status,
				);
			}
			const body = response.body;
			if (!body) {
				throw new LocalLlmRequestError("Streaming response had no body.", response.status);
			}
			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let content = "";
			let finishReason: string | null = null;
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) {
						continue;
					}
					const data = trimmed.slice(5).trim();
					if (data === "[DONE]") {
						continue;
					}
					try {
						const json = JSON.parse(data) as {
							choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
						};
						const choice = json.choices?.[0];
						const delta = choice?.delta?.content;
						if (delta) {
							content += delta;
							onChunk(delta);
						}
						if (choice?.finish_reason) {
							finishReason = choice.finish_reason;
						}
					} catch {
						// Skip a malformed SSE line rather than failing the stream.
					}
				}
			}
			return { content, finishReason, raw: null };
		} finally {
			clearTimeout(timeout);
		}
	}
}

function tryParseJson(content: string): { ok: true; value: unknown } | { ok: false } {
	const trimmed = content
		.trim()
		.replace(/^```(?:json)?\n?/u, "")
		.replace(/```$/u, "")
		.trim();
	try {
		return { ok: true, value: JSON.parse(trimmed) };
	} catch {
		// Recover a JSON object/array embedded in surrounding prose.
		const start = trimmed.search(/[[{]/u);
		const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
		if (start >= 0 && end > start) {
			try {
				return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
			} catch {
				return { ok: false };
			}
		}
		return { ok: false };
	}
}

function anySignal(signals: AbortSignal[]): AbortSignal {
	const controller = new AbortController();
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort();
			break;
		}
		signal.addEventListener("abort", () => controller.abort(), { once: true });
	}
	return controller.signal;
}
