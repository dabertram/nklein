/**
 * §5.AB endpoint-iteration — the PURE wire-shape core for the `native_v1_chat` endpoint kind: a local model server's
 * native `/api/v1/chat` surface that exposes STRUCTURED `tool_call.*` + `reasoning.*` fields (LM Studio / llama.cpp
 * native), which parse more reliably on weak models than OpenAI's text-embedded tool calls. The exact envelope varies
 * across servers/quants, so the parser here is DELIBERATELY DEFENSIVE + MULTI-SHAPE: it recognizes the common structured
 * variants and returns what it can, never throwing and never guessing content it didn't see — the caller's retry ladder
 * handles a shape it can't read. The live endpoint confirms which variant a given server actually emits.
 *
 * Owned: (a) build a request body (OpenAI-compatible field names, which the native surface accepts); (b) parse a
 * response into extracted text + reasoning + structured tool calls. Pure + total + defensive.
 */

/** A neutral chat message (role + text). */
export interface NativeChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/** A neutral tool definition — emitted in the OpenAI-compatible `tools[].function` shape the native surface accepts. */
export interface NativeToolDefinition {
	name: string;
	description?: string;
	parameters: Record<string, unknown>;
}

export interface NativeChatRequestInput {
	model: string;
	maxTokens: number;
	messages: readonly NativeChatMessage[];
	tools?: readonly NativeToolDefinition[];
	temperature?: number;
	/** Force a tool call (`tool_choice:"required"`) when a call must be produced. */
	forceToolUse?: boolean;
}

export interface NativeChatRequestBody {
	model: string;
	max_tokens: number;
	messages: Array<{ role: string; content: string }>;
	tools?: Array<{
		type: "function";
		function: { name: string; description?: string; parameters: Record<string, unknown> };
	}>;
	tool_choice?: "required" | "auto";
	temperature?: number;
}

/** Build a native `/api/v1/chat` request body (OpenAI-compatible field names). `forceToolUse` → `tool_choice:"required"`. */
export function buildNativeChatRequest(input: NativeChatRequestInput): NativeChatRequestBody {
	const body: NativeChatRequestBody = {
		model: input.model,
		max_tokens: input.maxTokens,
		messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
	};
	if (typeof input.temperature === "number") {
		body.temperature = input.temperature;
	}
	if (input.tools && input.tools.length > 0) {
		body.tools = input.tools.map((tool) => ({
			type: "function" as const,
			function: {
				name: tool.name,
				...(tool.description ? { description: tool.description } : {}),
				parameters: tool.parameters,
			},
		}));
		body.tool_choice = input.forceToolUse ? "required" : "auto";
	}
	return body;
}

export interface ParsedNativeToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ParsedNativeChatResponse {
	/** The assistant's answer text. */
	text: string;
	/** The model's separate REASONING channel (`reasoning`/`reasoning_content`/`thinking`), when the server exposes one. */
	reasoning: string;
	/** Every structured tool call, in order. */
	toolCalls: ParsedNativeToolCall[];
	/** The finish/stop reason, when present. */
	finishReason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return "";
}

/** Coerce a tool-call `arguments` field (a JSON STRING per OpenAI, or an already-parsed object) into an object. */
function coerceArgs(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return asRecord(parsed) ?? {};
		} catch {
			return {};
		}
	}
	return asRecord(value) ?? {};
}

/** Extract structured tool calls from either the OpenAI-style `tool_calls[]` array or a singular native `tool_call`. */
function extractToolCalls(source: Record<string, unknown>): ParsedNativeToolCall[] {
	const calls: ParsedNativeToolCall[] = [];
	const array = Array.isArray(source.tool_calls) ? source.tool_calls : [];
	for (const rawCall of array) {
		const call = asRecord(rawCall);
		if (!call) {
			continue;
		}
		// OpenAI shape: { id, function: { name, arguments } }. Native flat shape: { id, name, arguments }.
		const fn = asRecord(call.function);
		const name = (typeof fn?.name === "string" && fn.name) || (typeof call.name === "string" && call.name) || "";
		if (!name) {
			continue;
		}
		const rawArgs = fn ? fn.arguments : call.arguments;
		calls.push({ id: typeof call.id === "string" ? call.id : "", name, args: coerceArgs(rawArgs) });
	}
	// Singular native `tool_call: { name, arguments }` (some servers emit one call this way).
	const singular = asRecord(source.tool_call);
	if (singular && typeof singular.name === "string" && singular.name.length > 0) {
		calls.push({
			id: typeof singular.id === "string" ? singular.id : "",
			name: singular.name,
			args: coerceArgs(singular.arguments),
		});
	}
	return calls;
}

/**
 * Parse a native `/api/v1/chat` response defensively across the common structured shapes: the OpenAI-compatible
 * `choices[0].message` envelope AND a flat top-level `message`/`content` shape. Extracts text, the reasoning channel
 * (`reasoning`/`reasoning_content`/`thinking`), and structured tool calls (`tool_calls[]` and/or singular `tool_call`).
 * Never throws; an unrecognized body yields empty text + reasoning + no tool calls.
 */
export function parseNativeChatResponse(body: unknown): ParsedNativeChatResponse {
	const empty: ParsedNativeChatResponse = { text: "", reasoning: "", toolCalls: [], finishReason: null };
	const record = asRecord(body);
	if (!record) {
		return empty;
	}
	// Resolve the message-bearing object: OpenAI `choices[0].message`, or a top-level `message`, or the record itself.
	const choice = Array.isArray(record.choices) ? asRecord(record.choices[0]) : null;
	const message = asRecord(choice?.message) ?? asRecord(record.message) ?? record;
	const finishReason =
		(typeof choice?.finish_reason === "string" && choice.finish_reason) ||
		(typeof record.finish_reason === "string" && record.finish_reason) ||
		(typeof record.stop_reason === "string" && record.stop_reason) ||
		null;

	return {
		text: firstString(message, ["content", "text"]),
		reasoning: firstString(message, ["reasoning", "reasoning_content", "thinking"]),
		toolCalls: extractToolCalls(message),
		finishReason,
	};
}
