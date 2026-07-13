/**
 * F2.16a (§5.AU rung 5) — the ISOLATED LLM target picker that runs ONLY after the deterministic
 * `resolveMessageTarget` ladder returns `source:"ambiguous"` with several candidates. Its whole job is to choose
 * among the ALREADY-ENUMERATED candidates or ABSTAIN — it never invents a route, never starts a card, never
 * widens the candidate set. This module owns the pure prompt + the STRICT parse; the caller runs the isolated
 * model call and, on abstain, falls back to asking the operator (exactly today's `needs_clarify` behavior).
 *
 * Safety by construction: the parse accepts a chosen id ONLY when it is a member of the supplied candidate set;
 * anything else — an unknown id, a hallucinated route, empty output, malformed JSON — resolves to ABSTAIN. The
 * model can therefore never escalate ambiguity into a wrong action; the worst it can do is decline to help.
 */

export interface TargetPickerCandidate {
	/** The candidate's stable id (a card id, stream id, or `${taskId}:${kind}` answer key). */
	id: string;
	kind: "card" | "stream" | "answer";
	label: string;
}

/**
 * Build the isolated picker prompt. The model sees ONLY the message and the enumerated candidates and is
 * instructed to reply with a candidate's exact id or the literal `ABSTAIN`. No tools, no board, no history — the
 * caller runs this on a clean, isolated turn.
 */
export function buildTargetPickerPrompt(input: { message: string; candidates: readonly TargetPickerCandidate[] }): {
	system: string;
	user: string;
} {
	const system =
		"You disambiguate which existing item a chat message is addressing. You MUST reply with EITHER the exact " +
		"`id` of one of the listed candidates OR the single word ABSTAIN. Never invent an id, never suggest a new " +
		"item, never start anything. If the message does not clearly address exactly one candidate, reply ABSTAIN. " +
		"Reply with ONLY the id or ABSTAIN — no other words.";
	const list = input.candidates
		.map((candidate) => `- id: ${candidate.id}\n  kind: ${candidate.kind}\n  label: ${candidate.label}`)
		.join("\n");
	const user = `Message:\n"""${input.message.trim()}"""\n\nCandidates:\n${list}\n\nWhich candidate id does the message address, or ABSTAIN?`;
	return { system, user };
}

export type TargetPickerChoice = { chosenId: string } | { abstain: true };

/**
 * Parse the picker's raw reply against the candidate set. STRICT: returns `chosenId` only when the reply names an
 * id that is actually in `validIds`; every other case (ABSTAIN, unknown id, empty, extra prose that doesn't
 * cleanly resolve to one candidate) returns abstain. Matching tolerates surrounding whitespace/quotes/backticks
 * and a `id:` prefix, and is case-insensitive on the ABSTAIN keyword — but the id itself must match exactly.
 */
export function parseTargetPickerChoice(raw: string, validIds: readonly string[]): TargetPickerChoice {
	const valid = new Set(validIds);
	const cleaned = raw
		.trim()
		.replace(/^```[a-z]*\n?/i, "")
		.replace(/```$/i, "")
		.trim();
	if (cleaned.length === 0) {
		return { abstain: true };
	}
	// Strip an optional `id:` / `id =` prefix and surrounding quotes/backticks.
	const stripped = cleaned
		.replace(/^id\s*[:=]\s*/i, "")
		.replace(/^["'`]+|["'`]+$/g, "")
		.trim();
	if (/^abstain$/i.test(stripped)) {
		return { abstain: true };
	}
	// Exact-match first (the well-behaved case).
	if (valid.has(stripped)) {
		return { chosenId: stripped };
	}
	// A reply that embeds exactly one valid id (and no other) still resolves; ties or none ⇒ abstain.
	const embedded = validIds.filter((id) => new RegExp(`(^|[^\\w-])${escapeRegExp(id)}([^\\w-]|$)`).test(cleaned));
	return embedded.length === 1 ? { chosenId: embedded[0] } : { abstain: true };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
