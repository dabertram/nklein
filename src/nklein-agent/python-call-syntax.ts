import { repairJsonValue } from "./nklein-tool-argument-repair";

/**
 * Pure parsers for Python-style call syntax, extracted from nklein-narrated-tool-call — used to
 * recover the Gemma `tool_code` dialect (`name(k="v", n=2, xs=[…])`). All operate on raw text with
 * string/bracket-aware scanning, so they are behavior-preserving and unit-testable.
 */

/** Scan from an opening bracket at `openParenIdx` to its matching close (string/nesting aware), returning the inner body and close index. */
export function extractBalancedParens(text: string, openParenIdx: number): { body: string; end: number } | null {
	let depth = 0;
	let inString: string | null = null;
	let escaped = false;
	for (let i = openParenIdx; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === inString) {
				inString = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
		} else if (ch === "(" || ch === "[" || ch === "{") {
			depth += 1;
		} else if (ch === ")" || ch === "]" || ch === "}") {
			depth -= 1;
			if (depth === 0) {
				return { body: text.slice(openParenIdx + 1, i), end: i };
			}
		}
	}
	return null;
}

/** Split a call-argument body on top-level commas (ignoring commas inside quotes / brackets / braces). */
export function splitTopLevelArgs(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let inString: string | null = null;
	let escaped = false;
	let start = 0;
	for (let i = 0; i < body.length; i += 1) {
		const ch = body[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === inString) {
				inString = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
		} else if (ch === "(" || ch === "[" || ch === "{") {
			depth += 1;
		} else if (ch === ")" || ch === "]" || ch === "}") {
			depth -= 1;
		} else if (ch === "," && depth === 0) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(body.slice(start));
	return parts;
}

/** Convert a single Python literal (string / number / bool / None / list / dict) to a JS value; raw string fallback. */
export function parsePythonValue(raw: string): unknown {
	const value = raw.trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	if (/^(?:true|false)$/i.test(value)) {
		return value.toLowerCase() === "true";
	}
	if (/^(?:none|null)$/i.test(value)) {
		return null;
	}
	if (/^-?\d+(?:\.\d+)?$/.test(value)) {
		return Number(value);
	}
	if (value.startsWith("[") || value.startsWith("{")) {
		// Lists/dicts of literals: Python single-quoted → JSON double-quoted, then reuse the robust JSON repair.
		const repaired = repairJsonValue(value.replace(/'/g, '"'));
		if (repaired.ok) {
			return repaired.value;
		}
	}
	return value;
}

/** Parse a Python keyword-argument body (`k="v", n=2, xs=[…]`) into an input object; positional args are skipped. */
export function parsePythonKwargs(body: string): Record<string, unknown> {
	const input: Record<string, unknown> = {};
	for (const part of splitTopLevelArgs(body)) {
		const trimmed = part.trim();
		if (!trimmed) {
			continue;
		}
		const eq = trimmed.indexOf("=");
		// A keyword arg is `name=value`; require a bare identifier name and not a comparison (`==`/`<=`/…).
		if (eq <= 0 || trimmed[eq + 1] === "=" || /[=!<>]/.test(trimmed[eq - 1] ?? "")) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			continue;
		}
		input[key] = parsePythonValue(trimmed.slice(eq + 1));
	}
	return input;
}
