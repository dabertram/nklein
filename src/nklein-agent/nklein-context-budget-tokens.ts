/**
 * Context-budget TOKEN ESTIMATION helpers (extracted from `nklein-task-session-service.ts` — §5.U monolith decomposition).
 *
 * Pure + deterministic: classify a persisted-message history into user / included-file-content / other token segments
 * ({@link classifyContextHistoryTokens}), and estimate the kanban tool-schema token cost
 * ({@link estimateKanbanToolSchemaTokens}). A behavior-preserving extraction — the cohesive cluster (plus its private
 * content-block helpers + the `Sdk*Block` aliases that only it used) now lives in one small module instead of bloating the
 * task-session service. Consumed by the service's context-budget path; the full suite gates byte-for-byte behavior.
 */
import { countKanbanTextTokens } from "./nklein-context-budgets";
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
