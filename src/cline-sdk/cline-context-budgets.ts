import { ALL_SPECIAL_TOKENS, countTokens } from "gpt-tokenizer";

const DEFAULT_FILE_CHUNK_TOKEN_BUDGET = 12_000;
const READ_FILES_TOOL_RESULT_OVERHEAD_TOKENS = 1_000;
const OUTPUT_RESERVE_RATIO = 0.1;
const PROMPT_OVERHEAD_RESERVE_RATIO = 0.15;
const FILE_CHUNK_SAFE_WORKING_BUDGET_RATIO = 0.6;
const FILE_CHUNK_CONTEXT_WINDOW_RATIO = 0.5;
const MAX_FILE_CHUNK_TOKEN_BUDGET = 64_000;

export interface KanbanContextSafetyBudgets {
	contextWindow: number | null;
	outputReserveTokens: number;
	promptOverheadReserveTokens: number;
	safeWorkingBudget: number | null;
	fileChunkTokenBudget: number;
	fileChunkContentTokenBudget: number;
	fileChunkCharBudget: number;
}

export interface KanbanContextPressurePolicy {
	contextWindow: number | null;
	wallTimeMsPer1kPromptTokens: number | null;
	repoMapTokenBudget: number;
	retrievalResultTokenBudget: number;
	compactionTriggerRatio: number;
	pressure: "low" | "medium" | "high";
}

export interface BuildKanbanContextPressurePolicyOptions {
	contextWindow?: number | null;
	wallTimeMsPer1kPromptTokens?: number | null;
}

export function countKanbanTextTokens(text: string): number {
	return countTokens(text, { allowedSpecial: ALL_SPECIAL_TOKENS });
}

function normalizePositiveNumber(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildKanbanContextSafetyBudgets(contextWindowInput?: number | null): KanbanContextSafetyBudgets {
	const contextWindow =
		typeof contextWindowInput === "number" && Number.isFinite(contextWindowInput) && contextWindowInput > 0
			? Math.trunc(contextWindowInput)
			: null;
	const outputReserveTokens = contextWindow
		? Math.max(4_000, Math.min(16_000, Math.round(contextWindow * OUTPUT_RESERVE_RATIO)))
		: 8_000;
	const promptOverheadReserveTokens = contextWindow
		? Math.max(8_000, Math.min(24_000, Math.round(contextWindow * PROMPT_OVERHEAD_RESERVE_RATIO)))
		: 12_000;
	const safeWorkingBudget = contextWindow
		? Math.max(0, contextWindow - outputReserveTokens - promptOverheadReserveTokens)
		: null;
	const fileChunkTokenBudget =
		contextWindow && safeWorkingBudget !== null
			? Math.max(
					4_000,
					Math.min(
						MAX_FILE_CHUNK_TOKEN_BUDGET,
						Math.round(contextWindow * FILE_CHUNK_CONTEXT_WINDOW_RATIO),
						Math.round(safeWorkingBudget * FILE_CHUNK_SAFE_WORKING_BUDGET_RATIO),
					),
				)
			: DEFAULT_FILE_CHUNK_TOKEN_BUDGET;
	return {
		contextWindow,
		outputReserveTokens,
		promptOverheadReserveTokens,
		safeWorkingBudget,
		fileChunkTokenBudget,
		fileChunkContentTokenBudget: Math.max(1_000, fileChunkTokenBudget - READ_FILES_TOOL_RESULT_OVERHEAD_TOKENS),
		fileChunkCharBudget: fileChunkTokenBudget * 4,
	};
}

export function buildKanbanContextPressurePolicy(
	options: BuildKanbanContextPressurePolicyOptions = {},
): KanbanContextPressurePolicy {
	const contextWindow = normalizePositiveNumber(options.contextWindow);
	const wallTimeMsPer1kPromptTokens = normalizePositiveNumber(options.wallTimeMsPer1kPromptTokens);
	const windowPressure = contextWindow ? Math.max(0, Math.min(1, (24_000 - contextWindow) / 16_000)) : 0.35;
	const speedPressure = wallTimeMsPer1kPromptTokens
		? Math.max(0, Math.min(1, (wallTimeMsPer1kPromptTokens - 750) / 2_500))
		: 0;
	const pressureScore = Math.max(windowPressure, speedPressure);
	const pressure = pressureScore >= 0.66 ? "high" : pressureScore >= 0.33 ? "medium" : "low";
	const repoMapBaseBudget = contextWindow ? Math.round(contextWindow * 0.015) : 800;
	const repoMapTokenBudget = Math.max(
		250,
		Math.min(1_500, Math.round(repoMapBaseBudget * (1 - pressureScore * 0.45))),
	);
	const retrievalResultTokenBudget = Math.max(
		600,
		Math.min(4_000, Math.round((contextWindow ? contextWindow * 0.04 : 2_000) * (1 - pressureScore * 0.35))),
	);
	const compactionTriggerRatio = Math.max(0.55, Math.min(0.82, 0.78 - pressureScore * 0.18));
	return {
		contextWindow: contextWindow ? Math.trunc(contextWindow) : null,
		wallTimeMsPer1kPromptTokens,
		repoMapTokenBudget,
		retrievalResultTokenBudget,
		compactionTriggerRatio,
		pressure,
	};
}
