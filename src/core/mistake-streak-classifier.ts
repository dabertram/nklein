/**
 * Classify a consecutive-mistake streak for the abandonment decision (David 2026-07-29: "do soften").
 *
 * G6.8a campaign evidence (v6/v7: 43 blocked re-reads → repeated fast abandonments; v10: three absolute-path
 * read blocks abandoned an architect in 3 seconds): POLICY-GUARD rejections — the anti-re-read guard, workspace
 * path fences, the post-edit syntax guard — are !Klein STEERING the model with corrective guidance, yet they
 * counted as `tool_execution_failed` mistakes and tripped the 3-consecutive abandonment, killing sessions with
 * the very mechanism built to correct them. A streak made ENTIRELY of such corrective blocks warrants a bounded
 * guided continue, not a stop; genuine execution/parse failures keep the abandonment teeth.
 *
 * The repeated-tool-call loop escalation ("Detected repeated tool calls…") stays GENUINE on purpose — that is
 * the loop guard's deliberate, bounded park decision (paired with budget_wall), not a correction to follow.
 */

const POLICY_GUIDANCE_PATTERNS: readonly RegExp[] = [
	// Anti-re-read guard (both variants) and any sibling "Blocked <tool>:" fence wording.
	/Blocked \w+:/,
	// Workspace path fences (sandbox tools + read/write guards).
	/outside the workspace/i,
	// F12.63 post-edit syntax guard rejection wording (matched on wording, not tool name — see the N2 cell).
	/would break|left the file broken|syntactically broken/i,
];

const GENUINE_OVERRIDE_PATTERNS: readonly RegExp[] = [
	// The repeated-tool-call guard's hard escalation is a designed stop, never a correction to retry past.
	/Detected repeated tool calls/i,
];

export type MistakeStreakClass = "policy_guidance" | "genuine";

/**
 * A streak is `policy_guidance` only when the details carry at least one corrective-guard block AND no
 * genuine-failure marker. Mixed or unrecognized streaks stay `genuine` — the soften must never weaken the
 * abandonment for real execution failures (fail-closed toward the existing behavior).
 */
export function classifyMistakeStreak(details: string | null | undefined): MistakeStreakClass {
	const text = details?.trim() ?? "";
	if (text.length === 0) {
		return "genuine";
	}
	if (GENUINE_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text))) {
		return "genuine";
	}
	if (!POLICY_GUIDANCE_PATTERNS.some((pattern) => pattern.test(text))) {
		return "genuine";
	}
	// Every failure segment must look like a guard block: a segment mentioning a tool failure without any
	// guard wording means a real failure is mixed into the streak. The "N tool call(s) failed:" header is
	// attached to the FIRST failure segment — strip the prefix, never the segment (dropping it would hide a
	// genuine first failure and mislabel a mixed streak).
	const segments = text
		.split(/;\s*/)
		.map((segment) => segment.trim().replace(/^\d+ tool call\(s\) failed:?\s*/, ""))
		.filter((segment) => segment.length > 0);
	const looksLikeGuardBlock = (segment: string): boolean =>
		POLICY_GUIDANCE_PATTERNS.some((pattern) => pattern.test(segment));
	if (segments.length > 0 && !segments.every(looksLikeGuardBlock)) {
		return "genuine";
	}
	return "policy_guidance";
}

/** Guided continues allowed per session before a policy-guidance streak stops anyway (guidance-deafness bound). */
export const POLICY_GUIDANCE_SOFT_CONTINUE_LIMIT = 3;

/** The corrective nudge appended when a policy-guidance streak is softened into a continue. */
export function buildPolicyGuidanceContinueMessage(): string {
	return (
		"Your recent tool calls were BLOCKED by !Klein policy guards — these are corrections, not failures. " +
		"Follow the guidance inside each blocked result (use content you already have, keep paths inside the " +
		"workspace, fix the edit shape) and take the next constructive step. Do not repeat a blocked call verbatim."
	);
}
