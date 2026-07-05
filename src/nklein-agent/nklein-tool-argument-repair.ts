/**
 * Lenient JSON recovery for tool arguments emitted by small/quantized local models.
 *
 * Constrained decoding (grammar/JSON-schema) is the ideal guarantee, but the NKlein SDK loop can't send it, so
 * tool arguments arriving through the SDK must be recovered post-hoc. Small models routinely emit *near*-valid
 * JSON: wrapped in ```json code fences, prefixed with prose, with trailing commas, single quotes, unquoted
 * keys, or truncated trailing brackets. This module is the single, shared, well-tested recovery used by every
 * !Klein tool parser (decompose_project, write_files, edit_file) instead of each re-implementing its own
 * tolerance.
 */

export interface JsonRepairResult {
	ok: boolean;
	value?: unknown;
	/** How the value was obtained, for telemetry/debugging. */
	strategy?: "passthrough" | "parsed" | "unfenced" | "extracted" | "repaired";
}

/** Returns the parsed value if `value` is already a non-string object/array (SDK already parsed it). */
function passthrough(value: unknown): JsonRepairResult | null {
	if (value !== null && typeof value === "object") {
		return { ok: true, value, strategy: "passthrough" };
	}
	return null;
}

function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	const fence = trimmed.match(/^```(?:json|json5)?\s*\n?([\s\S]*?)\n?```$/u);
	return fence ? fence[1].trim() : trimmed;
}

/** Extracts the first balanced JSON object/array substring, ignoring braces inside strings. */
function extractBalanced(text: string): string | null {
	const start = text.search(/[[{]/u);
	if (start < 0) {
		return null;
	}
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
				return text.slice(start, i + 1);
			}
		}
	}
	// Unbalanced (truncated): close the open brackets we still owe.
	if (depth > 0) {
		return text.slice(start) + close.repeat(depth);
	}
	return null;
}

/**
 * Convert single-quoted strings to double-quoted, but ONLY outside already-double-quoted strings. A plain regex
 * (`/'([^'"\\]*)'/`) is NOT string-context-aware: on a valid double-quoted value like `"don't break the 'build' step"`
 * it pairs the apostrophe after `don` with the quote before `build`, rewriting the value to invalid JSON and dropping the
 * whole tool call. This scanner tracks double-quote state (honoring escapes) and leaves in-string apostrophes untouched,
 * converting only single-quoted runs that appear OUTSIDE a double-quoted string (the `{k:'v'}` case the repair targets).
 */
function convertSingleQuotedStrings(text: string): string {
	let out = "";
	let inDouble = false;
	for (let i = 0; i < text.length; ) {
		const ch = text[i];
		if (inDouble) {
			if (ch === "\\" && i + 1 < text.length) {
				out += ch + text[i + 1]; // keep the escaped char pair verbatim
				i += 2;
				continue;
			}
			if (ch === '"') {
				inDouble = false;
			}
			out += ch;
			i += 1;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			out += ch;
			i += 1;
			continue;
		}
		if (ch === "'") {
			// Scan a single-quoted run (same character class as the old regex: no raw double-quote or backslash inside).
			let j = i + 1;
			let content = "";
			let clean = true;
			while (j < text.length && text[j] !== "'") {
				if (text[j] === '"' || text[j] === "\\") {
					clean = false;
					break;
				}
				content += text[j];
				j += 1;
			}
			if (clean && j < text.length && text[j] === "'") {
				out += `"${content}"`;
				i = j + 1;
				continue;
			}
		}
		out += ch;
		i += 1;
	}
	return out;
}

/** Light structural repairs that don't change valid JSON: trailing commas, single→double quotes on keys/values. */
function repairCommon(text: string): string {
	const structural = text
		// Remove trailing commas before } or ].
		.replace(/,(\s*[}\]])/gu, "$1")
		// Quote unquoted object keys: { key: ... } -> { "key": ... }.
		.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/gu, '$1"$2"$3');
	return convertSingleQuotedStrings(structural);
}

/**
 * Best-effort recovery of a JSON value from a model-emitted string (or already-parsed object).
 * Tries, in order: passthrough → direct parse → unfence → balanced extraction → common repairs.
 */
export function repairJsonValue(input: unknown): JsonRepairResult {
	const direct = passthrough(input);
	if (direct) {
		return direct;
	}
	if (typeof input !== "string") {
		return { ok: false };
	}
	const trimmed = input.trim();
	if (!trimmed) {
		return { ok: false };
	}
	try {
		return { ok: true, value: JSON.parse(trimmed), strategy: "parsed" };
	} catch {
		// fall through
	}
	const unfenced = stripCodeFence(trimmed);
	if (unfenced !== trimmed) {
		try {
			return { ok: true, value: JSON.parse(unfenced), strategy: "unfenced" };
		} catch {
			// fall through
		}
	}
	const extracted = extractBalanced(unfenced);
	if (extracted) {
		try {
			return { ok: true, value: JSON.parse(extracted), strategy: "extracted" };
		} catch {
			try {
				return { ok: true, value: JSON.parse(repairCommon(extracted)), strategy: "repaired" };
			} catch {
				// fall through
			}
		}
	}
	try {
		return { ok: true, value: JSON.parse(repairCommon(unfenced)), strategy: "repaired" };
	} catch {
		return { ok: false };
	}
}

/** Parses a value that should be a JSON object/array, returning the original if it already is one. */
export function repairJsonStringValue(value: unknown): unknown {
	const result = repairJsonValue(value);
	return result.ok ? result.value : value;
}
