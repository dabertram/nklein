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

/** What a completed narrative pass actually yielded — the POST-call half of the ladder. */
export type NarrativeCompletionOutcome =
	/** Usable prose came back; grounding (P16.2) filters it next. */
	| "narrative"
	/** Nothing usable. Layer A stands alone, exactly as for an unreachable model. */
	| "empty_degrade_to_layer_a";

export interface NarrativeCompletionVerdict {
	readonly outcome: NarrativeCompletionOutcome;
	readonly narrative: string;
	readonly reason: string;
}

/**
 * P16.6b — decide what a narrative completion actually produced, BEFORE anything treats it as prose.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ──
 * A reasoning model answers a free-text call with an EMPTY `message.content` and its thinking in
 * `reasoning_content`. `nklein-local-llm-client.ts` has a `reasoning_content` fallback, but it is gated on
 * `request.format` — structured calls only — so a free-text narrative pass receives exactly `""`. A caller that
 * takes that at face value emits a report whose narrative section is blank while every status says the pass ran.
 *
 * **A blank narrative that reads as success is worse than no narrative**, because Layer A is pure aggregation and
 * is *"complete and correct without a model — nothing is degraded except the prose"*. Reporting the degradation
 * loses nothing real; hiding it makes an empty section look like the model's considered opinion.
 *
 * ── WHY REASONING TEXT IS NOT PROMOTED TO PROSE ──
 * The tempting fix is to fall back to `reasoningContent` here. It is refused: on a free-text call that field holds
 * the model's THINKING, not its answer, and publishing it would put a chain of thought into a user-facing report —
 * a different and worse failure than an empty section. It is accepted only as EVIDENCE that the model responded at
 * all, which sharpens the reason string and nothing else.
 */
export function interpretNarrativeCompletion(input: {
	readonly content: string | null | undefined;
	readonly reasoningContent?: string | null;
}): NarrativeCompletionVerdict {
	const narrative = (input.content ?? "").trim();
	if (narrative.length > 0) {
		return {
			outcome: "narrative",
			narrative,
			reason: "the model returned narrative prose; grounding filters it next",
		};
	}
	const thoughtOnly = (input.reasoningContent ?? "").trim().length > 0;
	return {
		outcome: "empty_degrade_to_layer_a",
		narrative: "",
		reason: thoughtOnly
			? "the model replied in its REASONING channel only and produced no prose — its thinking is not an answer and is never published, so the report is Layer A alone (complete and correct without a narrative)"
			: "the model returned no narrative content, so the report is Layer A alone (complete and correct without a narrative)",
	};
}
