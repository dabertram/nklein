/**
 * Forgiving multi-format tool-call parser (F12.17, todo §5.AF / Phase 12).
 *
 * Small local models frequently emit a tool call the native `tool_calls` channel never captures: a ```json fence, a Hermes
 * `<tool_call>{…}</tool_call>` block, an XML `<function=name>…</function>` tag, a Python-style `name(arg="x")`, or plain JSON
 * with the wrong key names (`tool`/`function`/`parameters`/`args`), often with trailing commas, single quotes, or Python
 * `True/False/None` literals — and sometimes the whole thing lands in `reasoning_content` instead of `content`. Hard-failing
 * the turn on any of these throws away a RECOVERABLE call. This is the INBOUND complement to F3.T4's schema-downgrade and
 * F3.T2's error contract: salvage the call before counting the turn failed.
 *
 * Pure/total/deterministic — no I/O, no clock. `parseForgivingToolCall(text)` tries the formats most-structured-first and
 * returns the first success (or null); `parseToolCallFromChannels` applies it to content then reasoning_content.
 */

export type ToolCallFormat = "json" | "fenced-json" | "hermes" | "xml-function" | "python-call";

export interface ParsedToolCall {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
	/** Which surface/format the call was recovered from. */
	readonly format: ToolCallFormat;
	/** True when a non-native format or a JSON repair (trailing comma, single quotes, python literals) was needed. */
	readonly recovered: boolean;
}

// --- JSON salvage ------------------------------------------------------------------------------------------------------

const NAME_KEYS = ["name", "tool", "tool_name", "function", "action"] as const;
const ARG_KEYS = ["arguments", "parameters", "args", "input", "action_input"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Try to JSON.parse an object, escalating through cheap repairs; reports whether any repair was applied. */
function tryParseJsonObject(raw: string): { value: Record<string, unknown>; repaired: boolean } | null {
	const candidates: Array<{ s: string; repaired: boolean }> = [{ s: raw, repaired: false }];
	const noTrailing = raw.replace(/,(\s*[}\]])/g, "$1");
	if (noTrailing !== raw) {
		candidates.push({ s: noTrailing, repaired: true });
	}
	const pyLiterals = noTrailing
		.replace(/\bTrue\b/g, "true")
		.replace(/\bFalse\b/g, "false")
		.replace(/\bNone\b/g, "null");
	if (pyLiterals !== noTrailing) {
		candidates.push({ s: pyLiterals, repaired: true });
	}
	const singleToDouble = pyLiterals.replace(/'/g, '"');
	if (singleToDouble !== pyLiterals) {
		candidates.push({ s: singleToDouble, repaired: true });
	}
	for (const candidate of candidates) {
		try {
			const value = JSON.parse(candidate.s);
			if (isPlainObject(value)) {
				return { value, repaired: candidate.repaired };
			}
		} catch {
			// try the next repair
		}
	}
	return null;
}

/** Map a parsed object with possibly-nonstandard keys onto {name, arguments}; arguments-as-JSON-string is re-parsed. */
function normalizeCallObject(
	obj: Record<string, unknown>,
): { name: string; arguments: Record<string, unknown> } | null {
	const nameValue = NAME_KEYS.map((k) => obj[k]).find((v) => typeof v === "string" && v.length > 0);
	if (typeof nameValue !== "string") {
		return null;
	}
	const rawArgs = ARG_KEYS.map((k) => obj[k]).find((v) => v !== undefined);
	let args: Record<string, unknown> = {};
	if (isPlainObject(rawArgs)) {
		args = rawArgs;
	} else if (typeof rawArgs === "string" && rawArgs.trim().length > 0) {
		args = tryParseJsonObject(rawArgs)?.value ?? {};
	}
	return { name: nameValue, arguments: args };
}

/** Scan for the first balanced {...} object (string-aware), returning its source slice. */
function extractFirstJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) {
		return null;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
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
			depth += 1;
		} else if (ch === "}") {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return null;
}

// --- python-call salvage -----------------------------------------------------------------------------------------------

/** Split a comma-separated arg list at top level only (respecting quotes/brackets). */
function splitTopLevel(args: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let inString: string | null = null;
	let current = "";
	for (let i = 0; i < args.length; i++) {
		const ch = args[i] ?? "";
		if (inString) {
			current += ch;
			if (ch === inString && args[i - 1] !== "\\") {
				inString = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
			current += ch;
		} else if (ch === "(" || ch === "[" || ch === "{") {
			depth += 1;
			current += ch;
		} else if (ch === ")" || ch === "]" || ch === "}") {
			depth -= 1;
			current += ch;
		} else if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	if (current.trim().length > 0) {
		parts.push(current);
	}
	return parts;
}

/** Coerce a python/JSON scalar literal to a JS value. */
function coerceScalar(raw: string): unknown {
	const v = raw.trim();
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	if (v === "True" || v === "true") {
		return true;
	}
	if (v === "False" || v === "false") {
		return false;
	}
	if (v === "None" || v === "null") {
		return null;
	}
	if (/^-?\d+(\.\d+)?$/.test(v)) {
		return Number(v);
	}
	try {
		return JSON.parse(v);
	} catch {
		return v; // leave as a bare string
	}
}

// --- format extractors -------------------------------------------------------------------------------------------------

function fromJsonText(text: string): ParsedToolCall | null {
	const objectSource = extractFirstJsonObject(text);
	if (!objectSource) {
		return null;
	}
	const parsed = tryParseJsonObject(objectSource);
	if (!parsed) {
		return null;
	}
	const call = normalizeCallObject(parsed.value);
	if (!call) {
		return null;
	}
	// "recovered" if a repair was needed OR the object used a non-native name key (i.e. not `name`).
	const usedNativeKeys =
		"name" in parsed.value && ("arguments" in parsed.value || !ARG_KEYS.some((k) => k in parsed.value));
	return { ...call, format: "json", recovered: parsed.repaired || !usedNativeKeys };
}

function fromFence(text: string): ParsedToolCall | null {
	const fence = text.match(/```(?:json|tool_call|tool)?\s*([\s\S]*?)```/i);
	if (!fence?.[1]) {
		return null;
	}
	const inner = fromJsonText(fence[1]);
	return inner ? { ...inner, format: "fenced-json", recovered: true } : null;
}

function fromHermes(text: string): ParsedToolCall | null {
	const block = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
	if (!block?.[1]) {
		return null;
	}
	const inner = fromJsonText(block[1]);
	return inner ? { ...inner, format: "hermes", recovered: true } : null;
}

function fromXmlFunction(text: string): ParsedToolCall | null {
	// <function=NAME>{...}</function> or <function_call name="NAME">...</function_call>
	const tag = text.match(
		/<function(?:_call)?(?:=|[\s]+name=)["']?([\w.-]+)["']?[^>]*>([\s\S]*?)<\/function(?:_call)?>/i,
	);
	if (!tag?.[1]) {
		return null;
	}
	const name = tag[1];
	const body = tag[2] ?? "";
	const objectSource = extractFirstJsonObject(body);
	const args = objectSource ? (tryParseJsonObject(objectSource)?.value ?? {}) : {};
	return { name, arguments: args, format: "xml-function", recovered: true };
}

function fromPythonCall(text: string): ParsedToolCall | null {
	const call = text.match(/([A-Za-z_][\w.]*)\s*\(([\s\S]*)\)\s*$/);
	if (!call?.[1]) {
		return null;
	}
	const name = call[1];
	const args: Record<string, unknown> = {};
	for (const part of splitTopLevel(call[2] ?? "")) {
		const eq = part.indexOf("=");
		if (eq <= 0) {
			continue; // ignore bare positionals — tool calls are keyword-based
		}
		const key = part.slice(0, eq).trim();
		if (/^[A-Za-z_]\w*$/.test(key)) {
			args[key] = coerceScalar(part.slice(eq + 1));
		}
	}
	return { name, arguments: args, format: "python-call", recovered: true };
}

/**
 * Parse a tool call out of raw model text, trying the formats most-structured-first: Hermes `<tool_call>` block, XML
 * `<function=>` tag, ```json fence, bare JSON object, then a Python-style `name(...)` call. Returns the first successful
 * parse or null. `recovered` is true whenever a non-native format or a JSON repair was needed (so the caller can log how
 * often a model needs salvaging).
 */
export function parseForgivingToolCall(text: string): ParsedToolCall | null {
	if (!text || text.trim().length === 0) {
		return null;
	}
	return (
		fromHermes(text) ?? fromXmlFunction(text) ?? fromFence(text) ?? fromJsonText(text) ?? fromPythonCall(text) ?? null
	);
}

/**
 * Apply `parseForgivingToolCall` to the completion's `content`, then fall back to `reasoning_content` (weak reasoning models
 * often emit the call only in the reasoning channel). Returns the first recovered call or null.
 */
export function parseToolCallFromChannels(channels: {
	content?: string | null;
	reasoningContent?: string | null;
}): ParsedToolCall | null {
	return (
		parseForgivingToolCall(channels.content ?? "") ?? parseForgivingToolCall(channels.reasoningContent ?? "") ?? null
	);
}
