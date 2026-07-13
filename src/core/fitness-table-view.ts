/**
 * §5.AL fitness-table VIEW (pure) — the read-model behind the operator's fitness browser. It flattens the stored
 * `(model × role × difficulty)` fitness rows into a display list: each cell gets its derived success rate and a
 * `belowBar` flag (the "failing-LLM list" projection — a well-sampled cell under the bar), sorted worst-first so the
 * cells needing attention lead. Pure + injected-criteria, so it is fully unit-testable and the wiring (the tRPC read
 * endpoint) stays a thin adapter over it.
 */

import type { BelowBarCriteria } from "./fitness-projections";
import { projectFailingCells } from "./fitness-projections";
import {
	type FitnessRow,
	fitnessCellKey,
	fitnessConfidenceBand,
	fitnessConfidenceLowerBound,
	fitnessSuccessRate,
} from "./fitness-table-schema";

/**
 * The default bar for the browser's `belowBar` flag: a cell needs ≥ 3 attempts before it can be judged (one flaky run
 * never condemns a model), and under a 50% success rate it reads as failing. Overridable by the caller.
 */
export const DEFAULT_FITNESS_VIEW_CRITERIA: BelowBarCriteria = {
	minSuccessRate: 0.5,
	minSamples: 3,
};

/** One display row for the fitness browser — the stored evidence plus the derived success rate + below-bar flag. */
export interface FitnessTableViewRow {
	modelKey: string;
	role: string;
	difficultyTier: "easy" | "medium" | "hard";
	sampleCount: number;
	successCount: number;
	/** Derived success rate in [0,1] (0 when unsampled). */
	successRate: number;
	/** F2.22: sample-size-aware confidence — the Wilson 95% lower bound of the success rate (sorts "how sure"). */
	confidenceLowerBound: number;
	/** F2.22: coarse confidence band from sample count (none/low/medium/high) — the display label. */
	confidenceBand: "none" | "low" | "medium" | "high";
	retryBudget: number;
	failureModes: { kind: string; count: number }[];
	meanWallTimeMs: number | null;
	tokensPerSec: number | null;
	updatedAt: number | null;
	/** TRUE when this cell is in the failing-LLM projection (well-sampled AND under the success bar). */
	belowBar: boolean;
}

/**
 * Build the display list: every stored row projected to a view row, `belowBar` set from `projectFailingCells`, sorted
 * worst-first (lowest success rate; the same-rate tie broken by cell key so the order is deterministic).
 */
export function buildFitnessTableView(
	rows: readonly FitnessRow[],
	criteria: BelowBarCriteria = DEFAULT_FITNESS_VIEW_CRITERIA,
): FitnessTableViewRow[] {
	const failingKeys = new Set(projectFailingCells(rows, criteria).map((row) => fitnessCellKey(row)));
	return rows
		.map(
			(row): FitnessTableViewRow => ({
				modelKey: row.modelKey,
				role: row.role,
				difficultyTier: row.difficultyTier,
				sampleCount: row.sampleCount,
				successCount: row.successCount,
				successRate: fitnessSuccessRate(row),
				confidenceLowerBound: fitnessConfidenceLowerBound(row),
				confidenceBand: fitnessConfidenceBand(row.sampleCount),
				retryBudget: row.retryBudget,
				failureModes: row.failureModes.map((mode) => ({ kind: mode.kind, count: mode.count })),
				meanWallTimeMs: row.meanWallTimeMs,
				tokensPerSec: row.tokensPerSec,
				updatedAt: row.updatedAt,
				belowBar: failingKeys.has(fitnessCellKey(row)),
			}),
		)
		.sort((a, b) => {
			const byRate = a.successRate - b.successRate;
			if (byRate !== 0) {
				return byRate;
			}
			return fitnessCellKey(a).localeCompare(fitnessCellKey(b));
		});
}
