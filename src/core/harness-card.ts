/**
 * P20.8 — the ETCSOVG Harness Card, and refusing to compare configurations that are not comparable. PURE core.
 *
 * arXiv 2605.23950 ran 3 models × 3 harness configs on SWE-bench Verified and found **harness variance was 7.80×
 * MODEL variance** (18.48 pp² vs 2.37 pp²), with **model rankings REVERSED in 6 of 9 comparisons.** HAL reports
 * up to **34 pp** cross-scaffold spread for a single model.
 *
 * The consequence is uncomfortable and worth stating plainly: **for most published agent results, the harness is
 * the dominant variable and it is the one nobody describes.** A claim of the form "model X beats model Y" is,
 * more often than not, a claim about two scaffolds that were never specified.
 *
 * Expect this project's ratio to be WORSE than 7.8×, not better. Small models sit near a capability cliff, and
 * small scaffold changes push them across it — the same change that moves a frontier model two points can move a
 * 14B model twenty.
 *
 * ── THE RETRY RULE: THE BIGGEST SILENT CHEAT ──
 * "AI Agents That Matter" (arXiv 2407.01502) found a plain retry-with-temperature-ramp baseline reaching **93.2%
 * at $2.45** where LATS reached **88% at $134.50**. A scaffold that retries more will beat one that retries less,
 * and the difference will be attributed to the architecture.
 *
 * So unequal retry budgets are a BLOCKER here, not a caveat. Every other dimension mismatch downgrades a
 * comparison to "confounded, and here is what differed"; retries alone invalidate it, because retries buy score
 * directly and the purchase is invisible in the result.
 */

/** The seven dimensions a Harness Card must declare. */
export interface HarnessCard {
	readonly id: string;
	/** Execution: sandbox, isolation, resource limits. */
	readonly execution: string;
	/** Tool: which tools are offered, and how they are described. */
	readonly tool: string;
	/** Context: window, compaction policy, retrieval. */
	readonly context: string;
	/** Scheduling: concurrency, ordering, admission. */
	readonly scheduling: string;
	/** Observability: what is recorded, and what is therefore checkable. */
	readonly observability: string;
	/** Verification: how a task is judged done. */
	readonly verification: string;
	/** Governance: approvals, gates, what the harness refuses to do. */
	readonly governance: string;
	/**
	 * Retries permitted per task. Separated from `scheduling` deliberately — it is the one dimension that buys
	 * score directly, so it must be comparable at a glance rather than buried in prose.
	 */
	readonly retryBudget: number;
}

export type ComparabilityVerdict = "comparable" | "confounded" | "invalid";

export interface ComparabilityAssessment {
	readonly verdict: ComparabilityVerdict;
	/** Dimensions that differ between the two cards. */
	readonly differing: readonly string[];
	readonly reason: string;
}

const DIMENSIONS = [
	"execution",
	"tool",
	"context",
	"scheduling",
	"observability",
	"verification",
	"governance",
] as const;

/**
 * Decide whether two configurations can be compared at all.
 *
 * Three verdicts rather than two. `confounded` is not a soft `invalid`: a confounded comparison is still worth
 * running as long as the differing dimensions are REPORTED, because sometimes the difference is the thing being
 * tested. What is not acceptable is a difference nobody names — which is the state most published comparisons
 * are in.
 */
export function assessComparability(left: HarnessCard, right: HarnessCard): ComparabilityAssessment {
	const differing = DIMENSIONS.filter((dimension) => left[dimension].trim() !== right[dimension].trim());

	if (left.retryBudget !== right.retryBudget) {
		return {
			verdict: "invalid",
			differing: [...differing, "retryBudget"],
			reason: `retry budgets differ (${left.retryBudget} vs ${right.retryBudget}) — INVALID, not merely confounded. A scaffold that retries more will beat one that retries less and the gain will be credited to its architecture: a plain retry-with-temperature-ramp baseline reached 93.2% at $2.45 where LATS reached 88% at $134.50. EQUALIZE RETRIES FIRST.`,
		};
	}

	if (differing.length === 0) {
		return {
			verdict: "comparable",
			differing: [],
			reason:
				"all seven ETCSOVG dimensions and the retry budget match — a difference in outcome is attributable to what was actually varied",
		};
	}

	return {
		verdict: "confounded",
		differing,
		reason: `${differing.length} dimension(s) differ: ${differing.join(", ")}. CONFOUNDED, which is fine IF the difference is what is being tested and is reported — harness variance ran 7.80× model variance in the literature and reversed rankings in 6 of 9 comparisons, so an unreported difference here is more likely to explain the result than the models are.`,
	};
}

export type CardDefect = "missing_dimension" | "negative_retry_budget";

/**
 * Check a card is complete.
 *
 * An empty dimension is treated as a DEFECT rather than as "not applicable". "We did not write it down" and "it
 * does not apply" are different claims, and only the second is ever true — every harness has an execution model
 * and a verification method, whether or not anyone described them.
 */
export function assessCardCompleteness(card: HarnessCard): {
	readonly defects: readonly CardDefect[];
	readonly missing: readonly string[];
	readonly complete: boolean;
} {
	const missing = DIMENSIONS.filter((dimension) => card[dimension].trim().length === 0);
	const defects: CardDefect[] = [];
	if (missing.length > 0) {
		defects.push("missing_dimension");
	}
	if (!Number.isFinite(card.retryBudget) || card.retryBudget < 0) {
		defects.push("negative_retry_budget");
	}
	return { defects, missing, complete: defects.length === 0 };
}
