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
 * Deliberately conservative to avoid false positives: recovery only triggers when the turn produced **no real
 * tool call** and the text contains an explicit `<tool_call>` / `<function_call>` wrapper around a JSON object
 * carrying a tool `name`. Bare JSON without the wrapper is left untouched (it is too easily a legitimate answer).
 */

import type { AgentMessage, AgentToolCallPart } from "@nklein/shared";
import { repairJsonStringValue, repairJsonValue } from "./nklein-tool-argument-repair";

export interface NarratedToolCall {
	toolName: string;
	input: unknown;
}

/**
 * Opener for the common wrappers weak models emit: `<tool_call>`, `<function_call>`, and the pipe-delimited
 * `<|tool_call|>` variant — case-insensitive, tolerant of surrounding whitespace. The matching closer is
 * irrelevant: each call's JSON is extracted from the text following an opener up to the next opener (or EOF),
 * and {@link repairJsonValue} pulls out the first balanced object, ignoring any trailing `</tool_call>`.
 */
const TOOL_CALL_OPENER = /<\|?\s*(?:tool_call|function_call)\s*\|?>/gi;

/** Coerce a parsed `{ name, arguments }`-ish object into a tool call; returns null when there is no tool name. */
function toNarratedToolCall(value: unknown): NarratedToolCall | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const rawName =
		(typeof record.name === "string" && record.name) ||
		(typeof record.tool === "string" && record.tool) ||
		(typeof record.tool_name === "string" && record.tool_name) ||
		"";
	const toolName = rawName.trim();
	if (!toolName) {
		return null;
	}
	let input: unknown = record.arguments ?? record.input ?? record.parameters ?? record.args ?? {};
	// Models often double-encode the arguments as a JSON string; repair it back into an object.
	if (typeof input === "string") {
		input = repairJsonStringValue(input);
	}
	return { toolName, input };
}

/** Parse every narrated `<tool_call>`/`<function_call>` block out of free text. Returns [] when there are none. */
export function parseNarratedToolCalls(text: string): NarratedToolCall[] {
	if (!text || !/tool_call|function_call/i.test(text)) {
		return [];
	}
	const openers: Array<{ tagStart: number; contentStart: number }> = [];
	TOOL_CALL_OPENER.lastIndex = 0;
	let match: RegExpExecArray | null = TOOL_CALL_OPENER.exec(text);
	while (match !== null) {
		openers.push({ tagStart: match.index, contentStart: match.index + match[0].length });
		match = TOOL_CALL_OPENER.exec(text);
	}
	const calls: NarratedToolCall[] = [];
	for (let i = 0; i < openers.length; i += 1) {
		const segmentStart = openers[i].contentStart;
		const segmentEnd = i + 1 < openers.length ? openers[i + 1].tagStart : text.length;
		const repaired = repairJsonValue(text.slice(segmentStart, segmentEnd));
		if (!repaired.ok) {
			continue;
		}
		const call = toNarratedToolCall(repaired.value);
		if (call) {
			calls.push(call);
		}
	}
	return calls;
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
