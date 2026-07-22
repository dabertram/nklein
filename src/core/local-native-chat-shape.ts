/**
 * §5.AB endpoint-iteration — the PURE wire-shape core for the `native_v1_chat` endpoint kind: LM Studio's native
 * `/api/v1/chat` "Responses"-style surface.
 *
 * ✅ LIVE-PROBED CONTRACT (2026-07-22, LM Studio 0.4.x, qwen3.6-35b-a3b — F4.34 refresh):
 *   - REQUEST: `{ model, input: string, system_prompt?, max_output_tokens, ... }`. Native chat does not accept prior
 *     assistant messages as structured input, so callers still merge legacy history into one text input; system text
 *     now uses the dedicated field. `stream:true` selects named SSE events.
 *   - RESPONSE (200): `{ model_instance_id, output: [{ type: "reasoning" | "message", content }], response_id,
 *     stats: { input_tokens, total_output_tokens, reasoning_output_tokens, tokens_per_second,
 *     time_to_first_token_seconds } }`. MCP-backed tool calls use `{type:"tool_call",tool,arguments,output,
 *     provider_info}`. Arbitrary custom tool schemas remain unsupported; only configured MCP integrations belong here.
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
	stream?: boolean;
	reasoning?: "off" | "low" | "medium" | "high" | "on";
	contextLength?: number;
	store?: boolean;
	previousResponseId?: string;
	/** Preconfigured LM Studio MCP integrations only. Remote per-request MCPs are intentionally not exposed by !Klein. */
	integrations?: readonly (string | { type: "plugin"; id: string; allowed_tools?: readonly string[] })[];
}

export interface NativeChatRequestBody {
	model: string;
	max_output_tokens: number;
	input: string;
	system_prompt?: string;
	temperature?: number;
	stream?: boolean;
	reasoning?: "off" | "low" | "medium" | "high" | "on";
	context_length?: number;
	store?: boolean;
	previous_response_id?: string;
	integrations?: Array<string | { type: "plugin"; id: string; allowed_tools?: string[] }>;
}

/**
 * Build a native `/api/v1/chat` request. System messages use `system_prompt`; every remaining turn is merged into the
 * one native input string. Assistant history is explicitly labeled because this endpoint cannot take assistant items.
 */
export function buildNativeChatRequest(input: NativeChatRequestInput): NativeChatRequestBody {
	const systemPrompt = input.messages
		.filter((message) => message.role === "system")
		.map((message) => message.content)
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
	const merged = input.messages
		.filter((message) => message.role !== "system")
		.map((message) => (message.role === "user" ? message.content : `[assistant]\n${message.content}`))
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
	const body: NativeChatRequestBody = {
		model: input.model,
		max_output_tokens: input.maxOutputTokens,
		input: merged,
	};
	if (systemPrompt) body.system_prompt = systemPrompt;
	if (typeof input.temperature === "number") {
		body.temperature = input.temperature;
	}
	if (input.stream !== undefined) body.stream = input.stream;
	if (input.reasoning !== undefined) body.reasoning = input.reasoning;
	if (input.contextLength !== undefined) body.context_length = input.contextLength;
	if (input.store !== undefined) body.store = input.store;
	if (input.previousResponseId !== undefined) body.previous_response_id = input.previousResponseId;
	if (input.integrations !== undefined) {
		body.integrations = input.integrations.map((integration) =>
			typeof integration === "string"
				? integration
				: {
						type: "plugin" as const,
						id: integration.id,
						...(integration.allowed_tools ? { allowed_tools: [...integration.allowed_tools] } : {}),
					},
		);
	}
	return body;
}

export interface NativeToolProviderInfo {
	type: "plugin" | "ephemeral_mcp" | "unknown";
	pluginId: string | null;
	serverLabel: string | null;
}

export interface ParsedNativeToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
	output: string | null;
	provider: NativeToolProviderInfo | null;
}

export interface ParsedNativeInvalidToolCall {
	reason: string;
	kind: "invalid_name" | "invalid_arguments" | "unknown";
	toolName: string;
	args: Record<string, unknown>;
	provider: NativeToolProviderInfo | null;
}

export interface NativeChatStats {
	inputTokens: number | null;
	totalOutputTokens: number | null;
	reasoningOutputTokens: number | null;
	tokensPerSecond: number | null;
	timeToFirstTokenSeconds: number | null;
	modelLoadTimeSeconds: number | null;
}

export interface ParsedNativeChatResponse {
	/** The assistant's answer text (`output[].type === "message"` items, joined). */
	text: string;
	/** The reasoning channel (`output[].type === "reasoning"` items, joined). */
	reasoning: string;
	/** MCP-backed tool calls, including arguments, result, and provider identity. */
	toolCalls: ParsedNativeToolCall[];
	invalidToolCalls: ParsedNativeInvalidToolCall[];
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
		invalidToolCalls: [],
		responseId: null,
		modelInstanceId: null,
		stats: {
			inputTokens: null,
			totalOutputTokens: null,
			reasoningOutputTokens: null,
			tokensPerSecond: null,
			timeToFirstTokenSeconds: null,
			modelLoadTimeSeconds: null,
		},
	};
	const record = asRecord(body);
	if (!record) {
		return empty;
	}
	const textParts: string[] = [];
	const reasoningParts: string[] = [];
	const toolCalls: ParsedNativeToolCall[] = [];
	const invalidToolCalls: ParsedNativeInvalidToolCall[] = [];
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
		} else if (item.type === "tool_call") {
			const name =
				(typeof item.tool === "string" && item.tool) ||
				(typeof item.name === "string" && item.name) ||
				(typeof (asRecord(item.function)?.name as unknown) === "string" &&
					(asRecord(item.function)?.name as string)) ||
				"";
			if (name) {
				toolCalls.push({
					id: typeof item.id === "string" ? item.id : "",
					name,
					args: coerceArgs(item.arguments ?? asRecord(item.function)?.arguments),
					output: typeof item.output === "string" ? item.output : null,
					provider: parseProviderInfo(item.provider_info),
				});
			}
		} else if (item.type === "invalid_tool_call") {
			const metadata = asRecord(item.metadata) ?? {};
			const kind =
				metadata.type === "invalid_name" || metadata.type === "invalid_arguments" ? metadata.type : "unknown";
			invalidToolCalls.push({
				reason: typeof item.reason === "string" ? item.reason : "",
				kind,
				toolName: typeof metadata.tool_name === "string" ? metadata.tool_name : "",
				args: coerceArgs(metadata.arguments),
				provider: parseProviderInfo(metadata.provider_info),
			});
		}
	}
	const stats = asRecord(record.stats) ?? {};
	return {
		text: textParts.join("\n"),
		reasoning: reasoningParts.join("\n"),
		toolCalls,
		invalidToolCalls,
		responseId: typeof record.response_id === "string" ? record.response_id : null,
		modelInstanceId: typeof record.model_instance_id === "string" ? record.model_instance_id : null,
		stats: {
			inputTokens: numberOrNull(stats.input_tokens),
			totalOutputTokens: numberOrNull(stats.total_output_tokens),
			reasoningOutputTokens: numberOrNull(stats.reasoning_output_tokens),
			tokensPerSecond: numberOrNull(stats.tokens_per_second),
			timeToFirstTokenSeconds: numberOrNull(stats.time_to_first_token_seconds),
			modelLoadTimeSeconds: numberOrNull(stats.model_load_time_seconds),
		},
	};
}

function parseProviderInfo(value: unknown): NativeToolProviderInfo | null {
	const provider = asRecord(value);
	if (!provider) return null;
	return {
		type: provider.type === "plugin" || provider.type === "ephemeral_mcp" ? provider.type : "unknown",
		pluginId: typeof provider.plugin_id === "string" ? provider.plugin_id : null,
		serverLabel: typeof provider.server_label === "string" ? provider.server_label : null,
	};
}
