/**
 * Bridge llmfit's FIT/SPEED estimates into §5.AB routing priors and reconcile llmfit's coarse tool-use tag against the
 * §5.AL EMPIRICAL capability verdict (todo §5.AB/§5.AL — the llmfit-integration leaves "feed tok/s + score into the
 * fitness store + pool routing" and "cross-reference llmfit's HF DB rows ↔ MODEL_CAPABILITY_CATALOG").
 *
 * The division of labour (see llmfit-adapter.ts): llmfit owns FIT (does it load) + SPEED (tok/s) + a 0–100 quality×speed×
 * fit score, plus a *claimed* `tool_use` capability tag scraped from HF metadata. The §5.AL catalog owns the one thing
 * llmfit CANNOT know — the EMPIRICAL, agentic tool-use verdict we measured ourselves. This module is the pure seam that
 * turns llmfit's numbers into the priors the §5.AB comparators consume, and — critically — surfaces when llmfit's
 * optimistic HF tag DISAGREES with what we actually observed, so routing trusts the empirical verdict, not the scrape.
 *
 * Pure (no I/O): the catalog lookup is injected (default {@link lookupModelCapability}) so the reconciliation is testable
 * without touching the global catalog. `llmfitPredictedWallTimeMs` (the tok/s → wall-time half) already lives in
 * llmfit-adapter.ts; this adds the score → capability-prior + speed-tier half and the tool-use cross-reference.
 */

import type { LlmfitModel } from "./llmfit-adapter.js";
import type { ToolUseVerdict } from "./model-capability-catalog.js";
import { lookupModelCapability } from "./model-capability-catalog.js";

/** Coarse speed bucket derived from llmfit's `estimated_tps`, for quick operator/routing triage. */
export type LlmfitSpeedTier = "fast" | "medium" | "slow";

/** tok/s thresholds for the speed tiers. Local-model scale: ≥40 tok/s reads as snappy, <15 as sluggish. */
const SPEED_TIER_FAST_TPS = 40;
const SPEED_TIER_MEDIUM_TPS = 15;

/**
 * The §5.AB routing prior distilled from an llmfit model row: a cold-start capability prior (llmfit's 0–100 score, before
 * we have measured outcomes) and a coarse speed tier. Every field is null when llmfit gave no usable number, so a caller
 * falls back to its measured source rather than inventing data.
 */
export interface LlmfitRoutingPrior {
	/** llmfit's 0–100 score, clamped — the cold-start capability BASELINE (a prior, superseded by measured fitness). */
	capabilityPrior: number | null;
	/** Coarse speed bucket from `estimated_tps`. */
	speedTier: LlmfitSpeedTier | null;
	/** The raw tok/s carried through for the pool-routing `predictedWallTimeMs` computation. */
	estimatedTps: number | null;
}

/** Clamp a possibly-out-of-range score into 0–100; null passes through. */
function clampScore(score: number | null): number | null {
	if (score === null || !Number.isFinite(score)) {
		return null;
	}
	return Math.max(0, Math.min(100, score));
}

function speedTierFor(estimatedTps: number | null): LlmfitSpeedTier | null {
	if (estimatedTps === null || !(estimatedTps > 0)) {
		return null;
	}
	if (estimatedTps >= SPEED_TIER_FAST_TPS) {
		return "fast";
	}
	if (estimatedTps >= SPEED_TIER_MEDIUM_TPS) {
		return "medium";
	}
	return "slow";
}

/**
 * Distil an llmfit model row into the §5.AB routing prior (score → capability prior, tok/s → speed tier). Pure. Used at
 * cold start, before measured outcomes exist for the model in the fitness store; the measured signal, once present,
 * supersedes this prior.
 */
export function llmfitRoutingPrior(model: LlmfitModel): LlmfitRoutingPrior {
	return {
		capabilityPrior: clampScore(model.score),
		speedTier: speedTierFor(model.estimatedTps),
		estimatedTps: model.estimatedTps,
	};
}

/**
 * How llmfit's *claimed* tool-use tag lines up with the §5.AL EMPIRICAL verdict:
 * - `agree`        — both say capable, or both say not-capable.
 * - `conflict`     — llmfit claims tool_use but we EMPIRICALLY found the model weak/unsuitable (trust the catalog).
 * - `catalog-only` — we know it's capable but llmfit didn't tag it (llmfit's scrape is incomplete).
 * - `llmfit-only`  — llmfit claims tool_use and we have NO empirical verdict yet (an unverified prior).
 * - `no-data`      — neither source has a tool-use signal.
 */
export type LlmfitToolUseAgreement = "agree" | "conflict" | "catalog-only" | "llmfit-only" | "no-data";

/** The combined FIT/SPEED (llmfit) + EMPIRICAL tool-use (§5.AL) assessment for one model. */
export interface LlmfitCatalogCrossReference {
	/** The model name as llmfit reported it. */
	name: string;
	/** llmfit's fit verdict (Perfect|Good|Marginal|Too Tight) or null. */
	fitLevel: LlmfitModel["fitLevel"];
	/** The §5.AB routing prior (score + speed) for this model. */
	routingPrior: LlmfitRoutingPrior;
	/** Did llmfit's HF metadata claim tool use? */
	llmfitClaimsToolUse: boolean;
	/** The §5.AL empirical verdict, or `"UNKNOWN"` when the catalog has no entry for this model. */
	empiricalToolUse: ToolUseVerdict | "UNKNOWN";
	/** How the two tool-use signals reconcile. */
	toolUseAgreement: LlmfitToolUseAgreement;
	/**
	 * The signal a router should ACT on: the empirical verdict when we have one (authoritative), else llmfit's claim as an
	 * unverified prior, else unknown. Never lets llmfit's optimistic tag override a measured UNSUITABLE/WEAK.
	 */
	authoritativeToolUse: ToolUseVerdict | "UNKNOWN";
}

/** A verdict that means the model can actually drive tools (vs merely claim to). */
function verdictImpliesCapable(verdict: ToolUseVerdict): boolean {
	return verdict === "TOOL_NATIVE" || verdict === "TOOL_CAPABLE";
}

/**
 * Cross-reference an llmfit model row against the §5.AL empirical catalog: combine llmfit's fit/speed prior with our
 * measured tool-use verdict, and classify how the two tool-use signals agree or conflict. Pure — the catalog lookup is
 * injected (default {@link lookupModelCapability}).
 *
 * The load-bearing case is `conflict`: llmfit's HF scrape optimistically tags a chat/reasoning model as `tool_use`, but
 * we empirically found it TOOL_WEAK/TOOL_UNSUITABLE. `authoritativeToolUse` resolves that in the catalog's favour so
 * routing never loads an un-agentic model on llmfit's say-so.
 */
export function crossReferenceLlmfitWithCatalog(
	model: LlmfitModel,
	lookup: (modelId: string) => { toolUse: ToolUseVerdict } | null = lookupModelCapability,
): LlmfitCatalogCrossReference {
	const claimed = model.capabilityIds.includes("tool_use");
	const entry = lookup(model.name);
	const empirical: ToolUseVerdict | "UNKNOWN" = entry ? entry.toolUse : "UNKNOWN";

	let agreement: LlmfitToolUseAgreement;
	if (empirical === "UNKNOWN") {
		agreement = claimed ? "llmfit-only" : "no-data";
	} else {
		const capable = verdictImpliesCapable(empirical);
		if (claimed && capable) {
			agreement = "agree";
		} else if (!claimed && !capable) {
			agreement = "agree";
		} else if (claimed && !capable) {
			agreement = "conflict";
		} else {
			agreement = "catalog-only";
		}
	}

	return {
		name: model.name,
		fitLevel: model.fitLevel,
		routingPrior: llmfitRoutingPrior(model),
		llmfitClaimsToolUse: claimed,
		empiricalToolUse: empirical,
		toolUseAgreement: agreement,
		// Empirical wins whenever present; otherwise llmfit's claim is only an unverified prior, surfaced as UNKNOWN.
		authoritativeToolUse: empirical,
	};
}
