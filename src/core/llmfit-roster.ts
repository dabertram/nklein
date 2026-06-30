/**
 * llmfit → AGENTIC roster planner (todo §5.AB / per-machine pools, user 2026-07-01 — "llmfit would help auto-selecting
 * models"). `decideModelLoad` + `refineLoadDecisionWithLlmfit` already gate ONE model's load (RAM headroom + llmfit fit);
 * this is the layer ABOVE — given llmfit's already-ranked `recommend` for a machine, pick the **roster to load**: the
 * fit-and-fast models that are ALSO tool-capable (agentic), preserving llmfit's quality/fit/speed order, capped.
 *
 * Mirrors the integration thesis ([[llmfit-integration]]): llmfit narrows to fits-and-fast → we filter to tool-capable.
 * The tool-use signal here is llmfit's CLAIM ({@link llmfitClaimsToolUse}) — a pre-load filter; the §5.AL catalog + §5.AF
 * ledger refine the real agentic verdict AFTER a model is loaded and observed. Pure (no I/O), so it is fully unit-testable.
 */

import {
	type LlmfitFitLevel,
	type LlmfitModel,
	type LlmfitRecommendation,
	llmfitClaimsToolUse,
} from "./llmfit-adapter";

/** Best-to-worst, so a `minFit` threshold is "index ≤ the threshold's index". */
const FIT_RANK: readonly LlmfitFitLevel[] = ["Perfect", "Good", "Marginal", "Too Tight"];

export interface LlmfitRosterOptions {
	/** Max models in the roster (e.g. the machine's per-pool concurrency budget). Default: no cap. */
	maxModels?: number;
	/** Require llmfit to CLAIM tool use (agentic filter). Default true — a roster is for agentic cards. */
	requireToolUse?: boolean;
	/** Worst fit level to accept (inclusive). Default "Good" — exclude `Marginal`/`Too Tight` (too tight to run well). */
	minFit?: LlmfitFitLevel;
}

/** A model's fit rank (0 = Perfect). Unknown fit ⇒ worst, so it sorts/filters out last. */
function fitRank(model: LlmfitModel): number {
	const index = model.fitLevel ? FIT_RANK.indexOf(model.fitLevel) : -1;
	return index >= 0 ? index : FIT_RANK.length;
}

/**
 * Plan the agentic roster to load on a machine from its llmfit recommendation. Keeps only models that clear `minFit` and
 * (by default) claim tool use, preserves llmfit's ranked order, and caps to `maxModels`. Returns `[]` when nothing
 * qualifies (the caller then keeps whatever is already loaded / falls back).
 */
export function selectLlmfitRoster(
	recommendation: LlmfitRecommendation,
	options: LlmfitRosterOptions = {},
): LlmfitModel[] {
	const requireToolUse = options.requireToolUse ?? true;
	const maxFitRank = FIT_RANK.indexOf(options.minFit ?? "Good");
	const roster = recommendation.models.filter(
		(model) => fitRank(model) <= maxFitRank && (!requireToolUse || llmfitClaimsToolUse(model)),
	);
	return typeof options.maxModels === "number" && options.maxModels >= 0 ? roster.slice(0, options.maxModels) : roster;
}
