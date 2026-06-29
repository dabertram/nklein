/**
 * Typed semantic error contract for small-model tool-call failures (todo §5.O).
 *
 * When a small model calls a tool with bad arguments the runtime must NOT return a raw stack trace
 * or an unstructured string.  Those are expensive in tokens, hard for the model to parse, and give
 * no signal about whether another attempt is worthwhile.  Instead we return a `ToolErrorContract` —
 * a minimal, typed, actionable error record — so the model can self-correct on the next turn with
 * zero wasted context.
 *
 * Ties directly to the adaptive-retry loop (§5.AA): `retryable` tells the loop whether to burn
 * another attempt, `minimalValidExample` gives the model the exact shape it needs, and `hint`
 * narrows the repair action to a single sentence.  Together this keeps small-model self-correction
 * cheap enough to be worth doing automatically.
 *
 * Usage pattern:
 *   ```ts
 *   const err: ToolErrorContract = { code: "MISSING_FIELD", field: "query", retryable: true,
 *     expected: "non-empty string", received: "undefined",
 *     minimalValidExample: '{"query":"find open bugs"}',
 *     hint: 'The "query" field is required.' };
 *   return formatToolError(err);
 *   ```
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema + inferred type
// ---------------------------------------------------------------------------

/**
 * Wire schema for a typed tool-error (§5.O).  All validation errors that reach a small model MUST
 * be normalised into this shape before being returned in the assistant message.
 */
export const toolErrorContractSchema = z.object({
	/**
	 * A short, SCREAMING_SNAKE_CASE code that uniquely identifies the failure class.
	 * Examples: `"MISSING_FIELD"`, `"INVALID_TYPE"`, `"OUT_OF_RANGE"`, `"UNKNOWN_TOOL"`.
	 */
	code: z.string(),

	/** The offending argument name (dot-path for nested fields, e.g. `"options.limit"`). */
	field: z.string().optional(),

	/** What the field/arg should have been (human-readable, e.g. `"positive integer ≤ 100"`). */
	expected: z.string().optional(),

	/** What the model actually supplied (human-readable, e.g. `"string \\"all\\""`). */
	received: z.string().optional(),

	/**
	 * Whether the §5.AA adaptive-retry loop should attempt this call again.
	 * `false` when the error is structural / the tool does not exist / the model cannot fix it.
	 */
	retryable: z.boolean(),

	/**
	 * The smallest valid JSON args object the model can copy-paste for the next attempt.
	 * Omit for non-retryable errors (saves tokens and avoids misleading the model).
	 */
	minimalValidExample: z.string().optional(),

	/** One-sentence repair hint.  Omit when `code` + `expected` already fully specify the fix. */
	hint: z.string().optional(),
});

/** Inferred TypeScript type — use this at call-sites instead of repeating the shape. */
export type ToolErrorContract = z.infer<typeof toolErrorContractSchema>;

// ---------------------------------------------------------------------------
// formatToolError — compact, token-frugal, model-readable message
// ---------------------------------------------------------------------------

/**
 * Render a `ToolErrorContract` as a compact, model-friendly string.
 *
 * Design choices (§5.O / small-model output robustness):
 * - Leads with `code` so a scanning model sees the error class in the first token.
 * - Emits `field`, `expected`, and `received` only when present (no "undefined" noise).
 * - Appends `hint` when it adds information beyond `expected`/`received`.
 * - Ends with a one-word retry signal so the §5.AA loop can grep it and the model can too.
 * - `minimalValidExample` is the last item so the model can act on it without reading the rest.
 */
export function formatToolError(err: ToolErrorContract): string {
	const parts: string[] = [];

	parts.push(`[${err.code}]`);

	if (err.field !== undefined) {
		parts.push(`field="${err.field}"`);
	}

	if (err.expected !== undefined && err.received !== undefined) {
		parts.push(`expected ${err.expected}, got ${err.received}`);
	} else if (err.expected !== undefined) {
		parts.push(`expected ${err.expected}`);
	} else if (err.received !== undefined) {
		parts.push(`got ${err.received}`);
	}

	if (err.hint !== undefined) {
		parts.push(err.hint);
	}

	if (err.minimalValidExample !== undefined) {
		parts.push(`example: ${err.minimalValidExample}`);
	}

	parts.push(err.retryable ? "Retry: yes." : "Retry: no.");

	return parts.join(" ");
}

// ---------------------------------------------------------------------------
// isRetryableToolError — named predicate for call-sites and the retry loop
// ---------------------------------------------------------------------------

/**
 * Named predicate consumed by the §5.AA adaptive-retry loop and any call site that needs to gate
 * on retryability without unpacking the full contract.
 */
export function isRetryableToolError(err: ToolErrorContract): boolean {
	return err.retryable;
}
