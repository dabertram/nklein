import { countTokens } from "gpt-tokenizer";

const DEFAULT_FILE_CHUNK_TOKEN_BUDGET = 12_000;
const READ_FILES_TOOL_RESULT_OVERHEAD_TOKENS = 1_000;
const OUTPUT_RESERVE_RATIO = 0.1;
const PROMPT_OVERHEAD_RESERVE_RATIO = 0.15;
const MIN_OUTPUT_RESERVE_TOKENS = 512;
const MIN_PROMPT_OVERHEAD_RESERVE_TOKENS = 1_024;
// Reserve caps keep very large local windows from hoarding context that should remain useful working room.
const MAX_OUTPUT_RESERVE_TOKENS = 16_000;
const MAX_PROMPT_OVERHEAD_RESERVE_TOKENS = 24_000;
const UNKNOWN_WINDOW_OUTPUT_RESERVE_TOKENS = 8_000;
const UNKNOWN_WINDOW_PROMPT_OVERHEAD_RESERVE_TOKENS = 12_000;
const MIN_FILE_CHUNK_TOKEN_BUDGET = 512;
const MIN_FILE_CHUNK_CONTENT_TOKEN_BUDGET = 1_000;
const TOKEN_TO_CHAR_BUDGET_MULTIPLIER = 4;
const FILE_CHUNK_SAFE_WORKING_BUDGET_RATIO = 0.6;
const FILE_CHUNK_CONTEXT_WINDOW_RATIO = 0.5;
const MAX_FILE_CHUNK_TOKEN_BUDGET = 64_000;
// Pressure rises as windows shrink below 24k or local prefill slows beyond 750ms per 1k prompt tokens.
const PRESSURE_REFERENCE_CONTEXT_WINDOW_TOKENS = 24_000;
const PRESSURE_CONTEXT_WINDOW_RANGE_TOKENS = 16_000;
const DEFAULT_UNKNOWN_WINDOW_PRESSURE = 0.35;
const PRESSURE_REFERENCE_WALL_TIME_MS_PER_1K_PROMPT_TOKENS = 750;
const PRESSURE_WALL_TIME_RANGE_MS_PER_1K_PROMPT_TOKENS = 2_500;
const REPO_MAP_CONTEXT_WINDOW_RATIO = 0.015;
const RETRIEVAL_CONTEXT_WINDOW_RATIO = 0.04;
const DEFAULT_REPO_MAP_TOKEN_BUDGET = 800;
const DEFAULT_RETRIEVAL_RESULT_TOKEN_BUDGET = 2_000;
const REPO_MAP_PRESSURE_REDUCTION_RATIO = 0.45;
const RETRIEVAL_PRESSURE_REDUCTION_RATIO = 0.35;
const COMPACTION_TRIGGER_BASE_RATIO = 0.78;
const COMPACTION_TRIGGER_PRESSURE_REDUCTION_RATIO = 0.18;
const MIN_COMPACTION_TRIGGER_RATIO = 0.55;
const MAX_COMPACTION_TRIGGER_RATIO = 0.82;

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

/**
 * An empty disallowed set means `countTokens` treats any special-token strings (e.g. `<|endoftext|>`) in arbitrary
 * file/chat content as ORDINARY text and never throws on them (the default encode throws — that's why this option
 * exists). NOTE: the option is NOT the cost driver; content is.
 */
const EMPTY_DISALLOWED_SPECIAL: Set<string> = new Set<string>();

/**
 * `countKanbanTextTokens` is the ONE tokenizer behind every budget/size check (`get_file_size`, chat context, repo-map,
 * retrieval), so its worst case is a runtime-wide throughput floor. BPE has a pathological case: a long run of a single
 * repeated character/token (whitespace blocks, `====` rules, base64/minified blobs, lockfiles, generated data) merges
 * ~O(n²) on first encounter — 8 KB ≈ 42 ms, 32 KB ≈ 390 ms, 120 KB ≈ ~6 s, which blocked the event loop and stalled the
 * whole runtime (the original symptom: a "cheap" file-size check taking seconds).
 *
 * Fix: tokenize in small fixed windows and sum, so any pathological run is bounded to ONE window's cost; then, past a
 * cap, extrapolate the (already-bounded) count from a prefix sample. BPE merges don't cross window boundaries, adding a
 * negligible handful of tokens — fine for a budget ESTIMATE. Normal text is unaffected (microseconds per window).
 */
const TOKENIZE_CHUNK_CHARS = 8_192;
const MAX_TOKENIZE_CHARS = 256 * 1024;

function countTokensChunked(text: string): number {
	let total = 0;
	for (let offset = 0; offset < text.length; offset += TOKENIZE_CHUNK_CHARS) {
		total += countTokens(text.slice(offset, offset + TOKENIZE_CHUNK_CHARS), {
			disallowedSpecial: EMPTY_DISALLOWED_SPECIAL,
		});
	}
	return total;
}

export function countKanbanTextTokens(text: string): number {
	if (text.length <= MAX_TOKENIZE_CHARS) {
		return countTokensChunked(text);
	}
	// Beyond the cap, the count is a budget estimate: extrapolate from the (bounded-cost) prefix by character ratio.
	const sampleTokens = countTokensChunked(text.slice(0, MAX_TOKENIZE_CHARS));
	return Math.ceil((sampleTokens / MAX_TOKENIZE_CHARS) * text.length);
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
		? Math.max(
				MIN_OUTPUT_RESERVE_TOKENS,
				Math.min(MAX_OUTPUT_RESERVE_TOKENS, Math.round(contextWindow * OUTPUT_RESERVE_RATIO)),
			)
		: UNKNOWN_WINDOW_OUTPUT_RESERVE_TOKENS;
	const promptOverheadReserveTokens = contextWindow
		? Math.max(
				MIN_PROMPT_OVERHEAD_RESERVE_TOKENS,
				Math.min(MAX_PROMPT_OVERHEAD_RESERVE_TOKENS, Math.round(contextWindow * PROMPT_OVERHEAD_RESERVE_RATIO)),
			)
		: UNKNOWN_WINDOW_PROMPT_OVERHEAD_RESERVE_TOKENS;
	const safeWorkingBudget = contextWindow
		? Math.max(0, contextWindow - outputReserveTokens - promptOverheadReserveTokens)
		: null;
	const fileChunkTokenBudget =
		contextWindow && safeWorkingBudget !== null
			? Math.max(
					MIN_FILE_CHUNK_TOKEN_BUDGET,
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
		fileChunkContentTokenBudget: Math.max(
			MIN_FILE_CHUNK_CONTENT_TOKEN_BUDGET,
			fileChunkTokenBudget - READ_FILES_TOOL_RESULT_OVERHEAD_TOKENS,
		),
		fileChunkCharBudget: fileChunkTokenBudget * TOKEN_TO_CHAR_BUDGET_MULTIPLIER,
	};
}

export function buildKanbanContextPressurePolicy(
	options: BuildKanbanContextPressurePolicyOptions = {},
): KanbanContextPressurePolicy {
	const contextWindow = normalizePositiveNumber(options.contextWindow);
	const wallTimeMsPer1kPromptTokens = normalizePositiveNumber(options.wallTimeMsPer1kPromptTokens);
	const windowPressure = contextWindow
		? Math.max(
				0,
				Math.min(
					1,
					(PRESSURE_REFERENCE_CONTEXT_WINDOW_TOKENS - contextWindow) / PRESSURE_CONTEXT_WINDOW_RANGE_TOKENS,
				),
			)
		: DEFAULT_UNKNOWN_WINDOW_PRESSURE;
	const speedPressure = wallTimeMsPer1kPromptTokens
		? Math.max(
				0,
				Math.min(
					1,
					(wallTimeMsPer1kPromptTokens - PRESSURE_REFERENCE_WALL_TIME_MS_PER_1K_PROMPT_TOKENS) /
						PRESSURE_WALL_TIME_RANGE_MS_PER_1K_PROMPT_TOKENS,
				),
			)
		: 0;
	const pressureScore = Math.max(windowPressure, speedPressure);
	const pressure = pressureScore >= 0.66 ? "high" : pressureScore >= 0.33 ? "medium" : "low";
	const repoMapBaseBudget = contextWindow
		? Math.round(contextWindow * REPO_MAP_CONTEXT_WINDOW_RATIO)
		: DEFAULT_REPO_MAP_TOKEN_BUDGET;
	const repoMapTokenBudget = Math.max(
		250,
		Math.min(1_500, Math.round(repoMapBaseBudget * (1 - pressureScore * REPO_MAP_PRESSURE_REDUCTION_RATIO))),
	);
	const retrievalResultTokenBudget = Math.max(
		600,
		Math.min(
			4_000,
			Math.round(
				(contextWindow ? contextWindow * RETRIEVAL_CONTEXT_WINDOW_RATIO : DEFAULT_RETRIEVAL_RESULT_TOKEN_BUDGET) *
					(1 - pressureScore * RETRIEVAL_PRESSURE_REDUCTION_RATIO),
			),
		),
	);
	const compactionTriggerRatio = Math.max(
		MIN_COMPACTION_TRIGGER_RATIO,
		Math.min(
			MAX_COMPACTION_TRIGGER_RATIO,
			COMPACTION_TRIGGER_BASE_RATIO - pressureScore * COMPACTION_TRIGGER_PRESSURE_REDUCTION_RATIO,
		),
	);
	return {
		contextWindow: contextWindow ? Math.trunc(contextWindow) : null,
		wallTimeMsPer1kPromptTokens,
		repoMapTokenBudget,
		retrievalResultTokenBudget,
		compactionTriggerRatio,
		pressure,
	};
}
