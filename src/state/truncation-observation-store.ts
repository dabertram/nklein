import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * F4.12 — append-only jsonl store for truncation observations. When a chat/swarm/review completion stops on a length
 * limit, the site records WHY (from {@link classifyOutputTruncation} over {@link extractCompletionUsage} + the planned
 * reasoning/answer budgets) so {@link summarizeTruncationDiagnostics} can show, per model, whether truncations are
 * reasoning-starved (raise the reasoning reserve / retry non-reasoning) or answer-capped (raise the answer budget) or the
 * provider ceiling. Best-effort producer (a recording failure must never break a chat turn). Schema-invalid lines are
 * skipped + diagnosed, never trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "truncation-observations");

export const TRUNCATION_CAUSES = ["reasoning_starved_answer", "answer_budget", "total_ceiling"] as const;

/** One recorded truncation: the cause + the model/role it happened on + the token/budget numbers behind the verdict. */
export interface StoredTruncationObservation {
	modelId: string;
	/** chat | swarm | review — WHERE the truncation happened. */
	surface: string;
	role: string;
	cause: (typeof TRUNCATION_CAUSES)[number];
	reasoningTokens: number;
	answerTokens: number;
	reasoningBudget: number;
	answerBudget: number;
}

export const storedTruncationObservationSchema: z.ZodType<StoredTruncationObservation> = z.object({
	modelId: z.string(),
	surface: z.string(),
	role: z.string(),
	cause: z.enum(TRUNCATION_CAUSES),
	reasoningTokens: z.number(),
	answerTokens: z.number(),
	reasoningBudget: z.number(),
	answerBudget: z.number(),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}
function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append truncation observations (one jsonl line each). Best-effort: callers should catch to stay non-fatal. */
export async function appendTruncationObservations(
	observations: readonly StoredTruncationObservation[],
	options?: { rootDir?: string },
): Promise<void> {
	if (observations.length === 0) {
		return;
	}
	const lines = observations
		.map((obs) => `${JSON.stringify(storedTruncationObservationSchema.parse(obs))}\n`)
		.join("");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), lines, "utf8");
}

/** Read every recorded truncation observation (empty when the log is missing/unreadable — never throws). */
export async function readAllTruncationObservations(options?: {
	rootDir?: string;
}): Promise<StoredTruncationObservation[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, storedTruncationObservationSchema, "truncation-observation-store");
}
