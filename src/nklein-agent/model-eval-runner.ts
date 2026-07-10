/**
 * §5.AB eval executor — the effectful GLUE over the pure eval cores, extracted from `scripts/eval-harness.mts`
 * so BOTH the CLI sweep AND the in-runtime "Evaluate connected models" trigger (todo 6544) share one code path
 * (no drift between the two). It invents no scoring logic: the corpus + answer keys + `scoreEvalAnswer` live in
 * `eval-prompt-corpus.ts`, extraction in `eval-answer-extraction.ts`, aggregation/stability/fold in the `model-eval-*`
 * cores. The one dependency it takes is a `chat` function — the HTTP call to the model under test — so it is unit-
 * testable with a stub and reusable against ANY OpenAI-compatible endpoint (a real model, or the LLM simulator).
 *
 * The model-specific structured-output choice is the live-validated lesson (§5.AN): reasoning models over-reason
 * and never land JSON in prose, so decompose prefers a forced tool_call for them; coder/instruct read the content
 * channel. Both read `content || reasoning_content` because reasoning/mtp models emit to the reasoning channel.
 */

import { extractDecomposeEvalAnswer, extractReviewEvalAnswer } from "../core/eval-answer-extraction.js";
import { type EvalCellOutcome, foldEvalOutcomes } from "../core/eval-fitness-fold.js";
import {
	EVAL_PROMPT_CORPUS,
	type EvalPrompt,
	type ReviewEvalPrompt,
	scoreEvalAnswer,
} from "../core/eval-prompt-corpus.js";
import type { FitnessDifficultyTier } from "../core/fitness-table-schema.js";
import type { ModelEvalRun } from "../core/model-eval-aggregation.js";
import { type EvalCellStability, scoreModelEvalStability } from "../core/model-eval-stability.js";
import type { ModelFitnessRecord } from "../core/model-fitness.js";
import { selectStructuredOutputStrategy } from "../core/structured-output-strategy.js";

/** Map the corpus difficulty tier to a 0..1 number for the fitness fold (mirrors the CLI harness). */
const DIFFICULTY_NUM: Readonly<Record<string, number>> = { easy: 0.33, medium: 0.66, hard: 1 };

export interface ModelEvalChatMessage {
	role: "system" | "user";
	content: string;
}

export interface ModelEvalChatChoice {
	message?: {
		content?: string;
		reasoning_content?: string;
		tool_calls?: Array<{ function?: { arguments?: string } }>;
	};
	finish_reason?: string;
}

/** The single injected effect: one chat-completions round-trip. Returns null on any transport/decode failure. */
export type ModelEvalChat = (
	messages: ModelEvalChatMessage[],
	extra: Record<string, unknown>,
) => Promise<ModelEvalChatChoice | null>;

export interface ModelEvalConfig {
	modelId: string;
	/** Repeats per cell (todo 5914). ≥ minSettledRuns(4) to allow a cell to leave the `thin` verdict. */
	repeats?: number;
	/** Pass threshold on the 0..1 cell score. */
	passBar?: number;
	/** Token budget per completion. */
	maxTokens?: number;
}

export interface ModelEvalCellScore {
	id: string;
	role: string;
	difficulty: string;
	/** null ⇒ the model produced no scorable answer this attempt. */
	score: number | null;
	latencyMs: number;
	attempt: number;
}

export interface ModelEvalResult {
	modelId: string;
	strategy: string;
	/** Mean over all SCORED attempts (no-answer attempts excluded from the mean but counted as failed runs). */
	meanScore: number;
	scoredAttempts: number;
	totalAttempts: number;
	cells: ModelEvalCellScore[];
	stability: EvalCellStability[];
	fitnessByRole: Record<string, ModelFitnessRecord>;
	runs: ModelEvalRun[];
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

/** Reasoning/mtp models emit to reasoning_content and leave content empty (live-found); fall back to it. */
function readText(choice: ModelEvalChatChoice | null): string {
	const message = choice?.message;
	if (message?.content && message.content.trim().length > 0) {
		return message.content;
	}
	return message?.reasoning_content ?? "";
}

async function scoreDecompose(
	prompt: EvalPrompt,
	modelId: string,
	maxTokens: number,
	chat: ModelEvalChat,
): Promise<number | null> {
	const strategy = selectStructuredOutputStrategy(modelId).strategy;
	const systemPrompt =
		'Decompose the task into 3-6 subtasks with dependencies. Output ONLY JSON: {"tasks":[{"id":string,"title":string,"dependsOn":[id]}]}.';
	if (strategy === "native_tool_call") {
		// Reasoning models are flaky at emitting the forced call for a non-trivial schema (r1-8b live-found): try the
		// tool-call args first, then fall back to extracting from content||reasoning_content, with a larger budget.
		const choice = await chat(
			[
				{ role: "system", content: "Decompose via the tool." },
				{ role: "user", content: prompt.prompt },
			],
			{ tools: [DECOMPOSE_TOOL], tool_choice: "required", max_tokens: Math.max(maxTokens, 4000) },
		);
		const args = choice?.message?.tool_calls?.[0]?.function?.arguments ?? "";
		const answer = extractDecomposeEvalAnswer(args) ?? extractDecomposeEvalAnswer(readText(choice));
		return answer ? scoreEvalAnswer(prompt, answer) : null;
	}
	const choice = await chat(
		[
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt.prompt },
		],
		{ max_tokens: maxTokens },
	);
	const answer = extractDecomposeEvalAnswer(readText(choice));
	return answer ? scoreEvalAnswer(prompt, answer) : null;
}

async function scoreReview(prompt: ReviewEvalPrompt, maxTokens: number, chat: ModelEvalChat): Promise<number | null> {
	const choice = await chat([{ role: "user", content: `${prompt.prompt}\n\n\`\`\`js\n${prompt.code}\n\`\`\`` }], {
		max_tokens: maxTokens,
	});
	const text = readText(choice);
	if (text.trim().length === 0) {
		return null;
	}
	return scoreEvalAnswer(prompt, extractReviewEvalAnswer(text, prompt.seededDefects));
}

/**
 * Run the full eval corpus against one model, N repeats per cell, and fold the results into stability judgments +
 * per-role fitness records. Pure over the injected `chat` + a `now()` clock. `implement` cells are skipped (their
 * scoring needs sandboxed code execution — out of scope for this content-only evaluator).
 */
export async function runModelEval(
	config: ModelEvalConfig,
	deps: { chat: ModelEvalChat; now?: () => number },
): Promise<ModelEvalResult> {
	const repeats = Math.max(1, Math.trunc(config.repeats ?? 1) || 1);
	const passBar = config.passBar ?? 0.6;
	const maxTokens = config.maxTokens ?? 2500;
	const now = deps.now ?? Date.now;
	const strategy = selectStructuredOutputStrategy(config.modelId).strategy;

	const cells: ModelEvalCellScore[] = [];
	const runs: ModelEvalRun[] = [];
	const outcomesByRole = new Map<string, EvalCellOutcome[]>();
	let scoreSum = 0;
	let scoredAttempts = 0;
	let totalAttempts = 0;

	for (const prompt of EVAL_PROMPT_CORPUS) {
		if (prompt.family === "implement") {
			continue;
		}
		for (let attempt = 1; attempt <= repeats; attempt += 1) {
			const start = now();
			const score =
				prompt.family === "decompose"
					? await scoreDecompose(prompt, config.modelId, maxTokens, deps.chat)
					: await scoreReview(prompt as ReviewEvalPrompt, maxTokens, deps.chat);
			const latencyMs = Math.max(0, now() - start);
			totalAttempts += 1;
			const effectiveScore = score ?? 0;
			const passed = score !== null && score >= passBar;
			runs.push({
				modelId: config.modelId,
				role: prompt.role,
				difficulty: prompt.difficulty,
				passed,
				qualityScore: effectiveScore,
				latencyMs,
				retries: 0,
			});
			cells.push({ id: prompt.id, role: prompt.role, difficulty: prompt.difficulty, score, latencyMs, attempt });
			if (score === null) {
				continue;
			}
			scoreSum += score;
			scoredAttempts += 1;
			const list = outcomesByRole.get(prompt.role) ?? [];
			list.push({
				modelId: config.modelId,
				role: prompt.role,
				difficulty: DIFFICULTY_NUM[prompt.difficulty] ?? 0.66,
				score,
				latencyMs,
				passed,
			});
			outcomesByRole.set(prompt.role, list);
		}
	}

	const stability = repeats > 1 ? scoreModelEvalStability(runs) : [];
	const fitnessByRole: Record<string, ModelFitnessRecord> = {};
	for (const [role, outcomes] of outcomesByRole) {
		fitnessByRole[role] = foldEvalOutcomes(null, outcomes) as ModelFitnessRecord;
	}

	return {
		modelId: config.modelId,
		strategy,
		meanScore: scoredAttempts > 0 ? scoreSum / scoredAttempts : 0,
		scoredAttempts,
		totalAttempts,
		cells,
		stability,
		fitnessByRole,
		runs,
	};
}

/** The difficulty tiers a fitness-store persist needs (identity map — the corpus tiers already match the store). */
export function evalDifficultyToFitnessTier(tier: string): FitnessDifficultyTier {
	return (tier === "easy" || tier === "medium" || tier === "hard" ? tier : "medium") as FitnessDifficultyTier;
}
