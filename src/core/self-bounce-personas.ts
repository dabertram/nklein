/**
 * §5.AD self-bounce personas — the prompt substrate behind the enforced-reasoning gate's `self_bounce_varied` kind.
 * Research grounding (Huang et al.: bare "are you sure?" self-correction HURTS without an external signal): each
 * bounce round re-examines the SAME draft through a genuinely DIFFERENT lens — a distinct persona with its own
 * failure-mode focus — never a generic doubt prompt. The gate decides WHETHER/how many rounds; this module supplies
 * WHAT each round asks. Pure + deterministic (round → persona is a fixed rotation), sibling of §5.AA's
 * `buildPromptVariant` (which re-frames an INSTRUCTION; this re-frames a CRITIQUE of a draft).
 */

export type SelfBouncePersona = "skeptical_reviewer" | "test_verifier" | "requirements_auditor";

/** The fixed rotation the rounds walk (deterministic; round 0 ⇒ first entry). */
export const SELF_BOUNCE_PERSONA_ROTATION: readonly SelfBouncePersona[] = [
	"skeptical_reviewer",
	"test_verifier",
	"requirements_auditor",
];

const PERSONA_SYSTEM: Record<SelfBouncePersona, string> = {
	skeptical_reviewer:
		"You are a skeptical senior code reviewer. Your job is to find what is WRONG with the draft: logic errors, " +
		"unhandled edge cases, and claims that do not follow from the evidence. Do not praise. If nothing is wrong, " +
		"say so in one line.",
	test_verifier:
		"You are a test-focused verifier. Walk the draft against concrete inputs: pick 2-3 specific cases (including " +
		"one edge case) and trace what the draft would actually produce for each. Report any case where the traced " +
		"result contradicts the draft's claims.",
	requirements_auditor:
		"You are a requirements auditor. Compare the draft against the ORIGINAL TASK line by line: list every " +
		"requirement the draft satisfies, misses, or silently changed. A missed or reinterpreted requirement is a " +
		"finding even if the draft is internally correct.",
};

export interface SelfBouncePromptInput {
	/** The original task text (the requirements the auditor persona checks against). */
	task: string;
	/** The model's current draft answer/solution being bounced. */
	draft: string;
	/** 0-based bounce round — selects the persona via the fixed rotation. */
	round: number;
}

export interface SelfBouncePrompt {
	persona: SelfBouncePersona;
	system: string;
	/** The user-role critique request carrying the task + draft. */
	user: string;
}

/** Build round N's critique prompt: a distinct persona re-examining the same draft (never "are you sure?"). */
export function buildSelfBouncePrompt(input: SelfBouncePromptInput): SelfBouncePrompt {
	const rotation = SELF_BOUNCE_PERSONA_ROTATION;
	const persona = rotation[Math.abs(Math.trunc(input.round)) % rotation.length] ?? "skeptical_reviewer";
	return {
		persona,
		system: PERSONA_SYSTEM[persona],
		user: [
			`ORIGINAL TASK:\n${input.task.trim()}`,
			`DRAFT UNDER REVIEW:\n${input.draft.trim()}`,
			"List your findings as short numbered points. End with exactly one line: VERDICT: ok | VERDICT: revise.",
		].join("\n\n"),
	};
}

/** Parse a bounce round's verdict line; a missing/malformed verdict reads as `revise` (fail toward another look). */
export function parseSelfBounceVerdict(reply: string): "ok" | "revise" {
	const match = reply.match(/VERDICT:\s*(ok|revise)\b/i);
	return match?.[1]?.toLowerCase() === "ok" ? "ok" : "revise";
}
