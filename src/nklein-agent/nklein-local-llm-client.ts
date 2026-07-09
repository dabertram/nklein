import { buildJsonSchemaResponseFormat } from "../core/lmstudio-response-format";
import { mergeSystemMessagesFirst } from "../core/normalize-system-first";
import { reasoningAndAnswerText } from "../core/reasoning-channel-split";
import { withTransientRetry } from "../core/transient-error";
import { assertLocalProviderAllowed } from "./nklein-local-only-policy";
import {
	parseNarratedToolCalls,
	parseToolValidatedNarration,
	resolveNarratedToolName,
} from "./nklein-narrated-tool-call";

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

/** An OpenAI-style function tool the model may call. `parameters` is a JSON Schema object. */
export interface LocalLlmToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface LocalLlmToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface LocalLlmToolCompletion {
	content: string;
	toolCalls: LocalLlmToolCall[];
	finishReason: string | null;
	/**
	 * §5.AN: reasoning tokens this turn consumed (`usage.completion_tokens_details.reasoning_tokens`, live-verified to
	 * track reasoning overhead — 1 with `/no_think`, 544 when truncating). Null when the endpoint didn't report it. A
	 * §5.AA signal: high reasoning relative to budget is the truncation / over-rumination case.
	 */
	reasoningTokens?: number | null;
	/** §5.M: total tokens this call consumed (`usage.total_tokens`) — null when the endpoint didn't report it. */
	totalTokens?: number | null;
	raw: unknown;
}

/** Parse a tool call's `arguments` (the OpenAI wire shape is a JSON *string*); malformed → empty object. */
function parseToolCallArguments(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === "object") {
		return raw as Record<string, unknown>;
	}
	if (typeof raw !== "string" || raw.trim().length === 0) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Per-request abort timeout for the interactive CHAT client (a fixed fallback, unlike the agent/task path which scales
 * from observed model speed via `applyMcsrAwareLocalTimeoutScaling`). Overridable via `NKLEIN_CHAT_REQUEST_TIMEOUT_MS`
 * so a slow regime (e.g. Low Power Mode ~50% throughput) doesn't abort a long reasoning reply prematurely.
 */
function resolveChatRequestTimeoutMs(): number {
	const raw = Number(process.env.NKLEIN_CHAT_REQUEST_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 120_000;
}
const DEFAULT_TIMEOUT_MS = resolveChatRequestTimeoutMs();

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
			// Consolidate all system content into ONE leading system message (§5.AA recover-in-!Klein): some models ship a
			// strict Jinja template that 400s when a system message isn't first (live-found: qwopus3.5-9b-coder-mtp's
			// `raise_exception('System message must be at the beginning')`). No-op for the already-system-first common case.
			messages: mergeSystemMessagesFirst(request.messages),
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
			// §5.AN: validate the json_schema response_format OFFLINE via the shared builder instead of assembling it
			// blind. LM Studio SILENTLY rejects an illegal schema name or a strict schema missing
			// additionalProperties:false / with an incomplete `required` — an empty/failed completion that wastes a
			// live model turn. Surface it as a pre-flight error (before any network call) with the machine-stable
			// code@path. On success the envelope is byte-identical to the old inline literal.
			const built = buildJsonSchemaResponseFormat({
				name: request.format.jsonSchema.name,
				schema: request.format.jsonSchema.schema,
				options: { strict: request.format.jsonSchema.strict ?? true },
			});
			if (!built.ok) {
				throw new LocalLlmRequestError(
					`invalid json_schema response_format: ${built.errors.map((error) => `${error.code}@${error.path}`).join(", ")}`,
					null,
				);
			}
			body.response_format = built.responseFormat;
		}
		if (request.format?.grammar) {
			// llama.cpp server honors a top-level `grammar`; harmless to servers that ignore it.
			body.grammar = request.format.grammar;
		}
		return body;
	}

	async complete(request: LocalLlmCompletionRequest): Promise<LocalLlmCompletion> {
		const url = `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
		// §5.AF transient survivability: retry only TRANSIENT failures (undici timeout / connection blip / 5xx),
		// bounded, with a FRESH internal timeout per attempt. A caller-cancel or our hard-timeout abort is not transient
		// ⇒ not retried; a successful call returns on the first attempt (behavior unchanged).
		const attempt = async (): Promise<LocalLlmCompletion> => {
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
		};
		return withTransientRetry(attempt, { maxRetries: 2 });
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
			// generateStructured does its OWN JSON recovery + retry, so it doesn't need LM Studio's STRICT enforcement
			// (which additionally rejects a schema lacking additionalProperties:false / a complete `required`) — default
			// strict OFF here so a tolerant schema isn't silently rejected upstream; a caller can still opt into strict.
			jsonSchema: { ...input.jsonSchema, strict: input.jsonSchema.strict ?? false },
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
		// Hoisted so the finally can release it: if reader.read() rejects (abort/timeout/network error mid-stream),
		// the throw unwinds straight past the read loop and the reader would otherwise keep its lock on the response
		// body — leaving the undici socket checked out of the keep-alive pool until GC.
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
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
			reader = body.getReader();
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
			// Release the reader on EVERY exit — most importantly the throw path (a rejected reader.read() unwinds
			// here). cancel() releases the lock and signals the producer to stop, returning the undici socket to the
			// keep-alive pool instead of leaking it until GC. No-op on the already-drained success path.
			reader?.cancel().catch(() => {});
		}
	}

	/**
	 * Tools-aware completion: offers the model the given function `tools` and parses any `tool_calls` it returns
	 * (arguments decoded from their JSON-string wire form). With an empty `tools` list this is a plain completion. The
	 * agent loop drives this; recovery of non-OpenAI tool-call formats stays the `afterModel`/`recoverNarratedToolCalls`
	 * concern of the full NKlein agent (§5.O).
	 *
	 * `tool_choice` defaults to `"auto"` when tools are present (unchanged behavior). Pass `opts.toolChoice:"required"`
	 * to FORCE a call — the §5.AA/§5.AN native-forcing lever for REASONING models, where `response_format:json_schema`
	 * dead-ends to empty content but `tool_choice:"required"` lands a valid call in the separate `tool_calls` channel
	 * (live-verified 2026-07-01). Ignored when no tools are offered (there is nothing to force).
	 */
	async completeWithTools(
		request: LocalLlmCompletionRequest,
		tools: readonly LocalLlmToolDefinition[],
		opts?: { toolChoice?: "auto" | "required" },
	): Promise<LocalLlmToolCompletion> {
		const url = `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const signal = request.signal ? anySignal([request.signal, controller.signal]) : controller.signal;
		try {
			const body: Record<string, unknown> = { ...this.buildBody(request) };
			if (tools.length > 0) {
				body.tools = tools.map((tool) => ({
					type: "function",
					function: { name: tool.name, description: tool.description, parameters: tool.parameters },
				}));
				body.tool_choice = opts?.toolChoice ?? "auto";
			}
			const response = await this.fetchImpl(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(this.config.apiKey?.trim() ? { authorization: `Bearer ${this.config.apiKey.trim()}` } : {}),
				},
				body: JSON.stringify(body),
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
				choices?: Array<{
					message?: {
						content?: string;
						reasoning_content?: string;
						tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
					};
					finish_reason?: string | null;
				}>;
				usage?: { total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
			};
			const choice = json.choices?.[0];
			let toolCalls: LocalLlmToolCall[] = (choice?.message?.tool_calls ?? [])
				.map((call, index) => ({
					id: call.id ?? `call_${index}`,
					name: call.function?.name ?? "",
					arguments: parseToolCallArguments(call.function?.arguments),
				}))
				.filter((call) => call.name.length > 0);
			// §5.Z: the chat path has no `afterModel` hook, so recover a NARRATED tool call here. When tools were offered
			// but the model returned NO structured tool_call, a weak/quantized model may have printed the call as text in
			// its content OR its reasoning channel (Hermes/Qwen/Llama/Mistral/DeepSeek/Phi-`[TOOL_REQUEST]`/… formats) —
			// reasoning models (phi-4-reasoning, deepseek-r1) put it in `reasoning_content`. Mirror the swarm path's
			// recoverNarratedToolCalls so those models drive chat tools too (todo §5.O: recover, don't re-prompt the model).
			// §5.AB: `tool_choice:"required"` is meant to force a call FROM THE OFFERED SET, but the LM Studio/MLX endpoint
			// does NOT constrain to `tools` — a fixated reasoning model returns a STRUCTURED call for an un-offered tool
			// (live 2026-07-01: offered ONLY run_command, qwopus3.6-27b returned a structured read_file). On the force path
			// we offer exactly the next undone tool, so a call naming anything else is off-menu — drop it, else it would
			// dedupe to "no progress" and stall the chain. Scoped to the forced path so the normal `auto` turn is untouched.
			if (opts?.toolChoice === "required" && toolCalls.length > 0) {
				const offeredNames = new Set(tools.map((tool) => tool.name));
				toolCalls = toolCalls.filter((call) => offeredNames.has(call.name));
			}
			if (toolCalls.length === 0 && tools.length > 0) {
				// §5.AN: scan BOTH channels for a narrated call via the shared reasoning-channel-split core — this now also
				// surfaces an inline-`<think>` model's reasoning (the old concat only saw the SEPARATE reasoning_content field).
				const narratable = reasoningAndAnswerText({
					content: choice?.message?.content,
					reasoning_content: choice?.message?.reasoning_content,
				});
				let recovered = parseNarratedToolCalls(narratable);
				// §5.AA last tier (2026-06-29): small models (≤4B: nemotron-4b, gemma) narrate a `{"tool":…,"parameters":…}`
				// object with NO recognized marker. Recover it SAFELY by validating the tool name against the offered set.
				if (recovered.length === 0) {
					recovered = parseToolValidatedNarration(
						narratable,
						tools.map((tool) => tool.name),
					);
				}
				// §5.AB: a recovered call must name a tool we actually OFFERED this turn. Marker-based recovery
				// (parseNarratedToolCalls) doesn't validate against the offered set, so a model that narrates a call to a
				// tool we deliberately did NOT offer would otherwise land it. That defeats the force-advance steer: when we
				// FORCE the next step with a REDUCED tool set (already-done tools excluded, tool_choice:"required"), a
				// reasoning model that keeps narrating the done tool (live: qwopus3.6-27b re-narrated `read_file(...)` after
				// run_command) must be rejected so the loop dedupe doesn't collapse it to "no progress". On a normal turn all
				// real tools are offered, so nothing legitimate is dropped — this only bites the excluded-tool case.
				const offeredNames = tools.map((tool) => tool.name);
				const structuredOfferedNames = new Set(offeredNames);
				toolCalls = recovered.flatMap((call, index) => {
					const resolvedToolName = resolveNarratedToolName(call.toolName, offeredNames);
					if (!resolvedToolName || !structuredOfferedNames.has(resolvedToolName)) {
						return [];
					}
					return [
						{
							id: `narrated_${index}`,
							name: resolvedToolName,
							arguments: parseToolCallArguments(call.input),
						},
					];
				});
			}
			return {
				content: choice?.message?.content ?? "",
				toolCalls,
				finishReason: choice?.finish_reason ?? null,
				reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? null,
				totalTokens: json.usage?.total_tokens ?? null,
				raw: json,
			};
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
		// Recover a JSON object/array embedded in surrounding prose. NOTE: this first-bracket..last-bracket span is
		// deliberately kept simple — a prose bracket before the JSON makes it fail to parse, but generateStructured's
		// RETRY (ask for JSON-only) is the safety net, so a first-attempt miss is recovered without data loss. A robust
		// largest-balanced-span recovery would avoid the extra retry but risks picking prose that is itself valid JSON
		// (e.g. a "[1]" citation) and throwing before the retry can run — not worth the regression here.
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
	// Native AbortSignal.any manages the input-signal listeners internally (weak references, removed once the derived
	// signal is unreferenced after the fetch settles) and preserves the aborting reason. The prior manual
	// addEventListener("abort", …, {once:true}) LEAKED: {once:true} removes the listener only if that signal actually
	// aborts, so on a normal exit (or when only the internal per-attempt timeout controller aborts, never
	// request.signal) the listener on a reused, long-lived request.signal is never removed — one dead listener
	// accumulates per turn (×2 per structured generation), growing unbounded over a session.
	return AbortSignal.any(signals);
}
