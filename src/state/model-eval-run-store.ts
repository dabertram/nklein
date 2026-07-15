import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { EVAL_DIFFICULTY_TIERS, type ModelEvalRun } from "../core/model-eval-aggregation";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Append-only jsonl store for raw per-run {@link ModelEvalRun} records — the recording seam that lets
 * {@link summarizeModelRoleStability} judge whether a (model, role)'s eval outcomes are SETTLED or FLAKY. The eval
 * runner folds runs into the aggregate fitness store (which loses the per-run quality spread); this keeps the raw runs
 * so the stability read can measure variance. One global log; schema-invalid lines are skipped + diagnosed, never
 * trusted. Recording is best-effort at the eval seam: a write failure must never break an eval run.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "model-eval-runs");

/** Persisted-record schema (matches {@link ModelEvalRun}). `role` stays a free string, mirroring the fitness record. */
export const modelEvalRunSchema: z.ZodType<ModelEvalRun> = z.object({
	modelId: z.string(),
	role: z.string(),
	difficulty: z.enum(EVAL_DIFFICULTY_TIERS),
	passed: z.boolean(),
	qualityScore: z.number(),
	latencyMs: z.number(),
	retries: z.number(),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append a batch of eval runs (one jsonl line each). Best-effort: callers should catch to stay non-fatal. */
export async function appendModelEvalRuns(
	runs: readonly ModelEvalRun[],
	options?: { rootDir?: string },
): Promise<void> {
	if (runs.length === 0) {
		return;
	}
	const lines = runs.map((run) => `${JSON.stringify(modelEvalRunSchema.parse(run))}\n`).join("");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), lines, "utf8");
}

/** Read every recorded eval run (empty when the log is missing/unreadable — never throws). */
export async function readAllModelEvalRuns(options?: { rootDir?: string }): Promise<ModelEvalRun[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, modelEvalRunSchema, "model-eval-run-store");
}
