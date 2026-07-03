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
// toolErrorFromZodError — the tool-arg rejection seam adapter
// ---------------------------------------------------------------------------

type ZodToolIssue = z.ZodError["issues"][number];

/** Map a single Zod issue to the contract's `code` + the human-readable `expected`/`received` fields. */
function mapZodIssue(issue: ZodToolIssue): Pick<ToolErrorContract, "code" | "expected" | "received"> {
	switch (issue.code) {
		case "invalid_type": {
			// v4 folds the received value into the message ("… received undefined"); recover it for `received`.
			const received = /received (\S+)/.exec(issue.message)?.[1];
			const missing = received === "undefined" || received === "null";
			return {
				code: missing ? "MISSING_FIELD" : "INVALID_TYPE",
				expected: issue.expected,
				...(received !== undefined ? { received } : {}),
			};
		}
		case "too_big":
			return {
				code: "OUT_OF_RANGE",
				expected: `${issue.origin ?? "value"} ${issue.inclusive ? "≤" : "<"} ${issue.maximum}`,
			};
		case "too_small":
			return {
				code: "OUT_OF_RANGE",
				expected: `${issue.origin ?? "value"} ${issue.inclusive ? "≥" : ">"} ${issue.minimum}`,
			};
		case "invalid_value":
			return { code: "INVALID_VALUE", expected: `one of ${issue.values.map((v) => JSON.stringify(v)).join(", ")}` };
		case "unrecognized_keys":
			return { code: "UNRECOGNIZED_KEY", received: issue.keys.join(", ") };
		case "invalid_format":
			return { code: "INVALID_FORMAT" };
		default:
			return { code: "INVALID_ARGUMENT" };
	}
}

/**
 * Build a {@link ToolErrorContract} from a Zod validation failure at the tool-arg rejection seam (§5.O "EMIT it at
 * the tool-arg rejection seam, not prose"). Small models repair one problem at a time, so this reports the FIRST
 * issue (Zod orders them by traversal): its dot-path becomes `field`, its `code` maps to a SCREAMING_SNAKE class,
 * and its message becomes the `hint`. A missing required field (`invalid_type` with `received: undefined`) is
 * distinguished from a wrong-typed field so the model knows to ADD vs. FIX an arg. Every arg-rejection error is
 * `retryable` — the model can always re-supply args — and the caller may pass `minimalValidExample` to seed the retry.
 */
export function toolErrorFromZodError(
	error: z.ZodError,
	options?: { minimalValidExample?: string },
): ToolErrorContract {
	const issue = error.issues[0];
	if (issue === undefined) {
		// Defensive: an empty ZodError should not occur, but must still yield a valid contract.
		return { code: "INVALID_ARGUMENT", retryable: true };
	}

	const field = issue.path.map((segment) => String(segment)).join(".");
	const mapped = mapZodIssue(issue);

	return {
		...mapped,
		...(field.length > 0 ? { field } : {}),
		retryable: true,
		...(options?.minimalValidExample !== undefined ? { minimalValidExample: options.minimalValidExample } : {}),
		hint: issue.message,
	};
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
