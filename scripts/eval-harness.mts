/**
 * §5.AB eval harness (todo 5913) — run the eval-prompt corpus (decompose + review families) through ONE model and score
 * each cell with the deterministic scorers. Designed to be driven by `verify-all-models.mts` across the roster (reads
 * `NKLEIN_VERIFY_MODEL` / `NKLEIN_VERIFY_BASE_URL`), so per-model fitness accrues from one command.
 *
 * This is the effectful GLUE over the pure, unit-tested cores — it invents no scoring logic of its own:
 *   - `eval-prompt-corpus.ts`        — the prompts + answer keys + `scoreEvalAnswer`.
 *   - `eval-answer-extraction.ts`    — raw model text → structured answer (decompose graph, review caught-ids).
 *   - `structured-output-strategy.ts`— the per-model structured mechanism (the live-validated core lesson):
 *       reasoning models → native tool_call (they over-reason and never land JSON in prose; tool_choice:required
 *       forces the structured answer), coder/instruct → content-channel JSON. It also reads `content || reasoning_content`
 *       because reasoning/mtp models emit to the reasoning channel and leave `content` empty (all live-found this session).
 *
 * `implement` cells are skipped: scoring them needs executing the model's code against acceptance tests in a sandbox,
 * which is out of scope for this content-only harness.
 *
 * Exit code: 0 = mean score ≥ PASS_BAR, 3 = graded PARTIAL (ran but below bar), 1 = nothing scorable (all cells failed to
 * produce an answer) — matching the PASS/PARTIAL/FAIL convention `verify-all-models.mts` reads.
 */

import {
	type EvalPrompt,
	EVAL_PROMPT_CORPUS,
	type ReviewEvalPrompt,
	scoreEvalAnswer,
} from "../src/core/eval-prompt-corpus.js";
import { extractDecomposeEvalAnswer, extractReviewEvalAnswer } from "../src/core/eval-answer-extraction.js";
import { type EvalCellOutcome, foldEvalOutcomes } from "../src/core/eval-fitness-fold.js";
import type { FitnessDifficultyTier } from "../src/core/fitness-table-schema.js";
import type { ModelFitnessRecord } from "../src/core/model-fitness.js";
import { selectStructuredOutputStrategy } from "../src/core/structured-output-strategy.js";
import { recordTaskFitnessOutcome } from "../src/telemetry/fitness-table-store.js";

/** Map the corpus difficulty tier to a 0..1 number for the fitness fold. */
const DIFFICULTY_NUM: Readonly<Record<string, number>> = { easy: 0.33, medium: 0.66, hard: 1 };
/**
 * Opt-in: persist each cell into the shared `fitness-table.json` (the §5.AB store `recordTaskFitnessOutcome` writes) so
 * routing consumes measured eval fitness across runs. OFF by default because `verify-all-models.mts` runs harnesses under
 * an ISOLATED temp HOME — persisting there would write to a throwaway store. Set NKLEIN_EVAL_PERSIST=1 for a standalone
 * run against the real runtime home.
 */
const PERSIST = process.env.NKLEIN_EVAL_PERSIST === "1";

const MODEL = process.env.NKLEIN_VERIFY_MODEL ?? "";
// Convention (matches verify-all-models.mts + the other harnesses): NKLEIN_VERIFY_BASE_URL is `/v1`-suffixed. Normalize
// so we always end at exactly one `/v1` regardless of whether the caller included it — the endpoint is `<base>/chat/
// completions`. (Bug caught 2026-07-08 by running THROUGH the orchestrator: it passes `http://127.0.0.1:1234/v1`, so
// appending `/v1/chat/completions` produced a double `/v1` → 404 → "no scorable cells"; standalone hid it via a bare base.)
const RAW_BASE = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1").trim().replace(/\/+$/, "");
const CHAT_URL = `${RAW_BASE.endsWith("/v1") ? RAW_BASE : `${RAW_BASE}/v1`}/chat/completions`;
const MAX_TOKENS = Number(process.env.NKLEIN_EVAL_MAX_TOKENS ?? "2500");
const PASS_BAR = Number(process.env.NKLEIN_EVAL_PASS_BAR ?? "0.6");

if (!MODEL) {
	console.error("eval-harness: NKLEIN_VERIFY_MODEL is required");
	process.exit(64);
}

interface ChatMessage {
	role: "system" | "user";
	content: string;
}

interface ChatChoice {
	message?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> };
	finish_reason?: string;
}

async function chat(messages: ChatMessage[], extra: Record<string, unknown>): Promise<ChatChoice | null> {
	try {
		const res = await fetch(CHAT_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: MAX_TOKENS, ...extra }),
		});
		const json = (await res.json()) as { choices?: ChatChoice[]; error?: unknown };
		if (json.error) {
			return null;
		}
		return json.choices?.[0] ?? null;
	} catch {
		return null;
	}
}

/** Reasoning/mtp models emit to reasoning_content and leave content empty (live-found); fall back to it. */
function readText(choice: ChatChoice | null): string {
	const m = choice?.message;
	if (m?.content && m.content.trim().length > 0) {
		return m.content;
	}
	return m?.reasoning_content ?? "";
}

const DECOMPOSE_TOOL = {
	type: "function",
	function: {
		name: "submit_decomposition",
		description: "Submit the decomposition as a DAG of subtasks with dependencies.",
		parameters: {
			type: "object",
			properties: {
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							dependsOn: { type: "array", items: { type: "string" } },
						},
						required: ["id", "title"],
					},
				},
			},
			required: ["tasks"],
		},
	},
};

async function scoreDecompose(prompt: EvalPrompt): Promise<number | null> {
	const strategy = selectStructuredOutputStrategy(MODEL).strategy;
	const sys = 'Decompose the task into 3-6 subtasks with dependencies. Output ONLY JSON: {"tasks":[{"id":string,"title":string,"dependsOn":[id]}]}.';
	const messages: ChatMessage[] = [
		{ role: "system", content: sys },
		{ role: "user", content: prompt.prompt },
	];
	// Reasoning models over-reason and don't reliably land JSON in prose → prefer forcing the tool call (§5.AN).
	if (strategy === "native_tool_call") {
		// Live-found (r1-8b, 2026-07-08): even under tool_choice:"required", r1 is UNRELIABLE at emitting the forced call
		// for the non-trivial decompose schema — it often returns finish=stop with NO tool_call and the reasoning in
		// reasoning_content (flaky: ~2/3 one run, 0/3 the next). So: try the tool-call args FIRST, then fall back to
		// extracting the decomposition from content||reasoning_content. A larger budget gives room for both the reasoning
		// preamble and the call. (This is NOT a token-limit issue — the fast no-call runs prove that — it's flaky emission.)
		const choice = await chat(
			[
				{ role: "system", content: "Decompose via the tool." },
				{ role: "user", content: prompt.prompt },
			],
			{ tools: [DECOMPOSE_TOOL], tool_choice: "required", max_tokens: Math.max(MAX_TOKENS, 4000) },
		);
		const args = choice?.message?.tool_calls?.[0]?.function?.arguments ?? "";
		const answer = extractDecomposeEvalAnswer(args) ?? extractDecomposeEvalAnswer(readText(choice));
		return answer ? scoreEvalAnswer(prompt, answer) : null;
	}
	const answer = extractDecomposeEvalAnswer(readText(await chat(messages, {})));
	return answer ? scoreEvalAnswer(prompt, answer) : null;
}

async function scoreReview(prompt: ReviewEvalPrompt): Promise<number | null> {
	const choice = await chat(
		[{ role: "user", content: `${prompt.prompt}\n\n\`\`\`js\n${prompt.code}\n\`\`\`` }],
		{},
	);
	const text = readText(choice);
	if (text.trim().length === 0) {
		return null;
	}
	return scoreEvalAnswer(prompt, extractReviewEvalAnswer(text, prompt.seededDefects));
}

async function main(): Promise<void> {
	console.log(`eval-harness: model=${MODEL} strategy=${selectStructuredOutputStrategy(MODEL).strategy} bar=${PASS_BAR}`);
	const scores: number[] = [];
	const outcomesByRole = new Map<string, EvalCellOutcome[]>();
	for (const prompt of EVAL_PROMPT_CORPUS) {
		if (prompt.family === "implement") {
			continue; // needs sandbox execution — out of scope for this content-only harness
		}
		const start = Date.now();
		const score = prompt.family === "decompose" ? await scoreDecompose(prompt) : await scoreReview(prompt);
		const ms = Date.now() - start;
		if (score === null) {
			console.log(`  [${prompt.family}/${prompt.difficulty}] ${prompt.id} ms=${ms} → NO ANSWER`);
			continue;
		}
		scores.push(score);
		const outcome: EvalCellOutcome = {
			modelId: MODEL,
			role: prompt.role,
			difficulty: DIFFICULTY_NUM[prompt.difficulty] ?? 0.66,
			score,
			latencyMs: ms,
			passed: score >= PASS_BAR,
		};
		const list = outcomesByRole.get(prompt.role) ?? [];
		list.push(outcome);
		outcomesByRole.set(prompt.role, list);
		if (PERSIST) {
			// Persist into the shared §5.AB fitness store (best-effort; never throws into the harness).
			await recordTaskFitnessOutcome(
				{ modelKey: MODEL, role: prompt.role, difficultyTier: prompt.difficulty as FitnessDifficultyTier },
				{ success: outcome.passed, wallTimeMs: ms, failureMode: outcome.passed ? undefined : "eval_below_bar" },
				{ now: Date.now() },
			);
		}
		console.log(`  [${prompt.family}/${prompt.difficulty}] ${prompt.id} ms=${ms} → ${score.toFixed(3)}`);
	}
	if (scores.length === 0) {
		console.log("result: FAIL (no scorable cells)");
		process.exit(1);
	}
	// Fold the cells into a per-role §5.AB fitness record (the eval→fitness pipeline; a sweep persists these to the store).
	for (const [role, outcomes] of outcomesByRole) {
		const rec = foldEvalOutcomes(null, outcomes) as ModelFitnessRecord;
		console.log(
			`  fitness[${role}]: quality=${rec.qualityScore.toFixed(3)} reliability=${rec.reliability.toFixed(3)} maxDiff=${rec.maxDifficultyCleared.toFixed(2)} avgMs=${Math.round(rec.avgLatencyMs)} n=${rec.samples}`,
		);
	}
	const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
	console.log(`result: mean=${mean.toFixed(3)} over ${scores.length} cells (bar ${PASS_BAR})`);
	process.exit(mean >= PASS_BAR ? 0 : 3);
}

void main();
