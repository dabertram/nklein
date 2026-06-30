/**
 * Context-budget TOKEN ESTIMATION helpers (extracted from `nklein-task-session-service.ts` — §5.U monolith decomposition).
 *
 * Pure + deterministic: classify a persisted-message history into user / included-file-content / other token segments
 * ({@link classifyContextHistoryTokens}), and estimate the kanban tool-schema token cost
 * ({@link estimateKanbanToolSchemaTokens}). A behavior-preserving extraction — the cohesive cluster (plus its private
 * content-block helpers + the `Sdk*Block` aliases that only it used) now lives in one small module instead of bloating the
 * task-session service. Consumed by the service's context-budget path; the full suite gates byte-for-byte behavior.
 */
import type { RuntimeContextBudgetBreakdown, RuntimeTaskImage } from "../core/api-contract";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import { countKanbanPersistedMessagesTokens } from "./nklein-context-focus-policy";
import type { NKleinSdkPersistedMessage, NKleinSdkStartSessionInput } from "./sdk-runtime-boundary.js";

type NKleinSdkContentBlock = Exclude<NKleinSdkPersistedMessage["content"], string>[number];
type NKleinSdkToolResultBlock = Extract<NKleinSdkContentBlock, { type: "tool_result" }>;

/** History tokens split into the user-message, included-file-content, and everything-else segments. */
export interface ContextHistoryTokenSegments {
	userMessageTokens: number;
	includedFileContentTokens: number;
	otherHistoryTokens: number;
}

function toPersistedContentBlocks(message: NKleinSdkPersistedMessage): NKleinSdkContentBlock[] {
	return typeof message.content === "string" ? [] : message.content;
}

function stringifyToolResultContent(content: NKleinSdkToolResultBlock["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") {
					return item;
				}
				if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
					return item.text;
				}
				return JSON.stringify(item);
			})
			.join("\n");
	}
	return JSON.stringify(content);
}

function countContextBudgetTextTokens(text: string): number {
	return text.length > 0 ? countKanbanTextTokens(text) : 0;
}

function isFileReadToolName(toolName: string | undefined): boolean {
	return toolName === "read_files" || toolName === "read_large_file";
}

export function classifyContextHistoryTokens(
	messages: readonly NKleinSdkPersistedMessage[],
): ContextHistoryTokenSegments {
	const totalHistoryTokens = countKanbanPersistedMessagesTokens(messages);
	const toolNameByUseId = new Map<string, string>();
	let userMessageTokens = 0;
	let includedFileContentTokens = 0;

	for (const message of messages) {
		if (typeof message.content === "string") {
			if (message.role === "user") {
				userMessageTokens += countContextBudgetTextTokens(message.content);
			}
			continue;
		}
		for (const block of toPersistedContentBlocks(message)) {
			if (block.type === "tool_use") {
				toolNameByUseId.set(block.id, block.name);
				if (block.call_id) {
					toolNameByUseId.set(block.call_id, block.name);
				}
				continue;
			}
			if (block.type === "tool_result") {
				const toolName = toolNameByUseId.get(block.tool_use_id);
				if (isFileReadToolName(toolName)) {
					includedFileContentTokens += countContextBudgetTextTokens(stringifyToolResultContent(block.content));
				}
				continue;
			}
			if (message.role === "user" && block.type === "text") {
				userMessageTokens += countContextBudgetTextTokens(block.text);
			}
		}
	}

	return {
		userMessageTokens,
		includedFileContentTokens,
		otherHistoryTokens: Math.max(0, totalHistoryTokens - userMessageTokens - includedFileContentTokens),
	};
}

export function estimateKanbanToolSchemaTokens(toolPolicies?: NKleinSdkStartSessionInput["toolPolicies"]): number {
	if (!toolPolicies) {
		return 0;
	}
	const enabledToolNames = Object.entries(toolPolicies)
		.filter(([, policy]) => policy?.enabled !== false)
		.map(([toolName]) => toolName)
		.sort();
	if (enabledToolNames.length === 0) {
		return 0;
	}
	return countKanbanTextTokens(
		JSON.stringify({
			nativeSdkToolsEnabled: true,
			kanbanToolPolicies: enabledToolNames,
		}),
	);
}

const CONTEXT_BUDGET_IMAGE_OVERHEAD_TOKENS = 1_200;
const CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS = 1_200;

/** Estimate the tokens the NEXT user turn adds: the prompt text + a flat per-image overhead, floored at the prompt reserve. */
export function estimateNextPromptTokens(prompt: string, images?: RuntimeTaskImage[]): number {
	const promptTokens = countKanbanTextTokens(prompt.trim());
	const imageTokens = (images?.length ?? 0) * CONTEXT_BUDGET_IMAGE_OVERHEAD_TOKENS;
	return Math.max(
		CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS,
		promptTokens + imageTokens + CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS,
	);
}

/**
 * Build the full context-budget breakdown for a task turn: system-prompt + tool-schema + next-prompt + classified history
 * tokens, plus the overhead/output reserves, against the model's context window. Pure (the service passes the window).
 */
export function buildContextBudgetBreakdown(input: {
	systemPrompt?: string | null;
	toolSchemaTokens?: number | null;
	messages?: NKleinSdkPersistedMessage[] | null;
	prompt: string;
	images?: RuntimeTaskImage[];
	contextWindow: number;
}): RuntimeContextBudgetBreakdown {
	const budgets = buildKanbanContextSafetyBudgets(input.contextWindow);
	const messages = input.messages ?? [];
	const systemPromptTokens = input.systemPrompt ? countKanbanTextTokens(input.systemPrompt) : 0;
	const toolSchemaTokens =
		typeof input.toolSchemaTokens === "number" && Number.isFinite(input.toolSchemaTokens)
			? Math.max(0, Math.trunc(input.toolSchemaTokens))
			: 0;
	const taskPromptTokens = estimateNextPromptTokens(input.prompt, input.images);
	const historySegments = classifyContextHistoryTokens(messages);
	const projectedTokens =
		systemPromptTokens +
		toolSchemaTokens +
		taskPromptTokens +
		historySegments.userMessageTokens +
		historySegments.includedFileContentTokens +
		historySegments.otherHistoryTokens +
		budgets.promptOverheadReserveTokens +
		budgets.outputReserveTokens;
	const usedWorkingTokens = Math.max(0, projectedTokens - budgets.outputReserveTokens);
	return {
		systemPromptTokens,
		toolSchemaTokens,
		taskPromptTokens,
		userMessageTokens: historySegments.userMessageTokens,
		includedFileContentTokens: historySegments.includedFileContentTokens,
		otherHistoryTokens: historySegments.otherHistoryTokens,
		reservedPromptOverheadTokens: budgets.promptOverheadReserveTokens,
		reservedOutputTokens: budgets.outputReserveTokens,
		usedWorkingTokens,
		freeWorkingTokens: Math.max(0, input.contextWindow - projectedTokens),
		effectiveContextWindow: input.contextWindow,
		projectedTokens,
	};
}
