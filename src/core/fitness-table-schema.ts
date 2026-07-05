/**
 * §5.AB — the fitness table SCHEMA (pure). The global fitness store records how each (model × role × difficulty) cell
 * has historically performed, so the swarm scheduler + model selector can route by evidence: success rate, a learned
 * retry budget, the failure modes it exhibits, and rolling performance. This module is the schema + the pure key/derive
 * helpers only — the storage layer, migrations, and the write/read wiring are separate integration leaves.
 */

import { z } from "zod";

/** Difficulty tiers — kept in lock-step with §5.AB `estimateTaskDifficulty`. */
export const fitnessDifficultyTierSchema = z.enum(["easy", "medium", "hard"]);
export type FitnessDifficultyTier = z.infer<typeof fitnessDifficultyTierSchema>;

/** The dimensions that KEY a fitness cell: model × role × difficulty. */
export const fitnessKeySchema = z.object({
	modelKey: z.string(),
	role: z.string(),
	difficultyTier: fitnessDifficultyTierSchema,
});
export type FitnessKey = z.infer<typeof fitnessKeySchema>;

/** A known failure mode + how often this cell exhibited it (e.g. empty structured output, tool loop, spec drift). */
export const fitnessFailureModeSchema = z.object({
	kind: z.string(),
	count: z.number().int().nonnegative(),
});
export type FitnessFailureMode = z.infer<typeof fitnessFailureModeSchema>;

/** One fitness-table row: the accumulated evidence for a (model, role, difficulty) cell. */
export const fitnessRowSchema = fitnessKeySchema.extend({
	/** Attempts recorded for this cell. */
	sampleCount: z.number().int().nonnegative().default(0),
	/** Successful attempts. */
	successCount: z.number().int().nonnegative().default(0),
	/** The learned retry budget for this cell (how many rungs are worth attempting). */
	retryBudget: z.number().int().nonnegative().default(0),
	/** Observed failure modes + frequencies. */
	failureModes: z.array(fitnessFailureModeSchema).default([]),
	/** Rolling mean wall time (ms), or null when unsampled. */
	meanWallTimeMs: z.number().nonnegative().nullable().default(null),
	/** Rolling throughput (tokens/sec), or null when unsampled. */
	tokensPerSec: z.number().nonnegative().nullable().default(null),
	/** Last-updated timestamp (ms), or null. */
	updatedAt: z.number().nullable().default(null),
});
export type FitnessRow = z.infer<typeof fitnessRowSchema>;

/** The stable string key for a fitness cell (for a keyed store / map). */
export function fitnessCellKey(key: FitnessKey): string {
	return `${key.modelKey}::${key.role}::${key.difficultyTier}`;
}

/** Success rate of a row in [0,1] — 0 when unsampled (no evidence ⇒ not yet trusted). */
export function fitnessSuccessRate(row: Pick<FitnessRow, "sampleCount" | "successCount">): number {
	if (row.sampleCount <= 0) {
		return 0;
	}
	return Math.min(1, Math.max(0, row.successCount / row.sampleCount));
}

/** One recorded attempt outcome for a fitness cell — the write-side input the (harness/live-task) wiring folds in. */
export interface FitnessOutcome {
	success: boolean;
	/** The failure category when `success` is false (e.g. "empty_output", "tool_loop", "spec_drift"); ignored on success. */
	failureMode?: string;
	/** Wall time this attempt took (ms), when measured — folded into the rolling mean. */
	wallTimeMs?: number | null;
	/** Throughput this attempt sustained (tokens/sec), when measured — folded into the rolling mean. */
	tokensPerSec?: number | null;
}

/** Incremental mean: fold `next` into the running `mean` over `priorCount` prior samples. Null `next` leaves it. */
function foldMean(mean: number | null, priorCount: number, next: number | null | undefined): number | null {
	if (typeof next !== "number" || !Number.isFinite(next)) {
		return mean;
	}
	if (mean === null || priorCount <= 0) {
		return next;
	}
	return mean + (next - mean) / (priorCount + 1);
}

/**
 * Fold one attempt outcome into a fitness cell (pure — returns a NEW row; the key dimensions are preserved). Increments
 * the sample/success counts, tallies the failure mode on a miss, and rolls the wall-time / throughput means. `retryBudget`
 * is left untouched (it's learned by a separate policy, not per-attempt). This is the write-side CORE; the runtime reads
 * the cell, folds the task's outcome, and upserts it (see fitness-table-store).
 */
export function recordFitnessOutcome(row: FitnessRow, outcome: FitnessOutcome, now: number | null = null): FitnessRow {
	const priorCount = row.sampleCount;
	const failureModes = row.failureModes.map((mode) => ({ ...mode }));
	if (!outcome.success && outcome.failureMode) {
		const existing = failureModes.find((mode) => mode.kind === outcome.failureMode);
		if (existing) {
			existing.count += 1;
		} else {
			failureModes.push({ kind: outcome.failureMode, count: 1 });
		}
	}
	return {
		...row,
		sampleCount: priorCount + 1,
		successCount: row.successCount + (outcome.success ? 1 : 0),
		failureModes,
		meanWallTimeMs: foldMean(row.meanWallTimeMs, priorCount, outcome.wallTimeMs),
		tokensPerSec: foldMean(row.tokensPerSec, priorCount, outcome.tokensPerSec),
		updatedAt: now ?? row.updatedAt,
	};
}

/** An empty (unsampled) fitness cell for a key — the starting point the write-side fold accretes into. */
export function emptyFitnessRow(key: FitnessKey): FitnessRow {
	return {
		...key,
		sampleCount: 0,
		successCount: 0,
		retryBudget: 0,
		failureModes: [],
		meanWallTimeMs: null,
		tokensPerSec: null,
		updatedAt: null,
	};
}
