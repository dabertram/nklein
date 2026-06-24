/**
 * Recover tool calls that a model emitted as **text instead of a structured tool call**.
 *
 * Small / quantized local models routinely "narrate" a tool call — they print the Hermes/Qwen-style
 * `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` block into their content or reasoning channel
 * rather than emitting it through the provider's structured tool-calling path. The SDK then sees a plain text
 * turn with no tool call, the agent loop finds nothing to execute, and the turn stalls (observed live: a model
 * mid-decomposition wrote a `read_large_file` / `list_files` call as a `<tool_call>` text block and stopped).
 *
 * The project principle is to be **robust against weak-model output errors rather than trying to teach the
 * model**: instead of re-prompting ("emit a real tool call next time"), we parse the narrated call and execute
 * it. This module is the pure recovery; it is wired into the agent loop's `afterModel` hook, which runs before
 * the loop extracts tool calls from the assistant message — so appending a recovered `tool-call` part makes the
 * loop dispatch it exactly as if the model had emitted it natively.
 *
 * Covers the tool-call text formats of the major local-model families (todo §5.O): Hermes/Qwen `<tool_call>`,
 * the pipe-delimited `<|tool_call|>`/`<function_call>`, Llama 3.1 `<|python_tag|>`, Mistral/Mixtral
 * `[TOOL_CALLS][…]` (a JSON array), the OpenAI-shaped nested `function:{name,arguments}` object, and the
 * Functionary `<function=NAME>{…}</function>` named-tag form.
 *
 * Deliberately conservative to avoid false positives: recovery only triggers when the turn produced **no real
 * tool call** and the text contains one of those explicit markers around a JSON payload carrying a tool name.
 * Bare JSON without a marker is left untouched (it is too easily a legitimate answer).
 */

import type { AgentMessage, AgentToolCallPart } from "@nklein/shared";
import { repairJsonStringValue, repairJsonValue } from "./nklein-tool-argument-repair";

export interface NarratedToolCall {
	toolName: string;
	input: unknown;
}

/**
 * Openers for the tool-call wrappers the major local-model families emit when they narrate a call as text:
 * - Hermes / Qwen / Granite: `<tool_call>` and the pipe-delimited `<|tool_call|>` variant (and `<function_call>`)
 * - Llama 3.1: `<|python_tag|>` (single JSON object follows)
 * - Mistral / Mixtral: `[TOOL_CALLS]` (a JSON **array** of calls follows)
 * Case-insensitive, whitespace-tolerant. The matching closer is irrelevant: each call's JSON (object or array)
 * is extracted from the text following an opener up to the next opener (or EOF), and {@link repairJsonValue} pulls
 * out the first balanced value, ignoring any trailing `</tool_call>`. The `<function=NAME>…</function>` family
 * (name in the tag) is handled separately by {@link NAMED_FUNCTION_TAG}.
 */
const TOOL_CALL_OPENER = /<\|?\s*(?:tool_call|function_call|python_tag)\s*\|?>|\[TOOL_CALLS\]/gi;

/** Quick pre-check: does the text contain ANY recognized tool-call marker? Keeps the common no-marker path cheap. */
const TOOL_CALL_MARKER = /tool_call|function_call|python_tag|\[TOOL_CALLS\]|<function\s*=/i;

/** Functionary / some Llama fine-tunes: `<function=NAME>{json args}</function>` — the name lives in the tag. */
const NAMED_FUNCTION_TAG = /<function\s*=\s*([A-Za-z0-9_.-]+)\s*>([\s\S]*?)<\/function\s*>/gi;

/** Coerce a parsed `{ name, arguments }`-ish object into a tool call; returns null when there is no tool name. */
function toNarratedToolCall(value: unknown): NarratedToolCall | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	// OpenAI tool_calls shape nests the call under `function: { name, arguments }`.
	const fn =
		record.function && typeof record.function === "object" ? (record.function as Record<string, unknown>) : null;
	const rawName =
		(typeof record.name === "string" && record.name) ||
		(typeof record.tool === "string" && record.tool) ||
		(typeof record.tool_name === "string" && record.tool_name) ||
		(fn && typeof fn.name === "string" && fn.name) ||
		"";
	const toolName = rawName.trim();
	if (!toolName) {
		return null;
	}
	let input: unknown =
		record.arguments ?? record.input ?? record.parameters ?? record.args ?? fn?.arguments ?? fn?.parameters ?? {};
	// Models often double-encode the arguments as a JSON string; repair it back into an object.
	if (typeof input === "string") {
		input = repairJsonStringValue(input);
	}
	return { toolName, input };
}

/** A repaired value may be a single call object or a JSON array of them (Mistral `[TOOL_CALLS]`). Flatten both. */
function collectNarratedToolCalls(value: unknown, calls: NarratedToolCall[]): void {
	if (Array.isArray(value)) {
		for (const element of value) {
			const call = toNarratedToolCall(element);
			if (call) {
				calls.push(call);
			}
		}
		return;
	}
	const call = toNarratedToolCall(value);
	if (call) {
		calls.push(call);
	}
}

/** Parse every narrated tool-call block (any recognized family format) out of free text. `[]` when there are none. */
export function parseNarratedToolCalls(text: string): NarratedToolCall[] {
	if (!text || !TOOL_CALL_MARKER.test(text)) {
		return [];
	}
	const calls: NarratedToolCall[] = [];

	const openers: Array<{ tagStart: number; contentStart: number }> = [];
	TOOL_CALL_OPENER.lastIndex = 0;
	let match: RegExpExecArray | null = TOOL_CALL_OPENER.exec(text);
	while (match !== null) {
		openers.push({ tagStart: match.index, contentStart: match.index + match[0].length });
		match = TOOL_CALL_OPENER.exec(text);
	}
	for (let i = 0; i < openers.length; i += 1) {
		const segmentStart = openers[i].contentStart;
		const segmentEnd = i + 1 < openers.length ? openers[i + 1].tagStart : text.length;
		const repaired = repairJsonValue(text.slice(segmentStart, segmentEnd));
		if (repaired.ok) {
			collectNarratedToolCalls(repaired.value, calls);
		}
	}

	// `<function=NAME>{args}</function>` — the tool name is in the tag, the body is the arguments JSON.
	NAMED_FUNCTION_TAG.lastIndex = 0;
	let namedMatch: RegExpExecArray | null = NAMED_FUNCTION_TAG.exec(text);
	while (namedMatch !== null) {
		const toolName = namedMatch[1]?.trim();
		if (toolName) {
			const repaired = repairJsonValue(namedMatch[2] ?? "");
			calls.push({ toolName, input: repaired.ok ? repaired.value : {} });
		}
		namedMatch = NAMED_FUNCTION_TAG.exec(text);
	}

	return calls;
}

/**
 * Strip narrated tool-call **markup** out of a user-facing reply (todo §5.O). Weak/quantized models sometimes
 * narrate a tool call as plain text in their *final* answer instead of confirming what they did (observed live:
 * gemma-4-e2b ending a turn with `<|tool_call>call:write_file …`, a non-JSON body `parseNarratedToolCalls` can't
 * parse). Since a final reply's narration is the model's "I'm taking this action" tail — and the action already
 * ran — we cut from the first recognized opener marker to end-of-text and trim, leaving only the natural-language
 * prose before it (often empty). Unlike `recoverNarratedToolCalls` (which *executes* the narrated call), this only
 * cleans display text; the caller substitutes a confirmation when nothing readable remains.
 */
export function stripNarratedToolCallMarkup(text: string): string {
	if (!text || !TOOL_CALL_MARKER.test(text)) {
		return text;
	}
	let cut = text.length;
	TOOL_CALL_OPENER.lastIndex = 0;
	const opener = TOOL_CALL_OPENER.exec(text);
	if (opener) {
		cut = Math.min(cut, opener.index);
	}
	const named = /<function\s*=/i.exec(text);
	if (named) {
		cut = Math.min(cut, named.index);
	}
	return text.slice(0, cut).trim();
}

let recoveredToolCallSeq = 0;

/** Concatenate the text + reasoning content where a narrated call could hide. */
function readNarratableText(message: AgentMessage): string {
	return message.content
		.flatMap((part) => (part.type === "text" || part.type === "reasoning" ? [part.text] : []))
		.join("\n");
}

/**
 * If the assistant turn produced no real tool call but narrated one (or more) as `<tool_call>` text, append the
 * recovered `tool-call` part(s) to `message.content` (mutating in place, the array the agent loop dispatches
 * from) and return them. A no-op — returning `[]` — when a real tool call is already present or none is narrated.
 */
export function recoverNarratedToolCalls(message: AgentMessage): AgentToolCallPart[] {
	if (message.content.some((part) => part.type === "tool-call")) {
		return [];
	}
	const calls = parseNarratedToolCalls(readNarratableText(message));
	if (calls.length === 0) {
		return [];
	}
	const recovered = calls.map<AgentToolCallPart>((call) => {
		recoveredToolCallSeq += 1;
		return {
			type: "tool-call",
			toolCallId: `narrated-${Date.now().toString(36)}-${recoveredToolCallSeq.toString(36)}`,
			toolName: call.toolName,
			input: call.input,
			metadata: { recoveredFromNarratedToolCall: true },
		};
	});
	message.content.push(...recovered);
	return recovered;
}
