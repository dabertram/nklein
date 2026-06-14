import { countKanbanTextTokens } from "./cline-context-budgets";
import type { ClineSdkPersistedMessage, ClineSdkStartSessionInput } from "./sdk-runtime-boundary";

type ClineSdkContentBlock = Exclude<ClineSdkPersistedMessage["content"], string>[number];
type ClineSdkToolUseBlock = Extract<ClineSdkContentBlock, { type: "tool_use" }>;
type ClineSdkToolResultBlock = Extract<ClineSdkContentBlock, { type: "tool_result" }>;
type ClineSdkContextCompactionConfig = NonNullable<ClineSdkStartSessionInput["config"]["compaction"]>;
type ClineSdkContextCompactionContext = Parameters<NonNullable<ClineSdkContextCompactionConfig["compact"]>>[0];
type ClineSdkContextCompactionResult = ReturnType<NonNullable<ClineSdkContextCompactionConfig["compact"]>>;

const COMPACTED_TOOL_RESULT_PREVIEW_CHARS = 240;
const COMPACTED_MESSAGE_PREVIEW_CHARS = 480;
const MAX_FOCUS_BRIEF_PATHS = 24;
const MAX_FOCUS_BRIEF_READS = 32;
const FOCUS_BRIEF_START = "[Kanban context focus brief]";
const FOCUS_BRIEF_END = "[/Kanban context focus brief]";
const FOCUS_BRIEF_PATTERN = /\[Kanban context focus brief\][\s\S]*?\[\/Kanban context focus brief\]\n*/g;

interface ToolResultReference {
	messageIndex: number;
	blockIndex: number;
	toolUseId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	block: ClineSdkToolResultBlock;
}

interface ReadFilesLedgerEntry {
	toolUseId: string;
	inputSummary: string;
	originalChars: number;
	latest: boolean;
	omitted: boolean;
}

interface FailedReadFilesEntry {
	inputSummary: string;
	errorPreview: string;
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

function addUniqueValue(values: string[], value: string): void {
	const normalized = value.trim();
	if (!normalized || values.includes(normalized)) {
		return;
	}
	values.push(normalized);
}

function extractObservedPathsFromText(text: string): string[] {
	const paths: string[] = [];
	const textWithoutFocusBrief = stripFocusBrief(text);
	const pathPattern = /(?:~|\/)[^\s"'`<>]+\.(?:txt|md|json|jsonl|yaml|yml|csv|ts|tsx|js|jsx|py|sh|log)/g;
	for (const match of textWithoutFocusBrief.matchAll(pathPattern)) {
		const path = match[0]?.replace(/[),.;:]+$/, "") ?? "";
		if (path.includes("*")) {
			continue;
		}
		addUniqueValue(paths, path);
	}
	return paths;
}

function extractMissingFilePathsFromText(text: string): string[] {
	if (!/\bENOENT\b|no such file or directory|cannot find|not found/i.test(text)) {
		return [];
	}
	return extractObservedPathsFromText(text);
}

function stripFocusBrief(text: string): string {
	return text.replace(FOCUS_BRIEF_PATTERN, "").trimStart();
}

function collectObservedPaths(messages: readonly ClineSdkPersistedMessage[]): string[] {
	const paths: string[] = [];
	for (const message of messages) {
		if (message.role === "assistant") {
			continue;
		}
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.map((block) => {
							if (block.type === "text") {
								return block.text;
							}
							if (block.type === "tool_use") {
								return summarizeValue(block.input);
							}
							if (block.type === "tool_result") {
								return stringifyToolResultContent(block.content);
							}
							if (block.type === "file") {
								return block.path;
							}
							return "";
						})
						.join("\n");
		for (const path of extractObservedPathsFromText(text)) {
			addUniqueValue(paths, path);
			if (paths.length >= MAX_FOCUS_BRIEF_PATHS) {
				return paths;
			}
		}
	}
	return paths;
}

function collectMissingFilePaths(messages: readonly ClineSdkPersistedMessage[]): string[] {
	const paths: string[] = [];
	for (const message of messages) {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.map((block) => {
							if (block.type === "text") {
								return block.text;
							}
							if (block.type === "tool_result") {
								return stringifyToolResultContent(block.content);
							}
							return "";
						})
						.join("\n");
		for (const path of extractMissingFilePathsFromText(text)) {
			addUniqueValue(paths, path);
		}
	}
	return paths;
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

function buildFailedReadFilesSummary(reference: ToolResultReference): string {
	const originalText = stringifyToolResultContent(reference.block.content);
	return [
		"[Kanban context focus: failed read_files result compacted before the next model request.]",
		`Invalid or unreadable input: ${summarizeReadFileInput(reference.toolInput)}`,
		`Error preview: ${summarizeText(originalText, COMPACTED_TOOL_RESULT_PREVIEW_CHARS)}`,
		"Do not retry this path unless a directory listing confirms it exists.",
	].join("\n");
}

function isMissingFileReadError(reference: ToolResultReference): boolean {
	if (reference.block.is_error !== true) {
		return false;
	}
	const errorText = stringifyToolResultContent(reference.block.content);
	return /\bENOENT\b|no such file or directory|cannot find|not found/i.test(errorText);
}

function buildReadFilesLedgerEntry(
	reference: ToolResultReference,
	latestReadToolUseId: string | null,
): ReadFilesLedgerEntry {
	const originalText = stringifyToolResultContent(reference.block.content);
	const latest = latestReadToolUseId === reference.toolUseId;
	return {
		toolUseId: reference.toolUseId,
		inputSummary: summarizeReadFileInput(reference.toolInput),
		originalChars: originalText.length,
		latest,
		omitted: true,
	};
}

function buildFocusBrief(input: {
	observedPaths: readonly string[];
	readFilesLedger: readonly ReadFilesLedgerEntry[];
	failedReadFiles: readonly FailedReadFilesEntry[];
}): string | null {
	const lines: string[] = [FOCUS_BRIEF_START];
	if (input.observedPaths.length > 0) {
		lines.push("Known existing paths observed in this session:");
		for (const path of input.observedPaths.slice(0, MAX_FOCUS_BRIEF_PATHS)) {
			lines.push(`- ${path}`);
		}
	}
	if (input.readFilesLedger.length > 0) {
		lines.push("read_files coverage ledger:");
		for (const entry of input.readFilesLedger.slice(-MAX_FOCUS_BRIEF_READS)) {
			const state = entry.latest ? "latest raw result omitted" : "older raw result omitted";
			lines.push(`- ${entry.inputSummary} (${state}; original ${entry.originalChars.toLocaleString()} chars)`);
		}
		const coverage = buildReadCoverageByPath(input.readFilesLedger);
		if (coverage.length > 0) {
			lines.push("Per-file read coverage — resume from the next unread line; do NOT restart from line 1:");
			for (const entry of coverage) {
				lines.push(`- ${entry.path}: covered through line ${entry.maxEnd}; next unread line ${entry.maxEnd + 1}`);
			}
		}
	}
	if (input.failedReadFiles.length > 0) {
		lines.push("Invalid or missing read_files paths seen this session; do not retry unless re-listed:");
		for (const entry of input.failedReadFiles.slice(-MAX_FOCUS_BRIEF_READS)) {
			lines.push(`- ${entry.inputSummary} (${entry.errorPreview})`);
		}
	}
	if (lines.length === 1) {
		return null;
	}
	lines.push(
		"Use only the known paths above or re-list the directory before reading another file; do not invent replacement filenames.",
		"Older file chunk bodies were summarized out of request context to save space; rely on your own running notes for their content.",
		"Do not restart a file from line 1 or re-read already-covered ranges. Continue from the next unread line above; only read small stitching windows around prior chunk boundaries when continuity is unclear, then summarize from your notes.",
		FOCUS_BRIEF_END,
	);
	return lines.join("\n");
}

function splitReadInputSummary(summary: string): string[] {
	return summary
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

function parseReadCoveragePart(part: string): { path: string; end: number } | null {
	const colonIndex = part.lastIndexOf(":");
	if (colonIndex <= 0) {
		return null;
	}
	const path = part.slice(0, colonIndex).trim();
	const range = part.slice(colonIndex + 1).trim();
	const match = /^[\d?]*-(\d+)$/.exec(range);
	if (!path || !match?.[1]) {
		return null;
	}
	const end = Number.parseInt(match[1], 10);
	return Number.isFinite(end) ? { path, end } : null;
}

function buildReadCoverageByPath(ledger: readonly ReadFilesLedgerEntry[]): { path: string; maxEnd: number }[] {
	const maxEndByPath = new Map<string, number>();
	for (const entry of ledger) {
		for (const part of splitReadInputSummary(entry.inputSummary)) {
			const parsed = parseReadCoveragePart(part);
			if (!parsed) {
				continue;
			}
			const current = maxEndByPath.get(parsed.path);
			if (current === undefined || parsed.end > current) {
				maxEndByPath.set(parsed.path, parsed.end);
			}
		}
	}
	return [...maxEndByPath.entries()].map(([path, maxEnd]) => ({ path, maxEnd }));
}

function basename(path: string): string {
	const normalized = path.split(/[?#]/)[0] ?? path;
	return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function filterInvalidObservedPaths(paths: readonly string[], invalidReadInputs: readonly string[]): string[] {
	return paths.filter((path) => {
		const pathBaseName = basename(path);
		return !invalidReadInputs.some((invalidInput) => {
			const invalidPath = invalidInput.split(":")[0]?.trim() ?? invalidInput;
			return path === invalidPath || path.endsWith(`/${invalidPath}`) || pathBaseName === basename(invalidPath);
		});
	});
}

function prependFocusBriefToFirstUserMessage(messages: ClineSdkPersistedMessage[], focusBrief: string): boolean {
	const firstUserIndex = messages.findIndex((message) => message.role === "user");
	if (firstUserIndex < 0) {
		return false;
	}
	const message = messages[firstUserIndex];
	if (!message) {
		return false;
	}
	if (typeof message.content === "string") {
		messages[firstUserIndex] = {
			...message,
			content: `${focusBrief}\n\n${stripFocusBrief(message.content)}`,
		};
		return true;
	}
	const contentWithoutExistingBrief = message.content
		.map((block) => (block.type === "text" ? { ...block, text: stripFocusBrief(block.text) } : block))
		.filter((block) => block.type !== "text" || block.text.trim().length > 0);
	messages[firstUserIndex] = {
		...message,
		content: [{ type: "text", text: focusBrief }, ...contentWithoutExistingBrief],
	};
	return true;
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
	return Math.max(1, countKanbanTextTokens(contentText));
}

export function countKanbanPersistedMessagesTokens(messages: readonly ClineSdkPersistedMessage[]): number {
	return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function compactOlderTextMessages(
	messages: ClineSdkPersistedMessage[],
	targetTokens: number,
	preserveMessageIndexes: ReadonlySet<number>,
	changed: { value: boolean },
): void {
	for (
		let index = 1;
		index < messages.length - 1 && countKanbanPersistedMessagesTokens(messages) > targetTokens;
		index += 1
	) {
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
		changed.value = true;
	}
}

export function compactKanbanMessagesForContextTarget(
	messagesInput: readonly ClineSdkPersistedMessage[],
	targetTokens: number,
): ClineSdkPersistedMessage[] | null {
	const toolResults = collectToolResults(messagesInput);
	const readFileToolResults = toolResults.filter((result) => isReadFilesToolName(result.toolName));
	const readFileResults = readFileToolResults.filter(
		(result) => isReadFilesToolName(result.toolName) && result.block.is_error !== true,
	);
	const failedReadFileResults = readFileToolResults.filter(isMissingFileReadError);
	const latestReadFileResult = readFileResults[readFileResults.length - 1] ?? null;
	const latestReadToolUseId = latestReadFileResult?.toolUseId ?? null;
	const normalizedTargetTokens = Math.max(1, Math.trunc(targetTokens));
	const messages = cloneMessages(messagesInput);
	const changed = { value: false };
	const invalidReadInputs = failedReadFileResults.flatMap((result) =>
		splitReadInputSummary(summarizeReadFileInput(result.toolInput)),
	);
	const invalidPathsFromErrors = collectMissingFilePaths(messagesInput);
	const focusBrief = buildFocusBrief({
		observedPaths: filterInvalidObservedPaths(collectObservedPaths(messagesInput), [
			...invalidReadInputs,
			...invalidPathsFromErrors,
		]),
		readFilesLedger: readFileResults.map((result) => buildReadFilesLedgerEntry(result, latestReadToolUseId)),
		failedReadFiles: [
			...failedReadFileResults.map((result) => ({
				inputSummary: summarizeReadFileInput(result.toolInput),
				errorPreview: summarizeText(
					stringifyToolResultContent(result.block.content),
					COMPACTED_TOOL_RESULT_PREVIEW_CHARS,
				),
			})),
			...invalidPathsFromErrors.map((path) => ({
				inputSummary: path,
				errorPreview: "missing file error observed in transcript",
			})),
		],
	});
	if (focusBrief && prependFocusBriefToFirstUserMessage(messages, focusBrief)) {
		changed.value = true;
	}

	for (const result of readFileResults) {
		replaceToolResultContent(messages, result, buildReadFilesSummary(result));
		changed.value = true;
	}

	for (const result of failedReadFileResults) {
		replaceToolResultContent(messages, result, buildFailedReadFilesSummary(result));
		changed.value = true;
	}

	if (countKanbanPersistedMessagesTokens(messages) > normalizedTargetTokens) {
		for (const result of toolResults) {
			if (isReadFilesToolName(result.toolName) && result.block.is_error !== true) {
				continue;
			}
			replaceToolResultContent(messages, result, buildGenericToolResultSummary(result));
			changed.value = true;
			if (countKanbanPersistedMessagesTokens(messages) <= normalizedTargetTokens) {
				break;
			}
		}
	}

	if (countKanbanPersistedMessagesTokens(messages) > normalizedTargetTokens) {
		compactOlderTextMessages(messages, normalizedTargetTokens, new Set(), changed);
	}

	return changed.value ? messages : null;
}

export function compactKanbanFocusedMessages(
	context: ClineSdkContextCompactionContext,
): ClineSdkContextCompactionResult {
	const targetTokens = Math.max(1, Math.min(context.triggerTokens, context.contextWindowTokens));
	const messages = compactKanbanMessagesForContextTarget(context.messages, targetTokens);
	return messages ? { messages } : undefined;
}
