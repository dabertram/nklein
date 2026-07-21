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
import {
	buildContextIntegrityCases,
	buildContextIntegrityPrompts,
	orderContextIntegrityPrompts,
	scoreContextIntegrityAnswer,
	summarizeContextIntegrityExperiment,
	type ContextIntegrityObservation,
} from "../src/core/context-integrity-experiment.js";
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
const TEMPERATURE = Number(process.env.NKLEIN_EVAL_TEMPERATURE ?? "0");
const TOP_P = process.env.NKLEIN_EVAL_TOP_P ? Number(process.env.NKLEIN_EVAL_TOP_P) : undefined;
const TOP_K = process.env.NKLEIN_EVAL_TOP_K ? Number(process.env.NKLEIN_EVAL_TOP_K) : undefined;
const PROMPT_IDS = (process.env.NKLEIN_EVAL_PROMPT_IDS ?? "")
	.split(",")
	.map((value) => value.trim())
	.filter(Boolean);
const EXPERIMENT = process.env.NKLEIN_EVAL_EXPERIMENT?.trim() ?? "";
let terminalBackendError = false;

if (!MODEL) {
	console.error("eval-harness: NKLEIN_VERIFY_MODEL is required");
	process.exit(64);
}
if (!Number.isFinite(TEMPERATURE) || TEMPERATURE < 0) {
	console.error("eval-harness: NKLEIN_EVAL_TEMPERATURE must be a non-negative number");
	process.exit(64);
}
if (TOP_P !== undefined && (!Number.isFinite(TOP_P) || TOP_P <= 0 || TOP_P > 1)) {
	console.error("eval-harness: NKLEIN_EVAL_TOP_P must be in (0, 1]");
	process.exit(64);
}
if (TOP_K !== undefined && (!Number.isSafeInteger(TOP_K) || TOP_K < 1)) {
	console.error("eval-harness: NKLEIN_EVAL_TOP_K must be a positive integer");
	process.exit(64);
}

interface CompletionResult {
	readonly choice: ModelEvalChatChoice;
	readonly promptTokens: number | null;
}

async function requestCompletion(
	messages: ModelEvalChatMessage[],
	extra: Record<string, unknown>,
): Promise<CompletionResult | null> {
	if (terminalBackendError) {
		return null;
	}
	const promptLabel = messages.at(-1)?.content.replace(/\s+/gu, " ").slice(0, 100) ?? "unknown prompt";
	try {
		const res = await fetch(CHAT_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: MODEL,
				messages,
				temperature: TEMPERATURE,
				max_tokens: MAX_TOKENS,
				...(TOP_P === undefined ? {} : { top_p: TOP_P }),
				...(TOP_K === undefined ? {} : { top_k: TOP_K }),
				...extra,
			}),
		});
		const body = await res.text();
		let json: { choices?: ModelEvalChatChoice[]; error?: unknown; usage?: { prompt_tokens?: number } };
		try {
			json = JSON.parse(body) as typeof json;
		} catch {
			console.error(`eval-harness: non-JSON response HTTP ${res.status} for ${promptLabel}: ${body.slice(0, 500)}`);
			return null;
		}
		if (!res.ok || json.error) {
			const diagnostic = JSON.stringify(json.error ?? json);
			terminalBackendError = /fatal exception in the backend generation thread|model has crashed|model_not_found/iu.test(
				diagnostic,
			);
			console.error(
				`eval-harness: backend error HTTP ${res.status} for ${promptLabel}: ${diagnostic.slice(0, 5_000)}`,
			);
			return null;
		}
		const choice = json.choices?.[0];
		if (!choice) {
			console.error(`eval-harness: HTTP ${res.status} returned no choice for ${promptLabel}: ${body.slice(0, 500)}`);
			return null;
		}
		if (
			!choice.message?.content?.trim() &&
			!choice.message?.reasoning_content?.trim() &&
			(choice.message?.tool_calls?.length ?? 0) === 0
		) {
			console.error(`eval-harness: empty choice for ${promptLabel}: ${JSON.stringify(choice).slice(0, 500)}`);
		}
		return {
			choice,
			promptTokens: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : null,
		};
	} catch (error) {
		console.error(`eval-harness: transport failure for ${promptLabel}: ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

const chat: ModelEvalChat = async (messages: ModelEvalChatMessage[], extra: Record<string, unknown>) => {
	return (await requestCompletion(messages, extra))?.choice ?? null;
};

async function runContextIntegrity(): Promise<void> {
	const cases = new Map(buildContextIntegrityCases().map((case_) => [case_.id, case_]));
	const requestedArms = new Set(
		(process.env.NKLEIN_CONTEXT_INTEGRITY_ARMS ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	const allPrompts = orderContextIntegrityPrompts(buildContextIntegrityPrompts());
	const knownArms = new Set(allPrompts.map((prompt) => prompt.arm));
	for (const arm of requestedArms) {
		if (!knownArms.has(arm as ContextIntegrityObservation["arm"])) {
			throw new Error(`unknown context-integrity arm ${arm}`);
		}
	}
	const prompts = requestedArms.size === 0 ? allPrompts : allPrompts.filter((prompt) => requestedArms.has(prompt.arm));
	const resumePath = process.env.NKLEIN_EVAL_RESUME_PATH?.trim();
	const checkpointPath = process.env.NKLEIN_EVAL_CHECKPOINT_PATH?.trim();
	const observations: ContextIntegrityObservation[] = [];
	if (resumePath) {
		const prior = await readFile(resumePath, "utf8");
		if (resumePath.endsWith(".json")) {
			const parsed = JSON.parse(prior) as { observations?: ContextIntegrityObservation[] };
			observations.push(...(parsed.observations ?? []));
		} else {
			const pattern = /^\s*\[\d+\/\d+\]\s+(\S+)\/(\S+)\s+score=([\d.]+)\s+prompt=(\d+|\?)\s+ms=(\d+)(?:\s+infra=(\S+))?/u;
			for (const line of prior.split("\n")) {
				const match = pattern.exec(line);
				if (!match) continue;
				observations.push({
					caseId: match[1] as string,
					arm: match[2] as ContextIntegrityObservation["arm"],
					score: Number(match[3]),
					promptTokens: match[4] === "?" ? null : Number(match[4]),
					latencyMs: Number(match[5]),
					infraError: match[6] ?? null,
				});
			}
		}
		console.log(`eval-harness: resumed ${observations.length} context-integrity observation(s) from ${resumePath}`);
	}
	const completed = new Set(observations.map((row) => `${row.caseId}\0${row.arm}`));
	for (const [index, prompt] of prompts.entries()) {
		if (completed.has(`${prompt.caseId}\0${prompt.arm}`)) continue;
		const case_ = cases.get(prompt.caseId);
		if (!case_) throw new Error(`missing context-integrity case ${prompt.caseId}`);
		const startedAt = Date.now();
		const result = await requestCompletion(
			[
				{ role: "system", content: "Answer only the final question from the supplied transcript. Be exact and concise." },
				{ role: "user", content: prompt.content },
			],
			{ temperature: 0, max_tokens: 128 },
		);
		const latencyMs = Date.now() - startedAt;
		const answer = result?.choice.message?.content ?? result?.choice.message?.reasoning_content ?? "";
		const observation: ContextIntegrityObservation = {
			caseId: prompt.caseId,
			arm: prompt.arm,
			score: result ? scoreContextIntegrityAnswer(case_, answer) : 0,
			latencyMs,
			promptTokens: result?.promptTokens ?? null,
			infraError: result ? null : "completion_failed",
		};
		observations.push(observation);
		completed.add(`${prompt.caseId}\0${prompt.arm}`);
		if (checkpointPath) {
			await writeFile(checkpointPath, `${JSON.stringify({ experiment: "context-integrity", model: MODEL, observations }, null, 2)}\n`, "utf8");
		}
		console.log(
			`  [${index + 1}/${prompts.length}] ${prompt.caseId}/${prompt.arm} score=${observation.score.toFixed(3)} prompt=${observation.promptTokens ?? "?"} ms=${latencyMs}${observation.infraError ? ` infra=${observation.infraError}` : ""}`,
		);
	}
	const summary = summarizeContextIntegrityExperiment(observations);
	console.log(JSON.stringify({ experiment: "context-integrity", model: MODEL, summary, observations }, null, 2));
	console.log(
		`result: context-integrity tasks=${summary.taskCount} observations=${summary.observationCount} infra=${summary.infraErrorRate.toFixed(3)} threshold=${summary.measuredCompactionThreshold ?? "unresolved"} format=${summary.formatWinner ?? "unresolved"}`,
	);
	process.exit(summary.infraErrorRate === 0 && summary.preRegistration.verdict === "adequately_powered" ? 0 : 1);
}

async function main(): Promise<void> {
	if (EXPERIMENT === "context-integrity") {
		await runContextIntegrity();
		return;
	}
	if (EXPERIMENT) {
		console.error(`eval-harness: unknown NKLEIN_EVAL_EXPERIMENT ${EXPERIMENT}`);
		process.exit(64);
	}
	const result = await runModelEval(
		{
			modelId: MODEL,
			repeats: REPEATS,
			passBar: PASS_BAR,
			maxTokens: MAX_TOKENS,
			promptIds: PROMPT_IDS.length > 0 ? PROMPT_IDS : undefined,
		},
		{ chat },
	);
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
import { readFile, writeFile } from "node:fs/promises";
