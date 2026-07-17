/**
 * F12.65 tool-output cap — PURE core.
 *
 * One oversized tool result can blow a small model's whole context window (the audit found every built-in tool
 * already capped — SDK read/search/command all middle-truncate with pagination hints — but MCP tool results pass
 * through UNBOUNDED, and a codebase-memory query has OOM'd a session before). This cap middle-truncates: the head
 * carries the answer's start, the tail carries totals/summaries that many tools put last, and the elision note tells
 * the model how to narrow the query. Objects are stringified before measuring so a huge structured result is caught
 * the same as a huge string.
 */

export interface CappedToolResult {
	/** The delivered value: the original when under the cap, else the middle-truncated STRING form. */
	readonly value: unknown;
	readonly truncated: boolean;
	readonly originalChars: number;
}

/** Default cap ≈ 6k tokens — generous for an answer, harmless to a 32k-floor context. */
export const DEFAULT_TOOL_OUTPUT_CAP_CHARS = 24_000;

export function capToolResult(result: unknown, maxChars: number = DEFAULT_TOOL_OUTPUT_CAP_CHARS): CappedToolResult {
	const text =
		typeof result === "string"
			? result
			: (() => {
					try {
						return JSON.stringify(result);
					} catch {
						return null;
					}
				})();
	if (text === null) {
		// Review-found: an unmeasurable result (cyclic/BigInt from an arbitrary MCP server) passed through
		// UNBOUNDED — the exact hole this cap exists to close. Refuse it with a actionable placeholder instead.
		return {
			value: "[tool result withheld: not JSON-serializable (cyclic or BigInt) — return plain data or a string]",
			truncated: true,
			originalChars: 0,
		};
	}
	if (text.length <= maxChars) {
		return { value: result, truncated: false, originalChars: text.length };
	}
	const headChars = Math.floor(maxChars * 0.7);
	const tailChars = maxChars - headChars;
	const elided = text.length - headChars - tailChars;
	return {
		value: `${text.slice(0, headChars)}\n\n[... middle-truncated: ${elided.toLocaleString()} of ${text.length.toLocaleString()} chars elided — narrow the query or request a specific page/range ...]\n\n${text.slice(text.length - tailChars)}`,
		truncated: true,
		originalChars: text.length,
	};
}
