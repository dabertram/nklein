/**
 * F12.111 — multi-model SPEC-TIME deliberation: disagreement as an underspecification detector. PURE core.
 *
 * Every multi-model mechanism !Klein has today runs at REVIEW time, on a finished patch. The spec/decompose
 * stage is single-model. This core fills that gap — and it is deliberately NOT built to reach consensus.
 *
 * ── WHY NOT CONSENSUS ──
 * Merging N opinions into one "better" spec is the version the evidence argues against: Cognition found that
 * "the unstructured-swarm approach, arbitrary networks of agents negotiating with each other, is mostly a
 * distraction". But the same source found multi-agent works "when the additional agents contribute INTELLIGENCE
 * rather than actions" — which is exactly what a spec discussion is.
 *
 * So the deliverable is the DISAGREEMENT SET, not a merged spec:
 *  - Where models AGREE, that is weak evidence. Correlated training produces correlated errors, so agreement
 *    mostly tells us the question was easy or the blind spot is shared. It is reported, never celebrated.
 *  - Where models DISAGREE, the SPEC is ambiguous. That is the signal, and the honest output is a clarifying
 *    question for the human — routed into the clarification machinery that already exists.
 *
 * Disagreement becomes a MEASUREMENT of underspecification rather than a vote to be settled.
 *
 * Placement matters: the multi-turn literature finds models "make early assumptions, commit prematurely to a
 * solution, and do not recover" — a 39% average drop that is essentially MODEL-INDEPENDENT. Deliberating BEFORE
 * commitment attacks that cause; a review panel after the patch attacks the symptom.
 */

/** How the deliberation was staffed — the caller must not present these as equivalent. */
export type DeliberationMode =
	/** ≥2 genuinely distinct model families. The only mode that yields independent opinions. */
	| "cross_family"
	/** ONE model under distinct stances. Cheaper, weaker, and must be labelled as one model wearing hats. */
	| "single_model_stances"
	/** Not enough capacity — fall through to the existing single-model clarification path. */
	| "skipped";

export interface DeliberationStaffingInput {
	/** Distinct model FAMILIES available (not model ids — two quants of one model are not two opinions). */
	readonly distinctFamilies: number;
	/** True when at least one model is loaded at all. */
	readonly anyModelLoaded: boolean;
	/** Spec ambiguity 0..1 from spec-lint / clarification-need. Deliberation is gated on this, not on ceremony. */
	readonly ambiguity: number;
	/** Card difficulty 0..1 — a hard card earns deliberation even at moderate ambiguity. */
	readonly difficulty: number;
}

export interface DeliberationStaffing {
	readonly mode: DeliberationMode;
	readonly reason: string;
}

/** Below this ambiguity a well-specified card gets the cheap single path (F12.35's DOWN result). */
const AMBIGUITY_BAR = 0.4;
/** A hard card earns deliberation at lower ambiguity, because its cost of being wrong is higher. */
const HARD_CARD = 0.7;

/**
 * Decide whether and how to staff a deliberation. Gated on AMBIGUITY, not on ceremony: F12.35's DOWN result is
 * that needless debate INJECTS errors on easy items, so a well-specified card must not be deliberated over.
 */
export function decideDeliberationStaffing(input: DeliberationStaffingInput): DeliberationStaffing {
	const ambiguity = Number.isFinite(input.ambiguity) ? Math.max(0, Math.min(1, input.ambiguity)) : 0;
	const difficulty = Number.isFinite(input.difficulty) ? Math.max(0, Math.min(1, input.difficulty)) : 0;

	const worthIt = ambiguity >= AMBIGUITY_BAR || (difficulty >= HARD_CARD && ambiguity > 0);
	if (!worthIt) {
		return {
			mode: "skipped",
			reason: `ambiguity ${ambiguity.toFixed(2)} is below the ${AMBIGUITY_BAR} bar on a difficulty-${difficulty.toFixed(2)} card — a well-specified card gets the single path, because needless debate injects errors`,
		};
	}
	if (!input.anyModelLoaded) {
		return { mode: "skipped", reason: "no model is loaded — nothing to deliberate with" };
	}
	if (input.distinctFamilies >= 2) {
		return {
			mode: "cross_family",
			reason: `${input.distinctFamilies} distinct model families available — independent opinions are possible`,
		};
	}
	return {
		mode: "single_model_stances",
		reason:
			"only one model family is loaded — falling back to ONE model under distinct stances. This is weaker than family diversity and its agreement means less, because the same weights produce the same blind spots.",
	};
}

/** A stance is a role the deliberating model is asked to argue from. */
export const DELIBERATION_STANCES = [
	{
		id: "pessimist",
		instruction:
			"Argue from what could go WRONG. What does this spec fail to say that will bite during implementation?",
	},
	{
		id: "user_advocate",
		instruction:
			"Argue from the USER's side. What would someone reading this spec expect that it does not actually promise?",
	},
	{
		id: "implementer",
		instruction:
			"Argue from the KEYBOARD. What would you have to decide yourself because this spec does not decide it for you?",
	},
] as const;

export type DeliberationStanceId = (typeof DELIBERATION_STANCES)[number]["id"];

/**
 * Build one deliberator's prompt. Asks for AMBIGUITIES, not for a better spec — a deliberator that rewrites the
 * spec produces a competing artifact to merge, which is the consensus trap this core exists to avoid.
 */
export function buildDeliberationPrompt(input: {
	readonly specText: string;
	readonly stance: (typeof DELIBERATION_STANCES)[number];
}): string {
	return [
		"You are reviewing a specification BEFORE any code is written.",
		"You will not write code, and you will not rewrite the specification.",
		"",
		`## Your stance`,
		input.stance.instruction,
		"",
		"## The specification",
		"```",
		input.specText.trim(),
		"```",
		"",
		"## What to return",
		"List the points where this specification is genuinely AMBIGUOUS — where two competent engineers could",
		"read it and build different things. One per line, in exactly this shape:",
		"`AMBIGUITY: <what is underspecified> | READINGS: <reading A> // <reading B>`",
		"",
		"Rules:",
		"- Both readings must be PLAUSIBLE. If only one reading is sensible, the spec is not ambiguous — skip it.",
		"- Do not list preferences, style opinions, or things you would do differently. Those are not ambiguities.",
		"- Do not propose a rewrite. Naming the ambiguity is the entire job.",
		"- If the specification is clear enough to build from, reply exactly `NO_AMBIGUITY`.",
	].join("\n");
}

export interface SpecAmbiguity {
	readonly ambiguity: string;
	readonly readings: readonly string[];
	/** Which stances/models raised it — a point raised by several is better attested, not more true. */
	readonly raisedBy: readonly string[];
}

/**
 * Match an `AMBIGUITY: … | READINGS: …` pair ANYWHERE in a line, not anchored at its start.
 *
 * LIVE-FOUND 2026-07-20: a real model emits these wrapped in markdown prose and backticks —
 * `` - *Ambiguity 3:* Block duration. `AMBIGUITY: … | READINGS: … // …` `` — so a start-anchored pattern
 * silently parsed ZERO ambiguities from a reply that contained five good ones. The unit tests passed the whole
 * time because they fed clean lines. **A parser strict enough to reject real output turns a working model into a
 * silent no-op**, which is the same failure shape as the drift critic's empty-`content` trap: no error, just
 * nothing.
 */
const AMBIGUITY_LINE = /AMBIGUITY\s*:\s*(.+?)\s*\|\s*READINGS\s*:\s*(.+?)\s*(?:`|$)/i;
const MAX_AMBIGUITIES = 6;

/** True when the text is still the prompt's placeholder rather than a real finding (e.g. `<reading A>`). */
function isTemplateEcho(text: string): boolean {
	return /<[^>]+>/.test(text);
}

/** Strip backticks and emphasis a model wraps around the structured payload. */
function stripMarkup(text: string): string {
	return text.replace(/[`*_]/g, "").trim();
}

/** Parse one deliberator's reply. An uninterpretable reply yields nothing rather than a manufactured concern. */
export function parseDeliberationReply(text: string, raisedBy: string): SpecAmbiguity[] {
	const out: SpecAmbiguity[] = [];
	for (const line of (text ?? "").split("\n")) {
		const match = line.match(AMBIGUITY_LINE);
		if (!match?.[1] || !match[2]) {
			continue;
		}
		const readings = match[2]
			.split("//")
			.map((reading) => reading.trim())
			.filter((reading) => reading.length > 0);
		// A single reading is not an ambiguity — it is an opinion wearing an ambiguity's format.
		if (readings.length < 2) {
			continue;
		}
		// LIVE-FOUND 2026-07-20: models echo the prompt's own FORMAT EXAMPLE back
		// (`AMBIGUITY: <what is underspecified> | READINGS: <reading A> // <reading B>`), and a tolerant parser
		// happily accepts it — producing a clarifying question that asks the human to choose between
		// "<reading A>" and "<reading B>". Drop any capture still carrying angle-bracket placeholders: a
		// template echo is the model repeating instructions, not a finding about the spec.
		if (isTemplateEcho(match[1]) || readings.some(isTemplateEcho)) {
			continue;
		}
		out.push({ ambiguity: stripMarkup(match[1]), readings: readings.map(stripMarkup), raisedBy: [raisedBy] });
	}
	return out.slice(0, MAX_AMBIGUITIES);
}

export interface DeliberationResult {
	/** Ambiguities that at least one deliberator raised — the actual output of the exercise. */
	readonly disagreements: readonly SpecAmbiguity[];
	/** Number of deliberators that returned no ambiguity at all. */
	readonly foundNothing: number;
	/** Rendered clarifying questions for the human, in the order they should be asked. */
	readonly clarifyingQuestions: readonly string[];
	/** The honest framing of what agreement here does and does not mean. */
	readonly agreementCaveat: string;
}

/** Merge deliberators' findings. Similar ambiguities are grouped so one point raised twice is not asked twice. */
export function combineDeliberation(input: {
	readonly perDeliberator: readonly { readonly raisedBy: string; readonly ambiguities: readonly SpecAmbiguity[] }[];
	readonly mode: DeliberationMode;
}): DeliberationResult {
	const grouped = new Map<string, SpecAmbiguity>();
	let foundNothing = 0;

	for (const entry of input.perDeliberator) {
		if (entry.ambiguities.length === 0) {
			foundNothing += 1;
			continue;
		}
		for (const item of entry.ambiguities) {
			const key = item.ambiguity
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, " ")
				.trim();
			const existing = grouped.get(key);
			if (existing) {
				grouped.set(key, { ...existing, raisedBy: [...new Set([...existing.raisedBy, ...item.raisedBy])] });
			} else {
				grouped.set(key, item);
			}
		}
	}

	const disagreements = [...grouped.values()].sort((a, b) => b.raisedBy.length - a.raisedBy.length);
	const clarifyingQuestions = disagreements.map(
		(item) => `${item.ambiguity} — did you mean "${item.readings[0]}" or "${item.readings[1] ?? "something else"}"?`,
	);

	const agreementCaveat =
		input.mode === "single_model_stances"
			? "These stances were argued by ONE model wearing different hats, not by independent models. Where they agree, that agreement carries little weight — the same weights produce the same blind spots."
			: disagreements.length === 0
				? "No deliberator found an ambiguity. That is weak evidence of clarity, not proof: models share training data, so they share blind spots, and a question none of them thought to ask is exactly the one that will bite."
				: "Agreement between deliberators is reported but NOT treated as validation — correlated training produces correlated errors. The DISAGREEMENTS above are the signal.";

	return { disagreements, foundNothing, clarifyingQuestions, agreementCaveat };
}
