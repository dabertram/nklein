/**
 * §5.AB endpoint-iteration — the PURE wire-shape core for the `native_v1_chat` endpoint kind: LM Studio's native
 * `/api/v1/chat` "Responses"-style surface.
 *
 * ✅ LIVE-PROBED CONTRACT (2026-07-19, LM Studio 0.3.x, ministral-3-14b — F4.33 rewrite):
 *   - REQUEST: `{ model, input: [{ type: "text" | "image", content }], max_output_tokens, temperature? }`.
 *     The input discriminator accepts ONLY `text`/`image` (probed 400: "Expected 'text' | 'image'"); `messages`
 *     and `max_tokens` are rejected. EVERY `text` item becomes its own USER turn server-side — two text items
 *     500'd the Mistral Jinja template with the alternation error — so the builder MERGES all prompt text into
 *     ONE item (same rule as mergeConsecutiveSameRoleSdkMessages) and system framing rides inline.
 *   - RESPONSE (200): `{ model_instance_id, output: [{ type: "reasoning" | "message", content }], response_id,
 *     stats: { input_tokens, total_output_tokens, reasoning_output_tokens, tokens_per_second,
 *     time_to_first_token_seconds } }` — both output item types captured live; `response_id` is the chainable id
 *     the F4.45 gate verifies. Tool-call output items remain unobserved on this surface (F4.34 probes them);
 *     the parser accepts a `tool_call`-shaped item defensively without guessing beyond name/arguments.
 *
 * Pure + total + defensive: an unrecognized body parses to empty channels, never throws.
 */

/** A neutral chat message (role + text) — folded into the single-item native input by the builder. */
export interface NativeChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface NativeChatRequestInput {
	model: string;
	/** Native key `max_output_tokens` (the OpenAI `max_tokens` key is rejected by this surface). */
	maxOutputTokens: number;
	messages: readonly NativeChatMessage[];
	temperature?: number;
}

export interface NativeChatRequestBody {
	model: string;
	max_output_tokens: number;
	input: Array<{ type: "text"; content: string }>;
	temperature?: number;
}

/**
 * Build a native `/api/v1/chat` request. All messages MERGE into ONE `text` input item (each item is its own
 * user turn server-side; two items breaks Mistral-family alternation templates — live-probed 500). Non-user
 * roles are labeled inline so the model still sees the framing.
 */
export function buildNativeChatRequest(input: NativeChatRequestInput): NativeChatRequestBody {
	const merged = input.messages
		.map((message) => (message.role === "user" ? message.content : `[${message.role}]\n${message.content}`))
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
	const body: NativeChatRequestBody = {
		model: input.model,
		max_output_tokens: input.maxOutputTokens,
		input: [{ type: "text", content: merged }],
	};
	if (typeof input.temperature === "number") {
		body.temperature = input.temperature;
	}
	return body;
}

export interface ParsedNativeToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface NativeChatStats {
	inputTokens: number | null;
	totalOutputTokens: number | null;
	reasoningOutputTokens: number | null;
	tokensPerSecond: number | null;
	timeToFirstTokenSeconds: number | null;
}

export interface ParsedNativeChatResponse {
	/** The assistant's answer text (`output[].type === "message"` items, joined). */
	text: string;
	/** The reasoning channel (`output[].type === "reasoning"` items, joined). */
	reasoning: string;
	/** Structured tool calls, when the surface emits them (unobserved so far — parsed defensively). */
	toolCalls: ParsedNativeToolCall[];
	/** The chainable response id (`response_id`) — the F4.45 stateful-adoption key. */
	responseId: string | null;
	/** The serving instance (`model_instance_id`). */
	modelInstanceId: string | null;
	stats: NativeChatStats;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Coerce a tool-call `arguments` field (JSON string or object) into an object. */
function coerceArgs(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			return asRecord(JSON.parse(value)) ?? {};
		} catch {
			return {};
		}
	}
	return asRecord(value) ?? {};
}

/**
 * Parse a native `/api/v1/chat` 200 body. Splits `output[]` by item type — `message` → text, `reasoning` →
 * reasoning, a `tool_call`-ish item (type contains "tool", carries a name) → toolCalls. Never throws; an
 * unrecognized body yields empty channels and null ids/stats.
 */
export function parseNativeChatResponse(body: unknown): ParsedNativeChatResponse {
	const empty: ParsedNativeChatResponse = {
		text: "",
		reasoning: "",
		toolCalls: [],
		responseId: null,
		modelInstanceId: null,
		stats: {
			inputTokens: null,
			totalOutputTokens: null,
			reasoningOutputTokens: null,
			tokensPerSecond: null,
			timeToFirstTokenSeconds: null,
		},
	};
	const record = asRecord(body);
	if (!record) {
		return empty;
	}
	const textParts: string[] = [];
	const reasoningParts: string[] = [];
	const toolCalls: ParsedNativeToolCall[] = [];
	const output = Array.isArray(record.output) ? record.output : [];
	for (const rawItem of output) {
		const item = asRecord(rawItem);
		if (!item || typeof item.type !== "string") {
			continue;
		}
		if (item.type === "message" && typeof item.content === "string") {
			textParts.push(item.content);
		} else if (item.type === "reasoning" && typeof item.content === "string") {
			reasoningParts.push(item.content);
		} else if (item.type.includes("tool")) {
			const name =
				(typeof item.name === "string" && item.name) ||
				(typeof (asRecord(item.function)?.name as unknown) === "string" &&
					(asRecord(item.function)?.name as string)) ||
				"";
			if (name) {
				toolCalls.push({
					id: typeof item.id === "string" ? item.id : "",
					name,
					args: coerceArgs(item.arguments ?? asRecord(item.function)?.arguments),
				});
			}
		}
	}
	const stats = asRecord(record.stats) ?? {};
	return {
		text: textParts.join("\n"),
		reasoning: reasoningParts.join("\n"),
		toolCalls,
		responseId: typeof record.response_id === "string" ? record.response_id : null,
		modelInstanceId: typeof record.model_instance_id === "string" ? record.model_instance_id : null,
		stats: {
			inputTokens: numberOrNull(stats.input_tokens),
			totalOutputTokens: numberOrNull(stats.total_output_tokens),
			reasoningOutputTokens: numberOrNull(stats.reasoning_output_tokens),
			tokensPerSecond: numberOrNull(stats.tokens_per_second),
			timeToFirstTokenSeconds: numberOrNull(stats.time_to_first_token_seconds),
		},
	};
}
