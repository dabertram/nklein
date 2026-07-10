/**
 * §5.AB eval harness CLI (todo 5913) — run the eval-prompt corpus through ONE model and score each cell with the
 * deterministic scorers. Designed to be driven by `verify-all-models.mts` across the roster (reads
 * `NKLEIN_VERIFY_MODEL` / `NKLEIN_VERIFY_BASE_URL`), so per-model fitness accrues from one command.
 *
 * This is now a THIN CLI over `src/nklein-agent/model-eval-runner.ts` (`runModelEval`), the shared executor the
 * in-runtime "Evaluate connected models" trigger (todo 6544) also calls — one code path, no drift. The script owns
 * only: env parsing, the real `chat` (fetch) impl, printing, optional persistence, and the PASS/PARTIAL/FAIL exit.
 *
 * Exit code: 0 = mean score ≥ PASS_BAR, 3 = graded PARTIAL (ran but below bar), 1 = nothing scorable (all cells
 * failed to produce an answer) — matching the PASS/PARTIAL/FAIL convention `verify-all-models.mts` reads.
 */

import {
	type ModelEvalChat,
	type ModelEvalChatChoice,
	type ModelEvalChatMessage,
	evalDifficultyToFitnessTier,
	runModelEval,
} from "../src/nklein-agent/model-eval-runner.js";
import { recordTaskFitnessOutcome } from "../src/telemetry/fitness-table-store.js";

/**
 * Opt-in: persist each cell into the shared `fitness-table.json` (the §5.AB store `recordTaskFitnessOutcome` writes)
 * so routing consumes measured eval fitness across runs. OFF by default because `verify-all-models.mts` runs harnesses
 * under an ISOLATED temp HOME — persisting there would write to a throwaway store. Set NKLEIN_EVAL_PERSIST=1 for a
 * standalone run against the real runtime home.
 */
const PERSIST = process.env.NKLEIN_EVAL_PERSIST === "1";
const MODEL = process.env.NKLEIN_VERIFY_MODEL ?? "";
// Convention (matches verify-all-models.mts + the other harnesses): NKLEIN_VERIFY_BASE_URL is `/v1`-suffixed. Normalize
// so we always end at exactly one `/v1` regardless of whether the caller included it (bug caught 2026-07-08: a double
// `/v1` from the orchestrator produced 404 → "no scorable cells").
const RAW_BASE = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1").trim().replace(/\/+$/, "");
const CHAT_URL = `${RAW_BASE.endsWith("/v1") ? RAW_BASE : `${RAW_BASE}/v1`}/chat/completions`;
const MAX_TOKENS = Number(process.env.NKLEIN_EVAL_MAX_TOKENS ?? "2500");
const PASS_BAR = Number(process.env.NKLEIN_EVAL_PASS_BAR ?? "0.6");
const REPEATS = Math.max(1, Math.trunc(Number(process.env.NKLEIN_EVAL_REPEATS ?? "1")) || 1);

if (!MODEL) {
	console.error("eval-harness: NKLEIN_VERIFY_MODEL is required");
	process.exit(64);
}

const chat: ModelEvalChat = async (messages: ModelEvalChatMessage[], extra: Record<string, unknown>) => {
	try {
		const res = await fetch(CHAT_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: MAX_TOKENS, ...extra }),
		});
		const json = (await res.json()) as { choices?: ModelEvalChatChoice[]; error?: unknown };
		if (json.error) {
			return null;
		}
		return json.choices?.[0] ?? null;
	} catch {
		return null;
	}
};

async function main(): Promise<void> {
	const result = await runModelEval({ modelId: MODEL, repeats: REPEATS, passBar: PASS_BAR, maxTokens: MAX_TOKENS }, { chat });
	console.log(`eval-harness: model=${MODEL} strategy=${result.strategy} bar=${PASS_BAR} repeats=${REPEATS}`);
	for (const cell of result.cells) {
		const label = REPEATS > 1 ? `${cell.id}#${cell.attempt}` : cell.id;
		console.log(
			cell.score === null
				? `  [${cell.role}/${cell.difficulty}] ${label} ms=${cell.latencyMs} → NO ANSWER`
				: `  [${cell.role}/${cell.difficulty}] ${label} ms=${cell.latencyMs} → ${cell.score.toFixed(3)}`,
		);
	}
	for (const cell of result.stability) {
		console.log(
			`  stability[${cell.role}/${cell.difficulty}]: ${cell.verdict} (confidence=${cell.confidence.toFixed(2)}, spread=${cell.qualitySpread.toFixed(2)}, owed=${cell.runsOwed})`,
		);
	}
	for (const [role, rec] of Object.entries(result.fitnessByRole)) {
		console.log(
			`  fitness[${role}]: quality=${rec.qualityScore.toFixed(3)} reliability=${rec.reliability.toFixed(3)} maxDiff=${rec.maxDifficultyCleared.toFixed(2)} avgMs=${Math.round(rec.avgLatencyMs)} n=${rec.samples}`,
		);
	}
	if (PERSIST) {
		// Persist each SCORED cell into the shared §5.AB fitness store (best-effort; never throws into the harness).
		for (const cell of result.cells) {
			if (cell.score === null) {
				continue;
			}
			await recordTaskFitnessOutcome(
				{ modelKey: MODEL, role: cell.role, difficultyTier: evalDifficultyToFitnessTier(cell.difficulty) },
				{ success: cell.score >= PASS_BAR, wallTimeMs: cell.latencyMs, failureMode: cell.score >= PASS_BAR ? undefined : "eval_below_bar" },
				{ now: Date.now() },
			).catch(() => undefined);
		}
	}
	if (result.scoredAttempts === 0) {
		console.log("result: FAIL (no scorable cells)");
		process.exit(1);
	}
	console.log(`result: mean=${result.meanScore.toFixed(3)} over ${result.scoredAttempts} cells (bar ${PASS_BAR})`);
	process.exit(result.meanScore >= PASS_BAR ? 0 : 3);
}

void main();
