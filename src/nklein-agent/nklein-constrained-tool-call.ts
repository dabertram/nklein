/**
 * Constrained-decoding tool-call substrate (todo §5.AA) — the PURE format core for the ladder's last-resort rungs:
 * **constrained-decoding** ("force a parseable tool call") and phase (b) of **reason-then-act** ("now emit that call").
 *
 * The §5.Z sweeps show reasoning/small models often DECIDE on an action but never emit a structured `tool_call` — they
 * ruminate, or narrate the call in prose. Instead of relying on the model to choose to call, this builds a
 * `response_format: json_schema` that makes the model emit the call AS structured output (the same constrained-decoding
 * LM Studio already guarantees for `generateStructured`), then parses that JSON back into a known tool call.
 *
 * Pure + generic over `LocalLlmToolDefinition` so the chat loop and the swarm session runtime share one seam, and so it
 * is trivially testable without a live model. This is substrate only — wiring it at the model-call seam is the §5.AA
 * retry-engine work (separate, hot-path).
 */

import type { LocalLlmToolDefinition } from "./nklein-local-llm-client";

/** A `response_format: json_schema` payload (matches `LocalLlmClient`'s `jsonSchema` request field). */
export interface ConstrainedToolCallSchema {
	name: string;
	schema: Record<string, unknown>;
	strict?: boolean;
}

export interface BuildConstrainedToolCallSchemaOptions {
	/**
	 * Constrain `arguments` to each tool's OWN parameter schema via a per-tool discriminated `anyOf` (tighter; best for
	 * capable mid/large models). Default `false` = a single compatible shape (`arguments` is a generic object) that any
	 * model with structured-output support can satisfy — the safest last-resort rung.
	 */
	perToolArguments?: boolean;
	/** Schema name (sent as `json_schema.name`). */
	schemaName?: string;
}

const DEFAULT_SCHEMA_NAME = "klein_tool_call";

/**
 * Build the json_schema that FORCES exactly one tool call. Returns `null` when there are no tools (nothing to constrain).
 *
 * Default (compatible) shape — `{ tool: <enum of names>, arguments: object }` — guarantees a VALID tool name on any
 * model that supports structured output at all; per-tool argument correctness is validated downstream by the tool (args
 * parsing already tolerates extras/missing). With `perToolArguments`, each tool becomes an `anyOf` branch pinning
 * `tool` to its name and `arguments` to that tool's `parameters` — a stricter constraint for models that can handle it.
 */
export function buildConstrainedToolCallSchema(
	tools: readonly LocalLlmToolDefinition[],
	options: BuildConstrainedToolCallSchemaOptions = {},
): ConstrainedToolCallSchema | null {
	if (tools.length === 0) {
		return null;
	}
	const schemaName = options.schemaName ?? DEFAULT_SCHEMA_NAME;
	if (options.perToolArguments) {
		const branches = tools.map((tool) => ({
			type: "object",
			properties: {
				tool: { const: tool.name },
				arguments: normalizeArgumentsSchema(tool.parameters),
			},
			required: ["tool", "arguments"],
			additionalProperties: false,
		}));
		return { name: schemaName, schema: { anyOf: branches }, strict: true };
	}
	return {
		name: schemaName,
		schema: {
			type: "object",
			properties: {
				tool: { type: "string", enum: tools.map((tool) => tool.name) },
				arguments: { type: "object" },
			},
			required: ["tool", "arguments"],
			additionalProperties: false,
		},
		strict: true,
	};
}

/** A tool's `parameters` is already a JSON-Schema object; fall back to a permissive object when it's missing/odd. */
function normalizeArgumentsSchema(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
	if (parameters && typeof parameters === "object" && parameters.type === "object") {
		return parameters;
	}
	return { type: "object" };
}

export interface ParsedConstrainedToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * Parse a constrained-decoding response back into one of the OFFERED tool calls, or `null` when none matches. Tolerant
 * of how a weak model may render the JSON: accepts our `{ tool, arguments }` shape, a bare `{ name, arguments }`, and the
 * OpenAI-ish `{ function: { name, arguments } }`; `arguments` may be an object OR a JSON string (the OpenAI wire form);
 * and the JSON may be wrapped in prose or a ```json fence (we extract the first balanced object). Only returns a call
 * whose name is one of `tools` — a hallucinated name yields `null` (the caller falls through to the next rung).
 */
export function parseConstrainedToolCall(
	content: string,
	tools: readonly LocalLlmToolDefinition[],
): ParsedConstrainedToolCall | null {
	const known = new Set(tools.map((tool) => tool.name));
	const parsed = extractFirstJsonObject(content);
	if (!parsed) {
		return null;
	}
	const fn = isRecord(parsed.function) ? parsed.function : null;
	const name = pickString(parsed.tool) ?? pickString(parsed.name) ?? (fn ? pickString(fn.name) : null);
	if (!name || !known.has(name)) {
		return null;
	}
	const rawArgs = parsed.arguments ?? (fn ? fn.arguments : undefined);
	return { name, arguments: coerceArguments(rawArgs) };
}

function coerceArguments(raw: unknown): Record<string, unknown> {
	if (isRecord(raw)) {
		return raw;
	}
	if (typeof raw === "string" && raw.trim().length > 0) {
		try {
			const parsed = JSON.parse(raw);
			if (isRecord(parsed)) {
				return parsed;
			}
		} catch {
			// fall through — malformed arg string ⇒ empty (the tool validates its own inputs)
		}
	}
	return {};
}

/** Parse `content` as JSON, or extract the first balanced `{…}` object embedded in prose / a code fence. */
function extractFirstJsonObject(content: string): Record<string, unknown> | null {
	const trimmed = content.trim();
	const direct = tryParseObject(trimmed);
	if (direct) {
		return direct;
	}
	const start = content.indexOf("{");
	if (start < 0) {
		return null;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < content.length; i++) {
		const ch = content[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return tryParseObject(content.slice(start, i + 1));
			}
		}
	}
	return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(text);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
