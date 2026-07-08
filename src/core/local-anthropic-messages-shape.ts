/**
 * §5.AB endpoint-iteration — the PURE wire-shape core for the `anthropic_messages` endpoint kind (a LOCAL model server
 * that exposes an Anthropic-Messages-compatible `/v1/messages` surface, e.g. some llama.cpp / LM Studio configs). This
 * is NOT the managed cloud provider (the local-only guard confines that literal to boundary files) — it is the
 * request-serializer + response-parser for the Messages WIRE FORMAT, which is a documented, stable contract, so the
 * shaping is unit-provable here without a live server (the live endpoint only confirms the docs match reality).
 *
 * Owned: (a) build a `/v1/messages` request body from !Klein's neutral message/tool shape, with `tool_choice:{type:"any"}`
 * forcing when a call must be produced; (b) parse a `/v1/messages` response body into extracted text + structured tool
 * calls + the stop reason. The effectful HTTP client + live validation are the separate leaf that consumes this.
 * Pure + total + defensive (never throws on a malformed response — it returns what it can).
 */

/** A neutral chat message (role + text) — !Klein's internal shape, mapped to the Messages `messages[]` here. */
export interface NeutralChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/** A neutral tool definition — mapped to a Messages `tools[]` entry (`input_schema` is the JSON Schema of the args). */
export interface NeutralToolDefinition {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface AnthropicMessagesRequestInput {
	model: string;
	maxTokens: number;
	messages: readonly NeutralChatMessage[];
	tools?: readonly NeutralToolDefinition[];
	temperature?: number;
	/** Force a tool call this turn (`tool_choice:{type:"any"}`) — the strongest forcing lever for a stubborn model. */
	forceToolUse?: boolean;
}

/** The `/v1/messages` request body shape (only the fields !Klein sends). */
export interface AnthropicMessagesRequestBody {
	model: string;
	max_tokens: number;
	/** System prompt hoisted OUT of `messages` (the Messages API takes `system` at the top level, not as a role). */
	system?: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
	tool_choice?: { type: "any" } | { type: "auto" };
	temperature?: number;
}

/**
 * Build a `/v1/messages` request body. System messages are HOISTED into the top-level `system` field (the Messages API
 * has no `system` role — a system message left in `messages[]` is rejected); multiple system messages are joined. Tool
 * defs map to `{name, description?, input_schema}`. `forceToolUse` sets `tool_choice:{type:"any"}` (produce SOME tool
 * call); otherwise, when tools are offered, `tool_choice:{type:"auto"}` (may answer in prose).
 */
export function buildAnthropicMessagesRequest(input: AnthropicMessagesRequestInput): AnthropicMessagesRequestBody {
	const systemParts: string[] = [];
	const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
	for (const message of input.messages) {
		if (message.role === "system") {
			if (message.content.trim().length > 0) {
				systemParts.push(message.content);
			}
			continue;
		}
		messages.push({ role: message.role, content: message.content });
	}

	const body: AnthropicMessagesRequestBody = {
		model: input.model,
		max_tokens: input.maxTokens,
		messages,
	};
	if (systemParts.length > 0) {
		body.system = systemParts.join("\n\n");
	}
	if (typeof input.temperature === "number") {
		body.temperature = input.temperature;
	}
	if (input.tools && input.tools.length > 0) {
		body.tools = input.tools.map((tool) => ({
			name: tool.name,
			...(tool.description ? { description: tool.description } : {}),
			input_schema: tool.inputSchema,
		}));
		body.tool_choice = input.forceToolUse ? { type: "any" } : { type: "auto" };
	}
	return body;
}

/** One tool call extracted from a `/v1/messages` response (a `tool_use` content block). */
export interface ParsedToolCall {
	id: string;
	name: string;
	/** The tool arguments (the `input` object of the `tool_use` block). */
	args: Record<string, unknown>;
}

export interface ParsedAnthropicMessagesResponse {
	/** All `text` content blocks concatenated (the model's prose, if any). */
	text: string;
	/** Every `tool_use` block, in order. */
	toolCalls: ParsedToolCall[];
	/** The `stop_reason` (`end_turn` / `tool_use` / `max_tokens` / …), or null when absent. */
	stopReason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Parse a `/v1/messages` response body into extracted text + tool calls + stop reason. Defensive: a malformed/partial
 * body yields empty text + no tool calls rather than throwing (a weak local server may emit off-spec JSON; the caller's
 * retry ladder decides). The Messages `content` is an array of blocks: `{type:"text", text}` and
 * `{type:"tool_use", id, name, input}`.
 */
export function parseAnthropicMessagesResponse(body: unknown): ParsedAnthropicMessagesResponse {
	const record = asRecord(body);
	const empty: ParsedAnthropicMessagesResponse = { text: "", toolCalls: [], stopReason: null };
	if (!record) {
		return empty;
	}
	const stopReasonRaw = record.stop_reason;
	const stopReason = typeof stopReasonRaw === "string" ? stopReasonRaw : null;
	const content = Array.isArray(record.content) ? record.content : [];
	const textParts: string[] = [];
	const toolCalls: ParsedToolCall[] = [];
	for (const rawBlock of content) {
		const block = asRecord(rawBlock);
		if (!block) {
			continue;
		}
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		} else if (block.type === "tool_use" && typeof block.name === "string") {
			toolCalls.push({
				id: typeof block.id === "string" ? block.id : "",
				name: block.name,
				args: asRecord(block.input) ?? {},
			});
		}
	}
	return { text: textParts.join(""), toolCalls, stopReason };
}
