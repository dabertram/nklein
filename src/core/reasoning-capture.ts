import { findPotentialSecretInText } from "./agent-write-guard.js";

/**
 * F2.23 (first a-leaf) — the SAFE reasoning-capture primitive. A model's reasoning channel (raw chain-of-thought)
 * must never be persisted or shown verbatim when it could leak a secret, and it must be bounded so a runaway CoT
 * can't bloat the store. This pure core produces a safe capture from a raw reasoning string:
 *
 *   - FAIL-CLOSED on secrets: if the reasoning matches the shared secret catalog ({@link findPotentialSecretInText}),
 *     the verbatim text is DROPPED for a neutral placeholder — never persist reasoning that might carry a token/key.
 *     (Masking just the offending span while keeping the rest is a later refinement; the safe default is to withhold.)
 *   - BOUNDED: otherwise the (trimmed) reasoning is capped at `maxChars` with an ellipsis, so the capture stays small.
 *
 * The persistence/display/reviewer-lens surfaces (the F2.23 b-leaf) consume this; it changes no behavior on its own.
 */

export interface SafeReasoningCapture {
	/** The safe-to-persist/display text: a placeholder when a secret was detected, else the bounded reasoning. */
	text: string;
	/** True when a potential secret caused the verbatim reasoning to be withheld. */
	redactedForSecret: boolean;
	/** True when the (secret-free) reasoning was truncated to fit `maxChars`. */
	truncated: boolean;
}

const SECRET_PLACEHOLDER = "[reasoning withheld — it contained a potential secret]";

export function buildSafeReasoningCapture(
	rawReasoning: string,
	options: { maxChars?: number } = {},
): SafeReasoningCapture {
	const maxChars = Math.max(1, Math.trunc(options.maxChars ?? 2000));
	if (findPotentialSecretInText(rawReasoning) !== null) {
		return { text: SECRET_PLACEHOLDER, redactedForSecret: true, truncated: false };
	}
	const trimmed = rawReasoning.trim();
	if (trimmed.length <= maxChars) {
		return { text: trimmed, redactedForSecret: false, truncated: false };
	}
	return { text: `${trimmed.slice(0, maxChars)}…`, redactedForSecret: false, truncated: true };
}
