/**
 * §5.AB — pure projections over the fitness table. The "failing-LLM list" is NOT a hand-maintained list: it's the
 * PROJECTION of below-bar (model × role × difficulty) cells — cells with enough evidence whose success rate is under
 * the bar. A leaderboard is the dual (best cells first). Keeping these as pure projections over {@link FitnessRow} rows
 * means the scheduler + model selector read live evidence, never a stale curated list. Pure + total.
 */

import { type FitnessRow, fitnessSuccessRate } from "./fitness-table-schema.js";

export interface BelowBarCriteria {
	/** The success-rate bar; a well-sampled cell below this is "failing". */
	minSuccessRate: number;
	/** Minimum samples before judging a cell — avoids condemning a (model, role) on one flaky run. */
	minSamples: number;
}

/**
 * The failing-LLM list: below-bar cells that have ENOUGH evidence (≥ `minSamples`) AND a success rate under the bar.
 * Under-sampled cells are excluded (not yet judged, not "failing"). Sorted worst-first (lowest success rate). Pure.
 */
export function projectFailingCells(rows: readonly FitnessRow[], criteria: BelowBarCriteria): FitnessRow[] {
	return rows
		.filter((row) => row.sampleCount >= criteria.minSamples && fitnessSuccessRate(row) < criteria.minSuccessRate)
		.sort((a, b) => fitnessSuccessRate(a) - fitnessSuccessRate(b));
}

/** The dual: well-sampled cells at/above the bar, best-first (highest success rate). Pure. */
export function projectPassingCells(rows: readonly FitnessRow[], criteria: BelowBarCriteria): FitnessRow[] {
	return rows
		.filter((row) => row.sampleCount >= criteria.minSamples && fitnessSuccessRate(row) >= criteria.minSuccessRate)
		.sort((a, b) => fitnessSuccessRate(b) - fitnessSuccessRate(a));
}
