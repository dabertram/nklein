/**
 * §5.AB — pure projections over the fitness table. The "failing-LLM list" is NOT a hand-maintained list: it's the
 * PROJECTION of below-bar (model × role × difficulty) cells — cells with enough evidence whose success rate is under
 * the bar. A leaderboard is the dual (best cells first). Keeping these as pure projections over {@link FitnessRow} rows
 * means the scheduler + model selector read live evidence, never a stale curated list. Pure + total.
 */

import {
	type FitnessDifficultyTier,
	type FitnessRow,
	fitnessKnowledgeUseRate,
	fitnessSuccessRate,
} from "./fitness-table-schema.js";

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

/** A model-selection query over the fitness table: which models fit a specific (role × difficulty) cell. */
export interface FitnessSelectionQuery {
	role: string;
	difficultyTier: FitnessDifficultyTier;
	/** Exclude cells below this sample count (no evidence yet ⇒ not rankable). Default 1. */
	minSamples?: number;
}

/**
 * The model-selection READ SIDE (§5.AB): rank the models with evidence for a specific (role × difficulty) cell,
 * BEST-FIRST. Tie-break order: success rate desc → sample count desc (more evidence is more trustworthy) →
 * knowledge-use rate desc (F1.1: all else equal, a model that grounds its work in retrieval is preferred; unknown
 * sorts below known) → mean wall time asc (faster wins a further tie; unmeasured sorts last). Cells below
 * `minSamples` are excluded. Pure + total — the swarm scheduler / model selector reads LIVE evidence, never a stale
 * curated list.
 */
export function rankFitnessCandidatesForCell(rows: readonly FitnessRow[], query: FitnessSelectionQuery): FitnessRow[] {
	const minSamples = query.minSamples ?? 1;
	return rows
		.filter(
			(row) =>
				row.role === query.role && row.difficultyTier === query.difficultyTier && row.sampleCount >= minSamples,
		)
		.sort((a, b) => {
			const byRate = fitnessSuccessRate(b) - fitnessSuccessRate(a);
			if (byRate !== 0) {
				return byRate;
			}
			if (b.sampleCount !== a.sampleCount) {
				return b.sampleCount - a.sampleCount;
			}
			// F1.1: a known knowledge-use rate ranks above unknown; higher rate wins among known.
			const aKnowledge = fitnessKnowledgeUseRate(a) ?? -1;
			const bKnowledge = fitnessKnowledgeUseRate(b) ?? -1;
			if (aKnowledge !== bKnowledge) {
				return bKnowledge - aKnowledge;
			}
			const aWall = a.meanWallTimeMs ?? Number.POSITIVE_INFINITY;
			const bWall = b.meanWallTimeMs ?? Number.POSITIVE_INFINITY;
			// Compare only when they differ: two unmeasured rows are both +Infinity, and `Infinity - Infinity` is NaN — a
			// NaN comparator makes Array.sort engine/insertion-order dependent, so `bestFitnessCandidateForCell` (index 0)
			// could return either tied model nondeterministically. Fall through to a stable modelKey tiebreak.
			if (aWall !== bWall) {
				return aWall - bWall; // faster (smaller) first; finite always beats +Infinity
			}
			return a.modelKey.localeCompare(b.modelKey);
		});
}

/** The single best-fit model for a cell (top of the ranking), or null when no model has evidence yet. Pure. */
export function bestFitnessCandidateForCell(
	rows: readonly FitnessRow[],
	query: FitnessSelectionQuery,
): FitnessRow | null {
	return rankFitnessCandidatesForCell(rows, query)[0] ?? null;
}
