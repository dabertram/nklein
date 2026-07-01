/**
 * The §5.AA failure-SIGNATURE classifier — map a RAW error/outcome text (a thrown error's message, an endpoint's error
 * body, a raw failure line) into a STABLE remedy-routing category, so the adaptive retry brain can pick the right ladder.
 *
 * WHAT: when an attempt THROWS (or ends with a raw failure string rather than a pre-parsed turn), the §5.AA retry engine
 * needs to know WHICH `ModelOutcomeKind` bucket to route it to before it can choose a remedy. The existing classifiers
 * only cover PARTS of this: `classifyTurnOutcome` ([adaptive-attempt-loop.ts](./adaptive-attempt-loop.ts)) needs the turn
 * already parsed into booleans (tool-calls-emitted, looped, malformed…); `classifyCompletionOutcome`
 * ([completion-stop-reason.ts](./completion-stop-reason.ts)) only reads a *stop-reason* string and returns the SEPARATE
 * `CompletionOutcome` enum; `isTransientNetworkError` ([transient-error.ts](./transient-error.ts)) is a boolean for ONE
 * bucket. None takes an arbitrary raw error/output string and returns the `ModelOutcomeKind` the ladder consumes. This
 * closes that gap: `classifyFailureSignature(rawText)` → `{ signature, outcome, remediable, reason }`.
 *
 * WHY: routing by signature keeps the "try everything" ladder targeted (§5.AA) — a CONTEXT-OVERFLOW error must shrink the
 * window (`aborted` → context_shrink lives high in its ladder), a MALFORMED-JSON parse error must force a schema
 * (`malformed`), a MODEL-NOT-LOADED / endpoint-gone error is NOT a model-capability failure at all (a fresh re-run won't
 * help — it's flagged `remediable:false` so the loop can surface/escalate instead of burning retries), a transient TIMEOUT
 * is an `aborted` re-run. Feeding `classifyFailureSignature(err).outcome` into `retryLadderForOutcome` / `planNextAttempt`
 * (retry-policy.ts) lets a thrown error drive the SAME learned ladder a parsed turn does — one taxonomy, no per-caller
 * ad-hoc `err.message.includes(...)` drift.
 *
 * Pure + deterministic + defensive: extracts a lowercased message from any error shape (Error · string · {message} ·
 * nested `cause`), matches an ordered most-specific-first table, and falls back to `other_failure` (NEVER throws, never
 * mis-reads an unknown error as success). Composes with the existing `ModelOutcomeKind` by import only (no edits).
 */

import type { ModelOutcomeKind } from "./model-behavior-profile";

/**
 * A stable remedy-routing category for a raw failure. Distinct from `ModelOutcomeKind` (the ladder-keying taxonomy)
 * because several signatures share one outcome yet warrant a distinct human label / remediability — e.g. both
 * `context_overflow` and `stream_timeout` route to `aborted`, but only one is fixed by shrinking the window, and
 * `model_unavailable` routes to `other_failure` yet is NOT worth a same-model retry. Single source for the union + a
 * wire-contract enum if one is ever needed.
 */
export const FAILURE_SIGNATURES = [
	/** The endpoint/model is gone or not loaded (404, model-not-found, connection refused) — NOT a capability failure. */
	"model_unavailable",
	/** The context WINDOW filled (prompt too long for the model) — must compact/shrink, not re-ask bigger. */
	"context_overflow",
	/** The generation token budget was hit (`max_tokens` / length) — a truncation; re-ask with a bigger budget. */
	"token_budget",
	/** A network/stream TIMEOUT or connection blip (undici body/headers timeout, ECONNRESET) — transient, re-run. */
	"stream_timeout",
	/** The caller/user aborted the request/stream. */
	"aborted_request",
	/** A safety filter / refusal fired. */
	"content_filtered",
	/** Malformed tool arguments / unparseable JSON (a `SyntaxError`, "invalid json", schema-parse failure). */
	"malformed_output",
	/** A rate limit / server-overload throttle (429 / "rate limit" / "overloaded") — back off + retry. */
	"rate_limited",
	/** The model looped / repeated itself without progressing. */
	"response_loop",
	/** A generic/unrecognized error — the conservative default. */
	"unknown_error",
] as const;

export type FailureSignatureKind = (typeof FAILURE_SIGNATURES)[number];

/** The classification verdict for one raw failure. */
export interface FailureSignature {
	/** The stable remedy-routing category. */
	signature: FailureSignatureKind;
	/** The §5.AA outcome taxonomy bucket this signature routes to — feed into `retryLadderForOutcome` / `planNextAttempt`. */
	outcome: ModelOutcomeKind;
	/**
	 * Whether retrying THIS model plausibly helps. `false` for signatures where a same-model retry is futile (the endpoint
	 * is gone, or a safety refusal) — the loop should surface/escalate rather than burn the budget. `true` otherwise (the
	 * ladder has a targeted rung: shrink context, raise the budget, force a schema, back off, carry to another model…).
	 */
	remediable: boolean;
	/** Inspectable reason (for the §5.AG "what was tried" surface + the §5.AF ledger). */
	reason: string;
}

/** Extract a lowercased message from an unknown error value (Error · string · {message} · nested `cause`). Never throws. */
function extractErrorText(error: unknown): string {
	if (typeof error === "string") {
		return error.toLowerCase();
	}
	if (error instanceof Error) {
		// `error.cause` often carries the real underlying code (e.g. an undici UND_ERR_* or a nested HTTP body) — include it.
		const cause = (error as { cause?: unknown }).cause;
		const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
		return `${error.name} ${error.message} ${causeText}`.toLowerCase();
	}
	if (error && typeof error === "object") {
		const record = error as { message?: unknown; error?: unknown };
		if (typeof record.message === "string") {
			return record.message.toLowerCase();
		}
		// Some endpoints wrap the text as `{ error: "..." }` or `{ error: { message: "..." } }`.
		if (typeof record.error === "string") {
			return record.error.toLowerCase();
		}
		if (record.error && typeof record.error === "object" && "message" in record.error) {
			const nested = (record.error as { message?: unknown }).message;
			if (typeof nested === "string") {
				return nested.toLowerCase();
			}
		}
	}
	return "";
}

interface SignatureRule {
	signature: FailureSignatureKind;
	outcome: ModelOutcomeKind;
	remediable: boolean;
	reason: string;
	matches: (text: string) => boolean;
}

const has =
	(...needles: readonly string[]) =>
	(text: string): boolean =>
		needles.some((needle) => text.includes(needle));

/**
 * Ordered most-specific-first. Order is LOAD-BEARING: a context-window overflow ("maximum context length … tokens") also
 * contains "tokens", so it MUST be checked before the generic token-budget rule; a model-unavailable "connection refused"
 * would also match a transient blip, so `model_unavailable` (which forbids a same-model retry) is checked before
 * `stream_timeout`. First match wins.
 */
const SIGNATURE_RULES: readonly SignatureRule[] = [
	{
		signature: "model_unavailable",
		outcome: "other_failure",
		remediable: false,
		reason:
			"The endpoint/model is unavailable (not loaded / not found / connection refused) — a same-model retry won't help; surface or route to another model.",
		matches: has(
			"model not found",
			"model_not_found",
			"no model loaded",
			"no models loaded",
			"model is not loaded",
			"failed to load model",
			"connection refused",
			"econnrefused",
			"enotfound",
			"getaddrinfo",
			"404",
			"not found",
		),
	},
	{
		signature: "context_overflow",
		outcome: "aborted",
		remediable: true,
		reason:
			"The prompt exceeded the model's context window — compact/shrink the context (raising max_tokens won't help).",
		matches: has(
			"context length",
			"context window",
			"contextlengthreached",
			"context overflow",
			"maximum context",
			"exceeds the context",
			"prompt is too long",
			"too many tokens",
			"input is too long",
			"reduce the length of the messages",
		),
	},
	{
		signature: "token_budget",
		outcome: "aborted",
		remediable: true,
		reason:
			"Generation hit the output-token budget (truncated before finishing) — re-ask with a larger max_tokens budget.",
		matches: has(
			"max_tokens",
			"maxtokens",
			"maxpredictedtokens",
			"max output tokens",
			"finish_reason: length",
			"finish_reason:length",
			'"length"',
			"length limit",
			"output token limit",
			"truncat",
		),
	},
	{
		signature: "rate_limited",
		outcome: "aborted",
		remediable: true,
		reason: "The endpoint rate-limited or is overloaded — back off and retry (transient).",
		matches: has("rate limit", "rate_limit", "429", "too many requests", "overloaded", "quota", "try again later"),
	},
	{
		signature: "stream_timeout",
		outcome: "aborted",
		remediable: true,
		reason:
			"A network/stream timeout or connection blip — the model is reachable but slow/hiccuped; a bounded re-run usually recovers.",
		matches: has(
			"body timeout",
			"headers timeout",
			"headerstimeouterror",
			"bodytimeouterror",
			"und_err_body_timeout",
			"und_err_headers_timeout",
			"und_err_connect_timeout",
			"und_err_socket",
			"etimedout",
			"timed out",
			"timeout",
			"econnreset",
			"socket hang up",
			"fetch failed",
			"premature close",
			"connection reset",
			"network error",
			"502",
			"503",
			"bad gateway",
			"service unavailable",
			"temporarily unavailable",
		),
	},
	{
		signature: "aborted_request",
		outcome: "aborted",
		remediable: true,
		reason: "The request/stream was aborted (user-stopped / cancelled) — re-run the turn.",
		matches: has(
			"aborterror",
			"the operation was aborted",
			"request aborted",
			"userstopped",
			"cancelled",
			"canceled",
		),
	},
	{
		signature: "content_filtered",
		outcome: "other_failure",
		remediable: false,
		reason: "A safety filter/refusal fired — a plain retry won't change it; rephrase or surface for a user decision.",
		matches: has(
			"content filter",
			"content_filter",
			"contentfiltered",
			"content policy",
			"safety",
			"refus",
			"i can't help",
			"i cannot help",
			"i can't assist",
			"i cannot assist",
			"i'm not able to",
		),
	},
	{
		signature: "malformed_output",
		outcome: "malformed",
		remediable: true,
		reason:
			"The model produced malformed/unparseable output (invalid JSON or bad tool arguments) — force a valid shape (constrained schema).",
		matches: has(
			"syntaxerror",
			"invalid json",
			"unexpected token",
			"unexpected end of json",
			"json parse",
			"failed to parse",
			"could not parse",
			"malformed",
			"invalid tool",
			"invalid arguments",
			"schema validation",
			"does not match schema",
			"zoderror",
		),
	},
	{
		signature: "response_loop",
		outcome: "loop",
		remediable: true,
		reason:
			"The model looped / repeated itself without progressing — salvage what it produced and retry with a shrunk/rearranged context.",
		matches: has("repetition", "repeated the same", "looping", "loop detected", "no progress", "stuck repeating"),
	},
];

/**
 * Classify a RAW error value / failure text into a stable §5.AA failure signature + the `ModelOutcomeKind` it routes to
 * (pure). Accepts anything the loop might catch — an `Error`, a raw string, an endpoint's `{error}` object — extracts a
 * lowercased message (including nested `cause`), and matches the ordered most-specific-first table. An empty/unreadable
 * message OR an unrecognized error ⇒ `unknown_error` → `other_failure` (remediable; a generic retry is the safe default —
 * NEVER treated as success). This is the raw-text sibling to `classifyTurnOutcome` (structured signals) and
 * `classifyCompletionOutcome` (stop-reason strings); route its `.outcome` into `retryLadderForOutcome` / `planNextAttempt`.
 */
export function classifyFailureSignature(error: unknown): FailureSignature {
	const text = extractErrorText(error);
	if (text.trim().length === 0) {
		return {
			signature: "unknown_error",
			outcome: "other_failure",
			remediable: true,
			reason:
				"No readable error message — classify conservatively as a generic failure (a plain retry is the safe default).",
		};
	}
	for (const rule of SIGNATURE_RULES) {
		if (rule.matches(text)) {
			return {
				signature: rule.signature,
				outcome: rule.outcome,
				remediable: rule.remediable,
				reason: rule.reason,
			};
		}
	}
	return {
		signature: "unknown_error",
		outcome: "other_failure",
		remediable: true,
		reason:
			"The error did not match a known failure signature — classify conservatively as a generic failure (retryable).",
	};
}

/**
 * Whether a raw error is worth retrying on the SAME model — a convenience over `classifyFailureSignature(error).remediable`
 * for the loop's guard ("should I even try a rung, or surface?"). `false` for a gone endpoint / safety refusal; `true`
 * otherwise (the ladder has a targeted rung).
 */
export function isRemediableFailure(error: unknown): boolean {
	return classifyFailureSignature(error).remediable;
}
