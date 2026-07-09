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
 * `[TOOL_CALLS][…]` (a JSON array), Devstral's `name[ARGS]{…}` tool transcript, the OpenAI-shaped nested
 * `function:{name,arguments}` object, the
 * Functionary `<function=NAME>{…}</function>` named-tag form, the **Microsoft Phi** `[TOOL_REQUEST]{…}[END_TOOL_REQUEST]`
 * form, and the **DeepSeek-V3/R1** native format
 * (special-token `<｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME ```json {…} ``` <｜tool▁call▁end｜>`, with the
 * name *outside* the JSON).
 *
 * Deliberately conservative to avoid false positives: recovery only triggers when the turn produced **no real
 * tool call** and the text contains one of those explicit markers around a JSON payload carrying a tool name.
 * Bare JSON without a marker is left untouched (it is too easily a legitimate answer).
 */

import { repairJsonStringValue, repairJsonValue } from "./nklein-tool-argument-repair";
import { extractBalancedParens, parsePythonKwargs } from "./python-call-syntax";
import type { AgentMessage, AgentToolCallPart } from "./sdk-agent-types";

export interface NarratedToolCall {
	toolName: string;
	input: unknown;
}

export interface NarratedToolCallRecoveryOptions {
	/**
	 * The exact tool names offered on this model turn. When supplied, recovered calls are constrained to this set:
	 * exact match first, then a conservative alias pass for punctuation/suffix pollution seen in local-model narrated
	 * calls. An unoffered narrated tool is dropped instead of being executed.
	 */
	offeredToolNames?: readonly string[];
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
const TOOL_CALL_OPENER = /<\|?\s*(?:tool_call|function_call|python_tag)\s*\|?>|\[TOOL_CALLS\]|\[TOOL_REQUEST\]/gi;

/**
 * Quick pre-check: does the text contain ANY recognized tool-call marker? Keeps the common no-marker path cheap.
 * `tool[_▁]call` matches both the underscore form (`tool_call`) and DeepSeek's `▁`-delimited `tool▁call(s)`.
 */
const TOOL_CALL_MARKER = /tool[_▁]call|function_call|python_tag|\[TOOL_CALLS\]|\[TOOL_REQUEST\]|<function\s*=/i;

/**
 * Functionary / some Llama fine-tunes: `<function=NAME>{json args}</function>` — the name lives in the tag. We match
 * only the OPENER and read the arguments as the first balanced JSON value after it (via {@link extractBalancedJsonSpan}),
 * NOT with a `([\s\S]*?)…</function>` body capture: a non-greedy body stops at the first `</function>` SUBSTRING, so an
 * argument value that itself contains the literal `</function>` (or a nested `<function=…>`) would truncate the JSON and
 * silently drop every argument. Extracting the balanced value is string-aware, so those tokens inside a string are inert.
 */
const NAMED_FUNCTION_OPENER = /<function\s*=\s*([A-Za-z0-9_.-]+)\s*>/gi;

/**
 * From `fromIndex`, find the first `{`/`[` and return the balanced JSON slice plus the index just past its close.
 * String- and escape-aware, so a `}`, `</function>`, or `<function=…>` appearing INSIDE a string value neither closes
 * the value early nor is mistaken for structure. Returns null when no bracket follows; a truncated (never-closed) value
 * returns the remainder with `end` at the text length (repairJsonValue closes the owed brackets).
 */
function extractBalancedJsonSpan(text: string, fromIndex: number): { json: string; end: number } | null {
	const rel = text.slice(fromIndex).search(/[[{]/u);
	if (rel < 0) {
		return null;
	}
	const start = fromIndex + rel;
	const open = text[start];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let inString = false;
	let escaping = false;
	for (let i = start; i < text.length; i += 1) {
		const char = text[i];
		if (inString) {
			if (escaping) {
				escaping = false;
			} else if (char === "\\") {
				escaping = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === open) {
			depth += 1;
		} else if (char === close) {
			depth -= 1;
			if (depth === 0) {
				return { json: text.slice(start, i + 1), end: i + 1 };
			}
		}
	}
	return { json: text.slice(start), end: text.length };
}

/**
 * DeepSeek-V3 / R1 native tool-call format. It uses special tokens (U+FF5C `｜`, U+2581 `▁`), puts the tool NAME
 * *outside* the JSON, and the arguments in a fenced ```json block:
 *   `<｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME` ```json {…} ``` `<｜tool▁call▁end｜>`
 * Local GGUF quantizations sometimes emit an ASCII-normalized variant (`<|tool_call_begin|>`, `tool_sep`), so the
 * wrapper tolerates `｜` or `|` and the separators tolerate `▁`, `_`, or a space. Each call's body is captured up to
 * its end token (or EOF, for a truncated turn); the name is read from the header (after the separator) and
 * {@link repairJsonValue} pulls the arguments object out of the `NAME … ```json {…} ``` ` tail.
 */
const DEEPSEEK_TOOL_CALL =
	/<[｜|]\s*tool[▁_ ]call[▁_ ]begin\s*[｜|]>([\s\S]*?)(?:<[｜|]\s*tool[▁_ ]call[▁_ ]end\s*[｜|]>|$)/gi;
const DEEPSEEK_TOOL_SEP = /<[｜|]\s*tool[▁_ ]sep\s*[｜|]>/i;
/** Outer-or-inner DeepSeek call opener, for display-stripping a narrated call out of a final reply. */
const DEEPSEEK_OPENER = /<[｜|]\s*tool[▁_ ]calls?[▁_ ]begin\s*[｜|]>/i;

/**
 * Plain-prose narrated call: `Tool call: name(args)` — no structured marker, just the model describing the call in
 * words (observed live: gemma-4-e2b leaked exactly this into its final reply, §5.Z). Deliberately specific to avoid
 * false positives: requires the `tool call:` lead-in **immediately** followed by an identifier and an opening paren
 * (a function-call shape), so ordinary prose that merely mentions "a tool call" never matches.
 */
const PLAIN_PROSE_TOOL_CALL = /\btool\s+call\s*:\s*`?\s*[A-Za-z_][A-Za-z0-9_.-]*\s*\(/i;

/**
 * Devstral / LM Studio transcript-style narration observed live: `list_files[ARGS]{"path":"."}`. The explicit
 * `[ARGS]` marker keeps this conservative; the name is the identifier immediately before it and the following balanced
 * JSON value is the tool input object.
 */
const BRACKET_ARGS_TOOL_CALL_MARKER = /\b[A-Za-z_][A-Za-z0-9_.-]*\s*\[ARGS\]\s*[[{]/i;
const BRACKET_ARGS_TOOL_CALL = /\b([A-Za-z_][A-Za-z0-9_.-]*)\s*\[ARGS\]\s*/gi;

/**
 * Gemma `tool_code` Python-call narration. Gemma models (esp. the small e2b) narrate a call as Python in a `tool_code`
 * context — `tool_code = read_file(filename="FACT.txt")`, or a ```tool_code … ``` fence with `name(kwarg=value, …)`,
 * sometimes `print(default_api.name(…))` — instead of emitting a structured tool call (observed live in the §5.Z e2e
 * capstone: gemma-4-e2b narrated EVERY call this way → nothing executed). We recover the call: read the function name +
 * its keyword arguments and rebuild a JSON input object. Conservative: only a `tool_code` context anchors it, so a bare
 * Python-looking line elsewhere in prose is never mistaken for a call.
 */
const GEMMA_TOOL_CODE_MARKER = /tool_code/i;
/** Wrapper call names that aren't tools — skip them and keep scanning for the real inner call. */
const GEMMA_WRAPPER_NAMES = new Set(["print"]);

/** Extract the balanced `(...)` body starting at `openParenIdx` (which must point at `(`); null when unbalanced. */
/** Recover Gemma `tool_code` Python-call narration. Each `tool_code` marker anchors the first real call after it. */
function parseGemmaToolCodeCalls(text: string): NarratedToolCall[] {
	if (!GEMMA_TOOL_CODE_MARKER.test(text)) {
		return [];
	}
	const calls: NarratedToolCall[] = [];
	const callRe = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g;
	const markerRe = /tool_code/gi;
	// Do NOT slice the text into `[marker, nextMarker]` regions: the next-marker search is string-UNAWARE, so a
	// `tool_code` inside a call's string argument (e.g. run_command(command="grep tool_code .")) was mistaken for the
	// next region boundary and truncated the call mid-string, dropping it. Instead scan the FULL text and let the
	// string-aware `extractBalancedParens` decide where each call ends; `consumedUpTo` skips markers that fall inside an
	// already-parsed call (its own body / string args) so they aren't reprocessed.
	let consumedUpTo = 0;
	let marker: RegExpExecArray | null = markerRe.exec(text);
	while (marker !== null) {
		if (marker.index >= consumedUpTo) {
			callRe.lastIndex = marker.index + marker[0].length;
			let call: RegExpExecArray | null = callRe.exec(text);
			while (call !== null) {
				const name = call[1].split(".").at(-1)?.trim() ?? "";
				if (name && !GEMMA_WRAPPER_NAMES.has(name.toLowerCase())) {
					// The first non-wrapper call is this marker's call. `extractBalancedParens` is string-aware, so a
					// `tool_code` (or the next call) inside a string argument no longer truncates it.
					const openParen = call.index + call[0].length - 1;
					const balanced = extractBalancedParens(text, openParen);
					if (balanced) {
						calls.push({ toolName: name, input: parsePythonKwargs(balanced.body) });
						consumedUpTo = balanced.end + 1;
					}
					break;
				}
				// A wrapper call (e.g. print(default_api.fn(...))) — the real call is NESTED inside its parens, so advance
				// to the NEXT call match (do NOT skip past the wrapper's body, which would miss the inner call).
				call = callRe.exec(text);
			}
		}
		marker = markerRe.exec(text);
	}
	return calls;
}

/**
 * Recover plain-prose `Tool call: name(args)` narration — gemma-4-e2b's e2e dialect, e.g.
 * ``Tool call: `create_card(title="E2E-CARD-7777", prompt="from e2e")` `` (each step narrated this way, not emitted as a
 * structured call). `stripNarratedToolCallMarkup` already treats this exact shape as a narrated call (strips it for
 * display); this RECOVERS it so the call executes. Args are Python-style kwargs (`filename="…"`), parsed via
 * {@link parsePythonKwargs}; an optional backtick wrapper is tolerated. Conservative: the `tool call:` lead-in + an
 * identifier + `(` is required (the same shape the strip path trusts), so ordinary prose never matches.
 */
function parsePlainProseToolCalls(text: string): NarratedToolCall[] {
	if (!PLAIN_PROSE_TOOL_CALL.test(text)) {
		return [];
	}
	const calls: NarratedToolCall[] = [];
	const lead = /\btool\s+call\s*:\s*`?\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\(/gi;
	let match: RegExpExecArray | null = lead.exec(text);
	while (match !== null) {
		const name = match[1].split(".").at(-1)?.trim() ?? "";
		const openParen = match.index + match[0].length - 1; // match[0] ends at the '('
		const balanced = extractBalancedParens(text, openParen);
		if (name && !GEMMA_WRAPPER_NAMES.has(name.toLowerCase()) && balanced) {
			calls.push({ toolName: name, input: parsePythonKwargs(balanced.body) });
		}
		match = lead.exec(text);
	}
	return calls;
}

/** Recover `name[ARGS]{json}` transcript-style tool narration. */
function parseBracketArgsToolCalls(text: string): NarratedToolCall[] {
	if (!BRACKET_ARGS_TOOL_CALL_MARKER.test(text)) {
		return [];
	}
	const calls: NarratedToolCall[] = [];
	BRACKET_ARGS_TOOL_CALL.lastIndex = 0;
	let match: RegExpExecArray | null = BRACKET_ARGS_TOOL_CALL.exec(text);
	while (match !== null) {
		const toolName = match[1].split(".").at(-1)?.trim() ?? "";
		const contentStart = match.index + match[0].length;
		const span = extractBalancedJsonSpan(text, contentStart);
		if (toolName && span) {
			const repaired = repairJsonValue(span.json);
			calls.push({ toolName, input: repaired.ok ? repaired.value : {} });
		}
		if (span && span.end > BRACKET_ARGS_TOOL_CALL.lastIndex) {
			BRACKET_ARGS_TOOL_CALL.lastIndex = span.end;
		}
		match = BRACKET_ARGS_TOOL_CALL.exec(text);
	}
	return calls;
}

/** Extract every balanced top-level `{…}` JSON object embedded in text (incl. inside ```json fences / prose). */
function extractAllJsonObjects(text: string): string[] {
	const objects: string[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] === "{") {
			const balanced = extractBalancedParens(text, i);
			if (balanced) {
				objects.push(text.slice(i, balanced.end + 1));
				i = balanced.end + 1;
				continue;
			}
		}
		i += 1;
	}
	return objects;
}

/**
 * TOOL-VALIDATED markerless recovery (§5.AA, 2026-06-29) — for small models (≤4B: nemotron-4b, gemma) that narrate a
 * call as a bare/```json-fenced object `{"tool":"create_card","parameters":{…}}` with NO recognized marker. Bare JSON is
 * normally NOT recovered (too easily a legit answer, §5.O), but here it's SAFE because we only accept an object whose
 * tool name is one of the OFFERED tools — a coincidental legit answer won't name an offered tool in that shape, and this
 * only runs on a tools-offered turn that produced no real call. Returns every offered-tool object found, in order.
 */
export function parseToolValidatedNarration(text: string, offeredToolNames: readonly string[]): NarratedToolCall[] {
	if (!text || offeredToolNames.length === 0) {
		return [];
	}
	const offered = new Set(offeredToolNames);
	const calls: NarratedToolCall[] = [];
	for (const objectText of extractAllJsonObjects(text)) {
		const repaired = repairJsonValue(objectText);
		if (!repaired.ok) {
			continue;
		}
		const call = toNarratedToolCall(repaired.value);
		if (call && offered.has(call.toolName)) {
			calls.push(call);
		}
	}
	return calls;
}

function aliasKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "");
}

function withoutTrailingNumericSuffix(value: string): string {
	return value.replace(/(?:[_-]+[0-9]+)+$/u, "");
}

function narratedToolNameAliasCandidates(toolName: string): string[] {
	const candidates = new Set<string>();
	const trimmed = toolName.trim();
	const lastDottedSegment = trimmed.split(".").at(-1)?.trim() ?? "";
	for (const candidate of [trimmed, lastDottedSegment]) {
		if (!candidate) {
			continue;
		}
		candidates.add(candidate);
		const withoutSuffix = withoutTrailingNumericSuffix(candidate);
		if (withoutSuffix) {
			candidates.add(withoutSuffix);
		}
	}
	return [...candidates];
}

/**
 * Resolve a narrated tool name against the tools offered on the current turn.
 *
 * Root cause this guards: a live swarm run recovered `<function=sequential_thinking_sequentialthinking_1>…` from a
 * Qwen turn while the actual SDK MCP tool was `sequential-thinking__sequentialthinking`; executing the polluted name
 * produced `Unknown tool` and exhausted the card. The alias pass is deliberately constrained to the offered set and
 * must be unambiguous, so it repairs punctuation / repeated-call suffix pollution without turning arbitrary model text
 * into executable tools.
 */
export function resolveNarratedToolName(toolName: string, offeredToolNames: readonly string[]): string | null {
	const trimmed = toolName.trim();
	if (!trimmed || offeredToolNames.length === 0) {
		return null;
	}
	if (offeredToolNames.includes(trimmed)) {
		return trimmed;
	}
	const caseMatches = offeredToolNames.filter((offered) => offered.toLowerCase() === trimmed.toLowerCase());
	if (caseMatches.length === 1) {
		return caseMatches[0];
	}

	const offeredByAliasKey = new Map<string, Set<string>>();
	for (const offered of offeredToolNames) {
		const key = aliasKey(offered);
		if (!key) {
			continue;
		}
		const values = offeredByAliasKey.get(key) ?? new Set<string>();
		values.add(offered);
		offeredByAliasKey.set(key, values);
	}

	for (const candidate of narratedToolNameAliasCandidates(trimmed)) {
		const matches = offeredByAliasKey.get(aliasKey(candidate));
		if (matches?.size === 1) {
			return [...matches][0];
		}
	}
	return null;
}

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
	if (
		!text ||
		!(
			TOOL_CALL_MARKER.test(text) ||
			GEMMA_TOOL_CODE_MARKER.test(text) ||
			PLAIN_PROSE_TOOL_CALL.test(text) ||
			BRACKET_ARGS_TOOL_CALL_MARKER.test(text)
		)
	) {
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

	// `<function=NAME>{args}</function>` — the tool name is in the tag, the body is the arguments JSON. Match only the
	// opener and pull the arguments as the first balanced JSON value after it, then skip PAST that value: a `</function>`
	// or `<function=…>` appearing inside a string argument must neither truncate the JSON nor spawn a spurious call.
	NAMED_FUNCTION_OPENER.lastIndex = 0;
	let namedMatch: RegExpExecArray | null = NAMED_FUNCTION_OPENER.exec(text);
	while (namedMatch !== null) {
		const toolName = namedMatch[1]?.trim();
		const contentStart = namedMatch.index + namedMatch[0].length;
		const span = extractBalancedJsonSpan(text, contentStart);
		if (toolName) {
			const repaired = repairJsonValue(span ? span.json : text.slice(contentStart));
			calls.push({ toolName, input: repaired.ok ? repaired.value : {} });
		}
		if (span && span.end > NAMED_FUNCTION_OPENER.lastIndex) {
			NAMED_FUNCTION_OPENER.lastIndex = span.end;
		}
		namedMatch = NAMED_FUNCTION_OPENER.exec(text);
	}

	// DeepSeek-V3 / R1: `<｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME ```json {…} ``` <｜tool▁call▁end｜>` — the tool
	// name lives in the header (after the separator), the arguments in the fenced JSON tail.
	DEEPSEEK_TOOL_CALL.lastIndex = 0;
	let deepSeekMatch: RegExpExecArray | null = DEEPSEEK_TOOL_CALL.exec(text);
	while (deepSeekMatch !== null) {
		const body = deepSeekMatch[1] ?? "";
		// Drop everything up to and including the separator (the leading `function` type token), then read the name as
		// the first identifier run before the arguments JSON.
		const header =
			body
				.split(DEEPSEEK_TOOL_SEP)
				.at(-1)
				?.replace(/^\s*function\b/i, "") ?? "";
		const toolName = header.match(/[A-Za-z0-9_.-]+/u)?.[0]?.trim();
		if (toolName) {
			const repaired = repairJsonValue(header);
			calls.push({ toolName, input: repaired.ok ? repaired.value : {} });
		}
		deepSeekMatch = DEEPSEEK_TOOL_CALL.exec(text);
	}

	// Gemma `tool_code` Python-call narration (`tool_code = read_file(filename="…")`) — the name + kwargs become a call.
	calls.push(...parseGemmaToolCodeCalls(text));

	// Devstral / LM Studio `name[ARGS]{json}` narration — recover the explicit transcript form.
	calls.push(...parseBracketArgsToolCalls(text));

	// Plain-prose `Tool call: name(kwargs)` narration (gemma-e2b e2e dialect) — recover, don't just strip for display.
	calls.push(...parsePlainProseToolCalls(text));

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
	if (!text) {
		return text;
	}
	let cut = text.length;
	// Structured family markers (Hermes/Qwen/Mistral/Phi/etc.) — gated behind the cheap pre-check.
	if (TOOL_CALL_MARKER.test(text)) {
		TOOL_CALL_OPENER.lastIndex = 0;
		const opener = TOOL_CALL_OPENER.exec(text);
		if (opener) {
			cut = Math.min(cut, opener.index);
		}
		const named = /<function\s*=/i.exec(text);
		if (named) {
			cut = Math.min(cut, named.index);
		}
		const deepSeek = DEEPSEEK_OPENER.exec(text);
		if (deepSeek) {
			cut = Math.min(cut, deepSeek.index);
		}
	}
	// Plain-prose `Tool call: name(...)` narration (checked independently — its lead-in has a space, not the
	// underscore the structured pre-check looks for).
	const plainProse = PLAIN_PROSE_TOOL_CALL.exec(text);
	if (plainProse) {
		cut = Math.min(cut, plainProse.index);
	}
	const bracketArgs = BRACKET_ARGS_TOOL_CALL_MARKER.exec(text);
	if (bracketArgs) {
		cut = Math.min(cut, bracketArgs.index);
	}
	// Preserve the exact no-op (return the original, untrimmed) when nothing matched.
	return cut === text.length ? text : text.slice(0, cut).trim();
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
export function recoverNarratedToolCalls(
	message: AgentMessage,
	options: NarratedToolCallRecoveryOptions = {},
): AgentToolCallPart[] {
	if (message.content.some((part) => part.type === "tool-call")) {
		return [];
	}
	const parsedCalls = parseNarratedToolCalls(readNarratableText(message));
	const calls = options.offeredToolNames
		? parsedCalls.flatMap((call) => {
				const resolvedToolName = resolveNarratedToolName(call.toolName, options.offeredToolNames ?? []);
				return resolvedToolName ? [{ ...call, toolName: resolvedToolName }] : [];
			})
		: parsedCalls;
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
