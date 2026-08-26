/**
 * P25.3 phase 4 — AUTO-ASSIGNMENT from measured fitness, pure. Given the fitness rows for a (role, difficulty)
 * cell and the context DEPTH the card will actually run at, pick a model or ABSTAIN — and say which.
 *
 * ── WHY THIS COULD NOT BE BUILT BEFORE P22.2 ──
 * The item's own gate: *"a depth-blind fitness number is the wrong basis for routing a deep card"*. Fitness rows
 * now carry `depthSamples`, so a cell's evidence can be checked against the depth being routed for. The
 * shallow-vs-deep rule is NOT restated here — it is derived per bucket through `fitnessDepthMismatch`, the same
 * function the freshness/re-eval side uses, so the two can never drift apart about what covers what.
 *
 * ── DEPTH-SCOPED NOW (P25.3 phase-4 real fix shipped 2026-08-26) ──
 * The row carries per-depth SUCCESS counts (`depthSuccesses`) parallel to `depthSamples`, so the confidence and
 * success rate are computed from the DEPTH-MATCHED (successes, samples) — a deep card is judged on the model's
 * DEEP record, not a depth-blind rate other depths produced. The two guards still bound over-read:
 *   · `minDepthMatchedSamples` — the cell must actually have been exercised at this depth (absence of deep
 *     evidence is never read as deep capability, the CodeAct-gate direction), and
 *   · `minDepthMatchedShare` — the depth-matched samples must be a real FRACTION of the row.
 * A row written before `depthSuccesses` existed reads zero successes there and falls back to the row rate, so a
 * legacy row degrades to the prior behaviour rather than reading as all-failure.
 *
 * ── WHY THE TOP SCORE DOES NOT AUTOMATICALLY WIN ──
 * P22's own research: BFCL V4 has Qwen3-8B at 41.75 and Qwen3-14B at 34.75 on multi-turn — *"any architectural
 * or size signal smaller than that gap is noise"*. Within a noise band the two candidates are indistinguishable,
 * so the tiebreak is MORE EVIDENCE (depth-matched samples), never the marginally higher number.
 *
 * Confidence is the Wilson lower bound (`fitnessConfidenceLowerBound`), not the raw rate: a 1/1 cell must not
 * outrank a 45/50 one.
 */

import {
	type FitnessRow,
	fitnessConfidenceLowerBound,
	fitnessSuccessRate,
	wilsonLowerBound,
} from "./fitness-table-schema";
import { type ContextDepthBucket, fitnessDepthMismatch } from "./model-fitness-freshness";

export interface FitnessAssignmentPolicy {
	/** Depth-matched attempts required before a cell can be routed to at this depth. */
	readonly minDepthMatchedSamples: number;
	/** Depth-matched attempts as a share of the row's total, so a depth-blind rate cannot carry a stray sample. */
	readonly minDepthMatchedShare: number;
	/** Wilson lower-bound floor — evidence must be positive, not merely present. */
	readonly minConfidence: number;
	/** Confidence differences at or below this are NOISE (BFCL multi-turn 41.75 vs 34.75 ⇒ ~7 points). */
	readonly noiseBand: number;
}

export const DEFAULT_FITNESS_ASSIGNMENT_POLICY: FitnessAssignmentPolicy = {
	minDepthMatchedSamples: 5,
	minDepthMatchedShare: 0.5,
	minConfidence: 0.5,
	noiseBand: 0.07,
};

export interface FitnessAssignmentContender {
	readonly modelKey: string;
	readonly confidence: number;
	readonly successRate: number;
	readonly depthMatchedSamples: number;
	readonly totalSamples: number;
}

export type FitnessAssignmentAbstainReason =
	/** No candidate had a fitness row at all — nothing measured, nothing to route by. */
	| "no_evidence"
	/** Rows exist, but none has been exercised at the depth this card needs. */
	| "no_depth_matched_evidence"
	/** Depth-matched rows exist, but every one is below the confidence floor — measured, and measured bad. */
	| "below_confidence_floor";

export type FitnessAssignment =
	| {
			readonly kind: "assigned";
			readonly modelKey: string;
			readonly confidence: number;
			readonly depthMatchedSamples: number;
			/** Why this one won: outright score, or a noise-band tie broken by evidence volume. */
			readonly basis: "highest_confidence" | "tie_broken_by_evidence";
			readonly runnerUp: FitnessAssignmentContender | null;
			readonly reason: string;
	  }
	| {
			readonly kind: "abstain";
			readonly reason: FitnessAssignmentAbstainReason;
			readonly detail: string;
	  };

/**
 * How many of a row's attempts COVER the needed depth — derived through `fitnessDepthMismatch` per bucket so the
 * coverage rule lives in exactly one place (deep needs deep; medium needs medium-or-deeper; shallow takes any).
 */
export function depthMatchedSamples(row: FitnessRow, needed: ContextDepthBucket): number {
	const buckets: ContextDepthBucket[] = ["shallow", "medium", "deep"];
	return buckets
		.filter((bucket) => !fitnessDepthMismatch(bucket, needed))
		.reduce((total, bucket) => total + row.depthSamples[bucket], 0);
}

/**
 * P25.3 phase-4 REAL FIX: the SUCCESS count over the depth buckets that cover the needed depth — the parallel of
 * {@link depthMatchedSamples}. With this the decider judges a card on the model's DEPTH-SCOPED success rate, not
 * the depth-blind row rate the honest-limit note above warned about. A row written before depthSuccesses existed
 * reads zero here, which — paired with the minDepthMatchedSamples floor — correctly abstains rather than lies.
 */
export function depthMatchedSuccesses(row: FitnessRow, needed: ContextDepthBucket): number {
	const buckets: ContextDepthBucket[] = ["shallow", "medium", "deep"];
	return buckets
		.filter((bucket) => !fitnessDepthMismatch(bucket, needed))
		.reduce((total, bucket) => total + row.depthSuccesses[bucket], 0);
}

/**
 * Pick the model for a (role, difficulty) cell at a given depth, or abstain with the reason.
 *
 * `rows` must already be scoped to the role+difficulty being routed (the caller owns that lookup); every row is
 * treated as one candidate model. Candidates with no row are simply absent — this function never invents a
 * contender it has no evidence for.
 */
export function assignModelFromFitness(input: {
	readonly rows: readonly FitnessRow[];
	readonly neededDepth: ContextDepthBucket;
	readonly policy?: FitnessAssignmentPolicy;
}): FitnessAssignment {
	const policy = input.policy ?? DEFAULT_FITNESS_ASSIGNMENT_POLICY;
	if (input.rows.length === 0) {
		return { kind: "abstain", reason: "no_evidence", detail: "no fitness row for this role/difficulty cell" };
	}

	const depthCovered = input.rows
		.map((row) => ({ row, matched: depthMatchedSamples(row, input.neededDepth) }))
		.filter(
			({ row, matched }) =>
				matched >= policy.minDepthMatchedSamples &&
				row.sampleCount > 0 &&
				matched / row.sampleCount >= policy.minDepthMatchedShare,
		);
	if (depthCovered.length === 0) {
		return {
			kind: "abstain",
			reason: "no_depth_matched_evidence",
			detail: `no cell has ≥${policy.minDepthMatchedSamples} attempts (and ≥${Math.round(
				policy.minDepthMatchedShare * 100,
			)}% of its evidence) at ${input.neededDepth} depth — absence of depth evidence is not depth capability`,
		};
	}

	const contenders: FitnessAssignmentContender[] = depthCovered
		.map(({ row, matched }) => {
			// P25.3 phase-4: judge on the DEPTH-SCOPED rate now that per-depth successes exist. The confidence and
			// rate come from the depth-matched (successes, samples) — a deep card is scored on the model's DEEP
			// record, not a rate other depths produced. Falls back to the row rate only if the row predates
			// depthSuccesses (all-zero) yet has depth-matched samples — an impossible state for a freshly folded
			// row, but handled so a legacy row degrades to today's behaviour rather than reading as all-failure.
			const depthSuccessesMatched = depthMatchedSuccesses(row, input.neededDepth);
			const hasDepthSuccessEvidence = depthSuccessesMatched > 0 || row.successCount === 0;
			return {
				modelKey: row.modelKey,
				confidence: hasDepthSuccessEvidence
					? wilsonLowerBound(depthSuccessesMatched, matched)
					: fitnessConfidenceLowerBound(row),
				successRate: hasDepthSuccessEvidence
					? matched > 0
						? depthSuccessesMatched / matched
						: 0
					: fitnessSuccessRate(row),
				depthMatchedSamples: matched,
				totalSamples: row.sampleCount,
			};
		})
		// Deterministic order: confidence, then evidence volume, then key — never insertion order.
		.sort(
			(left, right) =>
				right.confidence - left.confidence ||
				right.depthMatchedSamples - left.depthMatchedSamples ||
				left.modelKey.localeCompare(right.modelKey),
		);

	const qualified = contenders.filter((contender) => contender.confidence >= policy.minConfidence);
	if (qualified.length === 0) {
		const best = contenders[0] as FitnessAssignmentContender;
		return {
			kind: "abstain",
			reason: "below_confidence_floor",
			detail: `best depth-matched cell ${best.modelKey} scores ${best.confidence.toFixed(2)} < ${policy.minConfidence} (Wilson lower bound over ${best.totalSamples} attempt(s))`,
		};
	}

	const leader = qualified[0] as FitnessAssignmentContender;
	// Everything within the noise band of the leader is statistically indistinguishable from it; among those the
	// one with the MOST depth-matched evidence wins, because a larger sample is the only real difference there.
	const withinNoise = qualified.filter((contender) => leader.confidence - contender.confidence <= policy.noiseBand);
	const chosen = withinNoise.reduce((best, contender) =>
		contender.depthMatchedSamples > best.depthMatchedSamples ||
		(contender.depthMatchedSamples === best.depthMatchedSamples &&
			contender.modelKey.localeCompare(best.modelKey) < 0)
			? contender
			: best,
	);
	const runnerUp = qualified.find((contender) => contender.modelKey !== chosen.modelKey) ?? null;
	const tie = chosen.modelKey !== leader.modelKey;
	return {
		kind: "assigned",
		modelKey: chosen.modelKey,
		confidence: chosen.confidence,
		depthMatchedSamples: chosen.depthMatchedSamples,
		basis: tie ? "tie_broken_by_evidence" : "highest_confidence",
		runnerUp,
		reason: tie
			? `${chosen.modelKey} ties ${leader.modelKey} within the ${policy.noiseBand} noise band and carries more ${input.neededDepth}-depth evidence (${chosen.depthMatchedSamples} vs ${leader.depthMatchedSamples} attempts)`
			: `${chosen.modelKey} leads on confidence (${chosen.confidence.toFixed(2)}) with ${chosen.depthMatchedSamples} ${input.neededDepth}-depth attempt(s)`,
	};
}
