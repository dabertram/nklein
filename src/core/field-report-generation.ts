/**
 * P16.6 — Field Report generation path + GRACEFUL DEGRADATION. PURE core.
 *
 * The report is written by whatever models the user has connected. That is a requirement, not a convenience:
 * generating feedback must not create the cloud dependency this project exists to reduce.
 *
 * ── THE LOAD-BEARING PROPERTY: LAYER A NEEDS NO MODEL AT ALL ──
 * Layer A is pure aggregation over telemetry the harness already recorded — counts, outcomes, model class, which
 * mechanisms fired. **No model is required to produce it, and none should be invited to.** A model asked to
 * summarise numbers will paraphrase them, and a paraphrased count is a claim that can be wrong about something
 * that was never in doubt.
 *
 * So the degradation ladder is:
 *  - no model available → **Layer A only**, complete and correct;
 *  - a weak model → Layer A **plus** whatever narrative survives grounding (P16.2), which on a weak model may be
 *    nothing;
 *  - a capable model → the same, with more surviving narrative.
 *
 * **A weak model must degrade to the STRUCTURED report, never to a hallucinated narrative.** That is the whole
 * point of this item: the failure mode of a small local model here is confident invention, and the safe fallback
 * is the layer that cannot be invented because it is arithmetic.
 */

export type GenerationCapability =
	/** No model reachable. Layer A is still fully producible. */
	| "none"
	/** A model is reachable but has not demonstrated it can produce grounded claims. */
	| "unverified"
	/** A model whose recent claims survived grounding at an acceptable rate. */
	| "grounded_capable";

export interface GenerationPlan {
	readonly capability: GenerationCapability;
	/** Layers this plan will attempt. Layer A is ALWAYS present. */
	readonly attemptLayers: readonly ("A" | "B")[];
	/** True when a narrative pass will run at all. */
	readonly narrativeEnabled: boolean;
	readonly reason: string;
}

export interface GenerationPlanInput {
	readonly modelAvailable: boolean;
	/**
	 * Fraction of this model's recent report claims that survived grounding, 0..1. `null` when it has never
	 * generated a report — which must NOT be read as capable.
	 */
	readonly recentGroundedRate?: number | null;
	/** Reports behind that rate; a rate from one report is not evidence. */
	readonly reportsObserved?: number;
}

/** Grounded-survival rate below which a narrative pass costs more than it returns. */
export const NARRATIVE_GROUNDING_BAR = 0.6;
/** Reports needed before a grounded rate counts as evidence about the model. */
const MIN_REPORTS = 3;

/**
 * Decide what to attempt. Conservative by construction: an unproven model still gets a narrative ATTEMPT (its
 * claims are filtered by grounding anyway, so a bad attempt costs tokens, not correctness) — but a model with a
 * MEASURED poor grounding rate does not, because we already know most of its output will be discarded.
 */
export function planFieldReportGeneration(input: GenerationPlanInput): GenerationPlan {
	if (!input.modelAvailable) {
		return {
			capability: "none",
			attemptLayers: ["A"],
			narrativeEnabled: false,
			reason:
				"no model reachable — Layer A is produced by AGGREGATION, so the report is complete and correct without one. Nothing is degraded except the prose.",
		};
	}
	const rate = input.recentGroundedRate ?? null;
	const observed = input.reportsObserved ?? 0;
	if (rate !== null && Number.isFinite(rate) && observed >= MIN_REPORTS && rate < NARRATIVE_GROUNDING_BAR) {
		return {
			capability: "unverified",
			attemptLayers: ["A"],
			narrativeEnabled: false,
			reason: `this model's claims survived grounding at ${(rate * 100).toFixed(0)}% over ${observed} report(s), below the ${NARRATIVE_GROUNDING_BAR * 100}% bar — most of its narrative would be DISCARDED, so it is not attempted. Layer A is unaffected.`,
		};
	}
	return {
		capability: rate !== null && observed >= MIN_REPORTS ? "grounded_capable" : "unverified",
		attemptLayers: ["A", "B"],
		narrativeEnabled: true,
		reason:
			rate !== null && observed >= MIN_REPORTS
				? `claims survived grounding at ${(rate * 100).toFixed(0)}% over ${observed} report(s) — narrative attempted.`
				: "no grounding history for this model yet — narrative is attempted, since grounding filters the result anyway and a failed attempt costs tokens rather than correctness.",
	};
}

/**
 * Assert the invariant this item exists to protect: **a report is never empty just because no model was
 * available.** Returns the reason it would be, when it is — so a caller surfaces a real defect instead of
 * shipping a blank report.
 */
export function checkLayerAAlwaysProducible(input: {
	readonly structuralFieldCount: number;
	readonly plan: GenerationPlan;
}): { readonly ok: boolean; readonly reason: string } {
	if (!input.plan.attemptLayers.includes("A")) {
		return {
			ok: false,
			reason: "BUG: a generation plan omitted Layer A — Layer A is arithmetic and is never optional.",
		};
	}
	if (input.structuralFieldCount === 0) {
		return {
			ok: false,
			reason:
				"Layer A produced NO fields. That is a telemetry defect, not a model problem — aggregation cannot fail for lack of a model, so an empty Layer A means the observations were not read.",
		};
	}
	return { ok: true, reason: `Layer A produced ${input.structuralFieldCount} field(s) without needing a model.` };
}
