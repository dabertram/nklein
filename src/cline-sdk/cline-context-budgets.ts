import { ALL_SPECIAL_TOKENS, countTokens } from "gpt-tokenizer";

const DEFAULT_FILE_CHUNK_TOKEN_BUDGET = 8_000;
const READ_FILES_TOOL_RESULT_OVERHEAD_TOKENS = 1_000;

export interface KanbanContextSafetyBudgets {
	contextWindow: number | null;
	outputReserveTokens: number;
	promptOverheadReserveTokens: number;
	safeWorkingBudget: number | null;
	fileChunkTokenBudget: number;
	fileChunkContentTokenBudget: number;
	fileChunkCharBudget: number;
}

export function countKanbanTextTokens(text: string): number {
	return countTokens(text, { allowedSpecial: ALL_SPECIAL_TOKENS });
}

export function buildKanbanContextSafetyBudgets(contextWindowInput?: number | null): KanbanContextSafetyBudgets {
	const contextWindow =
		typeof contextWindowInput === "number" && Number.isFinite(contextWindowInput) && contextWindowInput > 0
			? Math.trunc(contextWindowInput)
			: null;
	const outputReserveTokens = contextWindow ? Math.max(24_000, Math.round(contextWindow * 0.3)) : 24_000;
	const promptOverheadReserveTokens = contextWindow ? Math.max(12_000, Math.round(contextWindow * 0.15)) : 12_000;
	const safeWorkingBudget = contextWindow
		? Math.max(0, contextWindow - outputReserveTokens - promptOverheadReserveTokens)
		: null;
	const fileChunkTokenBudget = safeWorkingBudget
		? Math.max(4_000, Math.min(12_000, Math.round(safeWorkingBudget * 0.15)))
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
