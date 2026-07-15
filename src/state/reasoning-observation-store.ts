import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { EVAL_DIFFICULTY_TIERS, type EvalDifficultyTier } from "../core/model-eval-aggregation";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Append-only jsonl store for F3.16 reasoning-benefit observations — cell-keyed {@link ReasoningObservation}s (a
 * `reasoningEnabled` flag + the resulting `qualityScore`) so {@link learnReasoningBenefit} can measure, per
 * (model, role, difficulty), whether forcing a reasoning phase actually helps. Produced by the eval runner's OPT-IN
 * A/B pass (default off ⇒ nothing writes here). Schema-invalid lines are skipped + diagnosed, never trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "reasoning-observations");

/** One cell-keyed reasoning observation. Groups by (modelId, role, difficulty) into a learnReasoningBenefit batch. */
export interface StoredReasoningObservation {
	modelId: string;
	role: string;
	difficulty: EvalDifficultyTier;
	reasoningEnabled: boolean;
	qualityScore: number;
}

export const storedReasoningObservationSchema: z.ZodType<StoredReasoningObservation> = z.object({
	modelId: z.string(),
	role: z.string(),
	difficulty: z.enum(EVAL_DIFFICULTY_TIERS),
	reasoningEnabled: z.boolean(),
	qualityScore: z.number(),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append reasoning observations (one jsonl line each). Best-effort: callers should catch to stay non-fatal. */
export async function appendReasoningObservations(
	observations: readonly StoredReasoningObservation[],
	options?: { rootDir?: string },
): Promise<void> {
	if (observations.length === 0) {
		return;
	}
	const lines = observations.map((obs) => `${JSON.stringify(storedReasoningObservationSchema.parse(obs))}\n`).join("");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), lines, "utf8");
}

/** Read every recorded reasoning observation (empty when the log is missing/unreadable — never throws). */
export async function readAllReasoningObservations(options?: {
	rootDir?: string;
}): Promise<StoredReasoningObservation[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, storedReasoningObservationSchema, "reasoning-observation-store");
}
