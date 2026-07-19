/**
 * F12.78 — "reason-free, constrain-late": decide HOW to get structured output from a model. PURE core.
 *
 * The Constraint Tax finding: hard schema-constrained decoding lifts JSON validity from 61.5% to 100% — and
 * HALVES accuracy, 19.7% → 11%. The number that matters most is neither of those: **88.9% of constrained outputs
 * become wrong-but-VALID.**
 *
 * That is a failure-mode conversion, not a quality trade. An invalid output is a LOUD failure: the parser rejects
 * it, the controller retries, and the run self-corrects. A wrong-but-valid output is a SILENT one: it parses, it
 * type-checks, it flows downstream, and it is acted upon. Constrained decoding on a model that cannot carry the
 * schema does not reduce failures — it hides them, which is strictly worse for a harness whose whole premise is
 * that small local models fail often and must fail visibly.
 *
 * So for models that cannot hold semantics and schema simultaneously, the strategy is to let them REASON in free
 * text, then package the answer into JSON in a cheap second pass. The packaging step is nearly mechanical, which
 * is exactly the kind of work a small model can do reliably.
 *
 * Honesty stance: the threshold below is the PAPER'S, not ours. Phase 22 recorded that parameter count is a poor
 * capability proxy at agent depth, so a caller with measured evidence for this pairing should override it — and
 * when there is no measurement, the fallback is the strategy whose failures are VISIBLE.
 */

import { parseModelAttributes } from "./model-attributes";

/** The paper's threshold: below this, hard-constraining the reasoning turn costs more accuracy than it buys. */
export const CONSTRAINT_TAX_SIZE_B = 14;

export type ConstraintStrategy = "free_text_then_package" | "direct_constrained";

export interface ConstraintStrategyDecision {
	readonly strategy: ConstraintStrategy;
	/** True when the decision rests on parameter count rather than a measurement — see the docblock. */
	readonly weakBasis: boolean;
	readonly reason: string;
}

export interface ConstraintStrategyInput {
	readonly modelId: string;
	/**
	 * Measured rate at which this model produces SEMANTICALLY correct output under hard constraint, 0..1.
	 * `null` when unmeasured — which must not be read as competence.
	 */
	readonly measuredConstrainedAccuracy?: number | null;
	/** Observations behind the measurement; a thin sample is treated as unmeasured. */
	readonly observationCount?: number;
	/**
	 * True when the turn is PURE PACKAGING (no reasoning left to do — the answer already exists and only needs
	 * shaping). Constraining that turn is safe and desirable: there is no semantics left to lose.
	 */
	readonly packagingOnly?: boolean;
}

const MIN_OBSERVATIONS = 5;
/** Measured constrained-accuracy at or above which direct constraint is safe for this pairing. */
export const DIRECT_CONSTRAINT_BAR = 0.75;

/**
 * Choose the output strategy. Never throws.
 */
export function decideConstraintStrategy(input: ConstraintStrategyInput): ConstraintStrategyDecision {
	// A packaging-only turn has no reasoning to protect — constrain it, that is the entire point of the two-phase
	// shape. This check comes first so the second pass is never itself sent down the free-text path.
	if (input.packagingOnly === true) {
		return {
			strategy: "direct_constrained",
			weakBasis: false,
			reason:
				"packaging-only turn — the answer already exists, so there is no reasoning for the constraint to damage",
		};
	}

	const observations = input.observationCount ?? 0;
	const measured = input.measuredConstrainedAccuracy ?? null;
	if (measured !== null && Number.isFinite(measured) && observations >= MIN_OBSERVATIONS) {
		return measured >= DIRECT_CONSTRAINT_BAR
			? {
					strategy: "direct_constrained",
					weakBasis: false,
					reason: `measured constrained accuracy ${measured.toFixed(2)} over ${observations} observation(s) clears the ${DIRECT_CONSTRAINT_BAR} bar — this pairing carries schema and semantics together`,
				}
			: {
					strategy: "free_text_then_package",
					weakBasis: false,
					reason: `measured constrained accuracy ${measured.toFixed(2)} is below the ${DIRECT_CONSTRAINT_BAR} bar — hard constraint would convert loud failures into wrong-but-valid silent ones`,
				};
	}

	const paramB = parseModelAttributes(input.modelId).paramB ?? null;
	if (paramB === null) {
		return {
			strategy: "free_text_then_package",
			weakBasis: true,
			reason: `size unreadable from "${input.modelId}" and no measurement — defaulting to the two-phase path, because its failures are VISIBLE (a bad free-text answer is caught at packaging) while hard-constraint failures are silent`,
		};
	}
	return paramB < CONSTRAINT_TAX_SIZE_B
		? {
				strategy: "free_text_then_package",
				weakBasis: true,
				reason: `~${paramB}B is below the ${CONSTRAINT_TAX_SIZE_B}B constraint-tax threshold — hard schema decode roughly halves accuracy at this size and makes ~89% of outputs wrong-but-valid`,
			}
		: {
				strategy: "direct_constrained",
				weakBasis: true,
				reason: `~${paramB}B is at or above the ${CONSTRAINT_TAX_SIZE_B}B threshold (WEAK BASIS: the paper's size cutoff, not a measurement of this pairing — override with measured constrained accuracy when available)`,
			};
}

/**
 * Build the packaging prompt for the second pass. Deliberately narrow: it must TRANSCRIBE, not re-decide. A
 * packaging pass that "improves" the answer reintroduces the semantic risk the two-phase split exists to avoid.
 */
export function buildPackagingPrompt(input: {
	readonly freeTextAnswer: string;
	readonly schemaDescription: string;
}): string {
	return [
		"Convert the answer below into the required JSON. This is a TRANSCRIPTION task.",
		"",
		"## The answer",
		"```",
		input.freeTextAnswer.trim(),
		"```",
		"",
		"## Required shape",
		input.schemaDescription.trim(),
		"",
		"## Rules",
		"- Carry the answer across EXACTLY. Do not correct it, extend it, or improve it.",
		"- If the answer is incomplete, encode what is there and leave the rest absent — do not invent values.",
		"- If the answer cannot be expressed in this shape at all, return `{}` rather than a plausible-looking guess.",
		"",
		"Return only the JSON.",
	].join("\n");
}
