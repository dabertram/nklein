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
