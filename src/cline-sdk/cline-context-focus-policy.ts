import type { ClineSdkPersistedMessage, ClineSdkStartSessionInput } from "./sdk-runtime-boundary";

type ClineSdkContentBlock = Exclude<ClineSdkPersistedMessage["content"], string>[number];
type ClineSdkToolUseBlock = Extract<ClineSdkContentBlock, { type: "tool_use" }>;
type ClineSdkToolResultBlock = Extract<ClineSdkContentBlock, { type: "tool_result" }>;
type ClineSdkContextCompactionConfig = NonNullable<ClineSdkStartSessionInput["config"]["compaction"]>;
type ClineSdkContextCompactionContext = Parameters<NonNullable<ClineSdkContextCompactionConfig["compact"]>>[0];
type ClineSdkContextCompactionResult = ReturnType<NonNullable<ClineSdkContextCompactionConfig["compact"]>>;

const COMPACTED_TOOL_RESULT_PREVIEW_CHARS = 240;
const COMPACTED_MESSAGE_PREVIEW_CHARS = 480;

interface ToolResultReference {
	messageIndex: number;
	blockIndex: number;
	toolUseId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	block: ClineSdkToolResultBlock;
}

function normalizeToolName(name: string): string {
	return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isReadFilesToolName(name: string): boolean {
	return normalizeToolName(name) === "readfiles";
}

function toContentBlocks(message: ClineSdkPersistedMessage): ClineSdkContentBlock[] | null {
	return typeof message.content === "string" ? null : message.content;
}

function stringifyToolResultContent(content: ClineSdkToolResultBlock["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			if (block.type === "file") {
				return `Attached file: ${block.path}`;
			}
			if (block.type === "image") {
				return `Attached image: ${block.mediaType}`;
			}
			return "";
		})
		.join("\n");
}

function summarizeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null || value === undefined) {
		return "";
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function summarizeReadFileInput(input: Record<string, unknown>): string {
	const appendRequest = (request: unknown, summaries: string[]): void => {
		if (typeof request === "string") {
			const trimmed = request.trim();
			if (trimmed) {
				summaries.push(trimmed);
			}
			return;
		}
		if (!request || typeof request !== "object") {
			return;
		}
		const record = request as Record<string, unknown>;
		const path = typeof record.path === "string" ? record.path.trim() : "";
		if (!path) {
			return;
		}
		const start = summarizeValue(record.start_line).trim();
		const end = summarizeValue(record.end_line).trim();
		summaries.push(start || end ? `${path}:${start || "?"}-${end || "?"}` : path);
	};

	const summaries: string[] = [];
	for (const key of ["files", "file_paths", "paths"] as const) {
		const value = input[key];
		if (Array.isArray(value)) {
			for (const item of value) {
				appendRequest(item, summaries);
			}
		} else {
			appendRequest(value, summaries);
		}
	}
	appendRequest(input, summaries);

	const uniqueSummaries = Array.from(new Set(summaries));
	if (uniqueSummaries.length > 0) {
		return uniqueSummaries.join(", ");
	}
	return summarizeValue(input);
}

function summarizeText(text: string, maxChars: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "empty";
	}
	return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}...`;
}

function collectToolResults(messages: readonly ClineSdkPersistedMessage[]): ToolResultReference[] {
	const toolUseById = new Map<string, ClineSdkToolUseBlock>();
	const results: ToolResultReference[] = [];

	messages.forEach((message, messageIndex) => {
		const blocks = toContentBlocks(message);
		if (!blocks) {
			return;
		}
		blocks.forEach((block, blockIndex) => {
			if (block.type === "tool_use") {
				toolUseById.set(block.id, block);
				if (block.call_id) {
					toolUseById.set(block.call_id, block);
				}
				return;
			}
			if (block.type !== "tool_result") {
				return;
			}
			const toolUse = toolUseById.get(block.tool_use_id);
			if (!toolUse) {
				return;
			}
			results.push({
				messageIndex,
				blockIndex,
				toolUseId: block.tool_use_id,
				toolName: toolUse.name,
				toolInput: toolUse.input,
				block,
			});
		});
	});

	return results;
}

function cloneMessages(messages: readonly ClineSdkPersistedMessage[]): ClineSdkPersistedMessage[] {
	return messages.map((message) => ({
		...message,
		content: typeof message.content === "string" ? message.content : message.content.map((block) => ({ ...block })),
	}));
}

function replaceToolResultContent(
	messages: ClineSdkPersistedMessage[],
	reference: ToolResultReference,
	content: string,
): void {
	const message = messages[reference.messageIndex];
	const blocks = message ? toContentBlocks(message) : null;
	if (!blocks) {
		return;
	}
	const block = blocks[reference.blockIndex];
	if (block?.type !== "tool_result") {
		return;
	}
	blocks[reference.blockIndex] = {
		...block,
		content,
	};
}

function buildReadFilesSummary(reference: ToolResultReference): string {
	const originalText = stringifyToolResultContent(reference.block.content);
	return [
		"[Kanban context focus: previous read_files result compacted before the next model request.]",
		`Tool input: ${summarizeReadFileInput(reference.toolInput)}`,
		`Original result size: ${originalText.length.toLocaleString()} characters.`,
		"Full source text is omitted from active context; use the coverage ledger and re-read explicit ranges if verbatim text is needed.",
	].join("\n");
}

function buildGenericToolResultSummary(reference: ToolResultReference): string {
	const originalText = stringifyToolResultContent(reference.block.content);
	return [
		`[Kanban context focus: older ${reference.toolName} result compacted before the next model request.]`,
		`Tool input: ${summarizeValue(reference.toolInput)}`,
		`Original result size: ${originalText.length.toLocaleString()} characters.`,
		`Preview: ${summarizeText(originalText, COMPACTED_TOOL_RESULT_PREVIEW_CHARS)}`,
	].join("\n");
}

function estimateMessageTokens(message: ClineSdkPersistedMessage): number {
	const contentText =
		typeof message.content === "string"
			? message.content
			: message.content
					.map((block) => {
						if (block.type === "text") {
							return block.text;
						}
						if (block.type === "tool_use") {
							return `${block.name} ${summarizeValue(block.input)}`;
						}
						if (block.type === "tool_result") {
							return stringifyToolResultContent(block.content);
						}
						if (block.type === "thinking") {
							return block.thinking;
						}
						if (block.type === "file") {
							return block.content;
						}
						return "";
					})
					.join("\n");
	return Math.max(1, Math.ceil(contentText.length / 4));
}

function estimateMessagesTokens(messages: readonly ClineSdkPersistedMessage[]): number {
	return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function compactOlderTextMessages(
	messages: ClineSdkPersistedMessage[],
	targetTokens: number,
	preserveMessageIndexes: ReadonlySet<number>,
): void {
	for (let index = 1; index < messages.length - 1 && estimateMessagesTokens(messages) > targetTokens; index += 1) {
		if (preserveMessageIndexes.has(index)) {
			continue;
		}
		const message = messages[index];
		if (!message || typeof message.content !== "string") {
			continue;
		}
		if (message.content.length <= COMPACTED_MESSAGE_PREVIEW_CHARS) {
			continue;
		}
		messages[index] = {
			...message,
			content: `[Kanban context focus: older text message compacted.] ${summarizeText(
				message.content,
				COMPACTED_MESSAGE_PREVIEW_CHARS,
			)}`,
		};
	}
}

export function compactKanbanFocusedMessages(
	context: ClineSdkContextCompactionContext,
): ClineSdkContextCompactionResult {
	const toolResults = collectToolResults(context.messages);
	const readFileResults = toolResults.filter(
		(result) => isReadFilesToolName(result.toolName) && result.block.is_error !== true,
	);
	const latestReadFileResult = readFileResults[readFileResults.length - 1] ?? null;
	const targetTokens = Math.max(1, Math.min(context.triggerTokens, context.contextWindowTokens));
	const messages = cloneMessages(context.messages);
	let changed = false;

	for (const result of readFileResults) {
		if (latestReadFileResult && result.toolUseId === latestReadFileResult.toolUseId) {
			continue;
		}
		replaceToolResultContent(messages, result, buildReadFilesSummary(result));
		changed = true;
	}

	if (estimateMessagesTokens(messages) > targetTokens) {
		for (const result of toolResults) {
			if (latestReadFileResult && result.toolUseId === latestReadFileResult.toolUseId) {
				continue;
			}
			if (isReadFilesToolName(result.toolName) && result.block.is_error !== true) {
				continue;
			}
			replaceToolResultContent(messages, result, buildGenericToolResultSummary(result));
			changed = true;
			if (estimateMessagesTokens(messages) <= targetTokens) {
				break;
			}
		}
	}

	if (estimateMessagesTokens(messages) > targetTokens) {
		compactOlderTextMessages(
			messages,
			targetTokens,
			new Set(latestReadFileResult ? [latestReadFileResult.messageIndex] : []),
		);
		changed = true;
	}

	return changed ? { messages } : undefined;
}
