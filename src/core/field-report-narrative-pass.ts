import {
	type GenerationPlanInput,
	interpretNarrativeCompletion,
	planFieldReportGeneration,
} from "./field-report-generation";
import { type DraftClaim, type EvidenceRecord, type GroundingResult, groundClaims } from "./field-report-grounding";

/**
 * P16.6b — the NARRATIVE PASS orchestrator: plan → call → interpret → GROUND. PURE, with the model call injected.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS PURE ──
 * The field report's structured half was wired and working; its model-facing half was not. `field-report-generation`
 * (the degradation ladder) and `field-report-grounding` (the filter that makes a narrative safe to publish) both
 * had **zero consumers** — two orphan cores holding the entire safety argument between them.
 *
 * The model call is a PORT rather than a dependency, so the whole sequence is testable with no model loaded, and
 * the effectful half later becomes "supply a real caller" rather than "write the logic under a live endpoint".
 *
 * ── THE ORDERING CONSTRAINT THIS ENFORCES ──
 * **Grounding is not optional and cannot be added afterwards.** P16.6 is explicit: *"a weak model must degrade to
 * the STRUCTURED report, never to a hallucinated narrative."* If a model call were wired before the filter it
 * depends on, !Klein would publish unfiltered model prose in a user-facing report — and that is the exciting half,
 * so it is the one that gets built first by accident. Here the call cannot produce output that skips grounding:
 * every path out of this function either returns grounded claims or returns none.
 *
 * ── THE THREE WAYS A NARRATIVE LEGITIMATELY YIELDS NOTHING ──
 * Not attempted (the ladder declined), attempted-but-empty (a reasoning model answered with thinking only), and
 * attempted-but-ungrounded (every claim cited evidence that does not exist). All three are the SAME outcome for
 * the report — Layer A alone — and are deliberately reported as DISTINCT reasons, because they call for different
 * responses: the first is a policy decision, the second is a model/format mismatch, and the third is the model
 * inventing citations, which is the one that should change whether it is asked again.
 */

export type NarrativePassOutcome =
	/** Grounded prose survived; the report carries Layer A plus a narrative. */
	| "narrative_grounded"
	/** The ladder declined to ask. Layer A alone — nothing is degraded except the prose. */
	| "not_attempted"
	/** Asked, but the model produced no usable prose. Layer A alone. */
	| "empty_completion"
	/** Asked and answered, but nothing survived grounding. Layer A alone, and this one is EVIDENCE about the model. */
	| "all_claims_ungrounded";

export interface NarrativePassResult {
	readonly outcome: NarrativePassOutcome;
	/** Claims that survived grounding, with resolved evidence. Empty on every non-`narrative_grounded` outcome. */
	readonly grounded: GroundingResult["grounded"];
	/** Full grounding detail when a call was made and produced claims; null when there was nothing to ground. */
	readonly grounding: GroundingResult | null;
	/**
	 * Share of claims discarded by grounding, or null when no claims were produced.
	 *
	 * NULL, NOT ZERO, when nothing was generated: a model that was never asked has not demonstrated a 0% drop
	 * rate, and feeding a fabricated 0 back into the ladder would promote an unproven model on the strength of a
	 * call it never made. The ladder's own rule — "a thin history counts as no evidence rather than a poor rate" —
	 * only holds if absence is reported as absence.
	 */
	readonly observedDropRate: number | null;
	readonly reason: string;
}

/** The model call, injected. Returns whatever the provider gave back, unmassaged. */
export type NarrativeModelPort = () => Promise<{
	readonly content: string | null;
	readonly reasoningContent?: string | null;
}>;

/** Parse a model's reply into claims. Injected so this module never guesses at a response format. */
export type NarrativeClaimParser = (completion: string) => readonly DraftClaim[];

export async function runFieldReportNarrativePass(input: {
	readonly plan: GenerationPlanInput;
	readonly evidence: readonly EvidenceRecord[];
	readonly callModel: NarrativeModelPort;
	readonly parseClaims: NarrativeClaimParser;
}): Promise<NarrativePassResult> {
	const plan = planFieldReportGeneration(input.plan);
	if (!plan.narrativeEnabled) {
		return {
			outcome: "not_attempted",
			grounded: [],
			grounding: null,
			observedDropRate: null,
			reason: plan.reason,
		};
	}

	const completion = await input.callModel();
	const verdict = interpretNarrativeCompletion({
		content: completion.content,
		reasoningContent: completion.reasoningContent ?? null,
	});
	if (verdict.outcome === "empty_degrade_to_layer_a") {
		return {
			outcome: "empty_completion",
			grounded: [],
			grounding: null,
			observedDropRate: null,
			reason: verdict.reason,
		};
	}

	const claims = input.parseClaims(verdict.narrative);
	if (claims.length === 0) {
		// Prose came back but yielded no citable claims. Reported as an empty completion rather than as a 100%
		// drop rate: nothing was ever offered to grounding, so grounding did not reject anything.
		return {
			outcome: "empty_completion",
			grounded: [],
			grounding: null,
			observedDropRate: null,
			reason:
				"the model returned prose but no citable claims could be parsed from it, so the report is Layer A alone",
		};
	}

	const grounding = groundClaims(claims, input.evidence);
	if (grounding.grounded.length === 0) {
		return {
			outcome: "all_claims_ungrounded",
			grounded: [],
			grounding,
			// A REAL measurement (1.0), unlike the nulls above: the model was asked, answered, and every claim it
			// made cited evidence that does not exist. That is exactly the signal the ladder should act on.
			observedDropRate: grounding.dropRate,
			reason: `every claim was discarded by grounding (${grounding.summary}), so the report is Layer A alone — this model invented its citations`,
		};
	}

	return {
		outcome: "narrative_grounded",
		grounded: grounding.grounded,
		grounding,
		observedDropRate: grounding.dropRate,
		reason: `${grounding.summary}; the surviving claims carry resolved evidence`,
	};
}
