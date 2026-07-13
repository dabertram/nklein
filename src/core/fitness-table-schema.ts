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
	/** How many attempts actually CONTRIBUTED a wall time to the mean (not every attempt reports one). */
	meanWallTimeSamples: z.number().int().nonnegative().default(0),
	/** Rolling throughput (tokens/sec), or null when unsampled. */
	tokensPerSec: z.number().nonnegative().nullable().default(null),
	/** How many attempts actually CONTRIBUTED a throughput to the mean. */
	tokensPerSecSamples: z.number().int().nonnegative().default(0),
	/** F1.1 — attempts KNOWN to have consulted knowledge tools (code search / repo map / architecture knowledge). */
	knowledgeUseCount: z.number().int().nonnegative().default(0),
	/** F1.1 — attempts KNOWN to have skipped knowledge tools ("unknown" attempts advance neither count). */
	knowledgeSkipCount: z.number().int().nonnegative().default(0),
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

/**
 * F1.1 — share of KNOWN attempts that consulted knowledge tools, or null when no attempt reported either way.
 * Read-side tiebreak input: all else equal, a model that grounds its work in retrieval is preferred.
 */
export function fitnessKnowledgeUseRate(
	row: Pick<FitnessRow, "knowledgeUseCount" | "knowledgeSkipCount">,
): number | null {
	const known = row.knowledgeUseCount + row.knowledgeSkipCount;
	if (known <= 0) {
		return null;
	}
	return Math.min(1, Math.max(0, row.knowledgeUseCount / known));
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
	/** F1.1 — whether the attempt consulted knowledge tools; null/undefined = unknown (advances neither tally). */
	usedKnowledgeTools?: boolean | null;
}

/**
 * Incremental mean over the CONTRIBUTING samples: fold `next` into the running `mean` of `samples` prior VALUES. A null
 * `next` leaves the mean + count untouched (an attempt that reported nothing must not advance the divisor — else later
 * values get under-weighted by the intervening non-reporters). Returns the new `{ mean, samples }`.
 */
function foldMean(
	mean: number | null,
	samples: number,
	next: number | null | undefined,
): { mean: number | null; samples: number } {
	if (typeof next !== "number" || !Number.isFinite(next)) {
		return { mean, samples };
	}
	if (mean === null) {
		return { mean: next, samples: 1 };
	}
	// A row can carry a real historical mean with a LOST sample count (`samples === 0`): a fitness-table.json written
	// before the `*-Samples` fields existed migrates its `meanWallTimeMs`/`tokensPerSec` forward but defaults the count to
	// 0. Treat the existing mean as at least one prior sample so it BLENDS with `next` instead of being discarded — else
	// the first new attempt silently overwrites the model's entire historical average.
	const priorSamples = Math.max(1, samples);
	return { mean: mean + (next - mean) / (priorSamples + 1), samples: priorSamples + 1 };
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
	const wall = foldMean(row.meanWallTimeMs, row.meanWallTimeSamples, outcome.wallTimeMs);
	const tps = foldMean(row.tokensPerSec, row.tokensPerSecSamples, outcome.tokensPerSec);
	const knowledgeUseCount = row.knowledgeUseCount + (outcome.usedKnowledgeTools === true ? 1 : 0);
	const knowledgeSkipCount = row.knowledgeSkipCount + (outcome.usedKnowledgeTools === false ? 1 : 0);
	return {
		...row,
		knowledgeUseCount,
		knowledgeSkipCount,
		sampleCount: priorCount + 1,
		successCount: row.successCount + (outcome.success ? 1 : 0),
		failureModes,
		meanWallTimeMs: wall.mean,
		meanWallTimeSamples: wall.samples,
		tokensPerSec: tps.mean,
		tokensPerSecSamples: tps.samples,
		updatedAt: now ?? row.updatedAt,
	};
}

/**
 * F1.15c — merge two evidence streams for the SAME cell (the legacy/eval STORE row ⊕ the ledger PROJECTION row)
 * into one combined row: counts add, rolling means combine sample-weighted, failure modes union by kind,
 * retryBudget/updatedAt take the max. Pure + commutative on the numeric aggregates.
 */
export function mergeFitnessRows(left: FitnessRow, right: FitnessRow): FitnessRow {
	const failureModes = left.failureModes.map((mode) => ({ ...mode }));
	for (const mode of right.failureModes) {
		const existing = failureModes.find((candidate) => candidate.kind === mode.kind);
		if (existing) {
			existing.count += mode.count;
		} else {
			failureModes.push({ ...mode });
		}
	}
	const mergeMean = (
		aMean: number | null,
		aSamples: number,
		bMean: number | null,
		bSamples: number,
	): { mean: number | null; samples: number } => {
		const samples = aSamples + bSamples;
		if (aMean === null && bMean === null) {
			return { mean: null, samples };
		}
		const aSum = aMean !== null ? aMean * aSamples : 0;
		const bSum = bMean !== null ? bMean * bSamples : 0;
		return samples > 0 ? { mean: (aSum + bSum) / samples, samples } : { mean: null, samples };
	};
	const wall = mergeMean(
		left.meanWallTimeMs,
		left.meanWallTimeSamples,
		right.meanWallTimeMs,
		right.meanWallTimeSamples,
	);
	const tps = mergeMean(left.tokensPerSec, left.tokensPerSecSamples, right.tokensPerSec, right.tokensPerSecSamples);
	return {
		modelKey: left.modelKey,
		role: left.role,
		difficultyTier: left.difficultyTier,
		sampleCount: left.sampleCount + right.sampleCount,
		successCount: left.successCount + right.successCount,
		retryBudget: Math.max(left.retryBudget, right.retryBudget),
		failureModes,
		meanWallTimeMs: wall.mean,
		meanWallTimeSamples: wall.samples,
		tokensPerSec: tps.mean,
		tokensPerSecSamples: tps.samples,
		knowledgeUseCount: left.knowledgeUseCount + right.knowledgeUseCount,
		knowledgeSkipCount: left.knowledgeSkipCount + right.knowledgeSkipCount,
		updatedAt:
			left.updatedAt !== null && right.updatedAt !== null
				? Math.max(left.updatedAt, right.updatedAt)
				: (left.updatedAt ?? right.updatedAt),
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
		meanWallTimeSamples: 0,
		tokensPerSec: null,
		tokensPerSecSamples: 0,
		knowledgeUseCount: 0,
		knowledgeSkipCount: 0,
		updatedAt: null,
	};
}
