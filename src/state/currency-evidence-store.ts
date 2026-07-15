import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { CurrencyEvidence } from "../core/evidence-currency-status";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Append-only jsonl store for F4.3 {@link CurrencyEvidence} — the sanitized date/trust/support facts about retrieved
 * web sources (never the body) so {@link summarizeEvidenceCurrency} can answer "is this current?". Produced by the
 * web-research fetch (opt-in + egress-gated). Schema-invalid lines are skipped + diagnosed, never trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "currency-evidence");

export const currencyEvidenceSchema: z.ZodType<CurrencyEvidence> = z.object({
	id: z.string(),
	sourceDateMs: z.number().nullable(),
	trust: z.enum(["high", "medium", "low", "unknown"]),
	supports: z.boolean(),
	conflictsWithIds: z.array(z.string()),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append currency-evidence records (one jsonl line each). Best-effort: callers should catch to stay non-fatal. */
export async function appendCurrencyEvidence(
	evidence: readonly CurrencyEvidence[],
	options?: { rootDir?: string },
): Promise<void> {
	if (evidence.length === 0) {
		return;
	}
	const lines = evidence.map((item) => `${JSON.stringify(currencyEvidenceSchema.parse(item))}\n`).join("");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), lines, "utf8");
}

/** Read every recorded currency-evidence record (empty when the log is missing/unreadable — never throws). */
export async function readAllCurrencyEvidence(options?: { rootDir?: string }): Promise<CurrencyEvidence[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, currencyEvidenceSchema, "currency-evidence-store");
}
