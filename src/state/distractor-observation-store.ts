import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { EVAL_DIFFICULTY_TIERS, type EvalDifficultyTier } from "../core/model-eval-aggregation";
import type { DistractorObservation } from "../core/model-sensitive-pruning";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Append-only jsonl store for F4.13 distractor-sensitivity observations — cell-keyed {@link DistractorObservation}s
 * (a noise fraction + the baseline-vs-noisy quality pair) so {@link estimateDistractorSensitivity} can learn how much
 * each (model, role, difficulty) degrades under marginally-relevant context. Produced by the eval runner's OPT-IN
 * noise A/B pass (default off ⇒ nothing writes here). Schema-invalid lines are skipped + diagnosed, never trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "distractor-observations");

/** One cell-keyed distractor observation. Groups by (modelId, role, difficulty) into an estimateDistractorSensitivity batch. */
export interface StoredDistractorObservation extends DistractorObservation {
	modelId: string;
	role: string;
	difficulty: EvalDifficultyTier;
}

export const storedDistractorObservationSchema: z.ZodType<StoredDistractorObservation> = z.object({
	modelId: z.string(),
	role: z.string(),
	difficulty: z.enum(EVAL_DIFFICULTY_TIERS),
	noiseFraction: z.number(),
	baselineQuality: z.number(),
	noisyQuality: z.number(),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append distractor observations (one jsonl line each). Best-effort: callers should catch to stay non-fatal. */
export async function appendDistractorObservations(
	observations: readonly StoredDistractorObservation[],
	options?: { rootDir?: string },
): Promise<void> {
	if (observations.length === 0) {
		return;
	}
	const lines = observations
		.map((obs) => `${JSON.stringify(storedDistractorObservationSchema.parse(obs))}\n`)
		.join("");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), lines, "utf8");
}

/** Read every recorded distractor observation (empty when the log is missing/unreadable — never throws). */
export async function readAllDistractorObservations(options?: {
	rootDir?: string;
}): Promise<StoredDistractorObservation[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, storedDistractorObservationSchema, "distractor-observation-store");
}
