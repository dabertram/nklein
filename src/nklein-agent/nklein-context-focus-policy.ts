import { summarizeReadFileInput, summarizeText, summarizeValue } from "./nklein-content-summaries";
import { countKanbanTextTokens } from "./nklein-context-budgets";
import { buildCompressedContextPreview, buildCompressedContextPreviewWithProvider } from "./nklein-context-compression";
import {
	addUniqueValue,
	extractMissingFilePathsFromText,
	extractObservedPathsFromText,
	stripFocusBrief,
} from "./nklein-observed-path-extraction";
import { buildReadCoverageByPath, splitReadInputSummary } from "./nklein-read-coverage";
import type { NKleinSdkPersistedMessage, NKleinSdkStartSessionInput } from "./sdk-runtime-boundary";

type NKleinSdkContentBlock = Exclude<NKleinSdkPersistedMessage["content"], string>[number];
type NKleinSdkToolUseBlock = Extract<NKleinSdkContentBlock, { type: "tool_use" }>;
type NKleinSdkToolResultBlock = Extract<NKleinSdkContentBlock, { type: "tool_result" }>;
type NKleinSdkContextCompactionConfig = NonNullable<NKleinSdkStartSessionInput["config"]["compaction"]>;
type NKleinSdkContextCompactionContext = Parameters<NonNullable<NKleinSdkContextCompactionConfig["compact"]>>[0];
type NKleinSdkContextCompactionResult = ReturnType<NonNullable<NKleinSdkContextCompactionConfig["compact"]>>;

const COMPACTED_TOOL_RESULT_PREVIEW_CHARS = 240;
const COMPACTED_MESSAGE_PREVIEW_CHARS = 480;
const MAX_FOCUS_BRIEF_PATHS = 24;
const MAX_FOCUS_BRIEF_READS = 32;
const FOCUS_BRIEF_START = "[!Klein context focus brief]";
const FOCUS_BRIEF_END = "[/!Klein context focus brief]";

interface ToolResultReference {
	messageIndex: number;
	blockIndex: number;
	toolUseId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	block: NKleinSdkToolResultBlock;
}

interface ReadFilesLedgerEntry {
	toolUseId: string;
	inputSummary: string;
	originalChars: number;
	latest: boolean;
}

interface FailedReadFilesEntry {
	inputSummary: string;
	errorPreview: string;
}

function normalizeToolName(name: string): string {
	return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isReadFilesToolName(name: string): boolean {
	const normalized = normalizeToolName(name);
	return normalized === "readfiles" || normalized === "readlargefile";
}

function toContentBlocks(message: NKleinSdkPersistedMessage): NKleinSdkContentBlock[] | null {
	return typeof message.content === "string" ? null : message.content;
}

function stringifyToolResultContent(content: NKleinSdkToolResultBlock["content"]): string {
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

function collectObservedPaths(messages: readonly NKleinSdkPersistedMessage[]): string[] {
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

function collectMissingFilePaths(messages: readonly NKleinSdkPersistedMessage[]): string[] {
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

function collectToolResults(messages: readonly NKleinSdkPersistedMessage[]): ToolResultReference[] {
	const toolUseById = new Map<string, NKleinSdkToolUseBlock>();
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

function cloneMessages(messages: readonly NKleinSdkPersistedMessage[]): NKleinSdkPersistedMessage[] {
	return messages.map((message) => ({
		...message,
		content: typeof message.content === "string" ? message.content : message.content.map((block) => ({ ...block })),
	}));
}

function replaceToolResultContent(
	messages: NKleinSdkPersistedMessage[],
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
		"[!Klein context focus: previous read_files result compacted before the next model request.]",
		`Tool input: ${summarizeReadFileInput(reference.toolInput)}`,
		`Original result size: ${originalText.length.toLocaleString()} characters.`,
		"Full source text is omitted from active context; use the coverage ledger and re-read explicit ranges if verbatim text is needed.",
	].join("\n");
}

function buildFailedReadFilesSummary(reference: ToolResultReference): string {
	const originalText = stringifyToolResultContent(reference.block.content);
	return [
		"[!Klein context focus: failed read_files result compacted before the next model request.]",
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
			const state = entry.latest ? "latest raw result retained for immediate analysis" : "older raw result omitted";
			lines.push(`- ${entry.inputSummary} (${state}; original ${entry.originalChars.toLocaleString()} chars)`);
		}
		const coverage = buildReadCoverageByPath(input.readFilesLedger);
		if (coverage.length > 0) {
			lines.push("Per-file read coverage — resume from the next unread line; do NOT restart from line 1:");
			for (const entry of coverage) {
				const ranges = entry.ranges.map((range) => `${range.start}-${range.end}`).join(", ");
				lines.push(`- ${entry.path}: covered ranges ${ranges}; next unread line ${entry.nextUnreadLine}`);
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

function prependFocusBriefToFirstUserMessage(messages: NKleinSdkPersistedMessage[], focusBrief: string): boolean {
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
	// When every remaining block is TEXT, emit ONE STRING instead of a parts array: the downstream prompt conversion
	// splits a multi-part user message into SEPARATE wire messages, and [system, user(brief), user(task)] hard-500s
	// on strict-alternation templates (live-found 2026-07-17: ministral-3 "conversation roles must alternate…" via
	// LM Studio engine 500, wire-captured). String content is the most compatible form; messages carrying non-text
	// blocks (images) keep the parts array unchanged.
	if (contentWithoutExistingBrief.every((block) => block.type === "text")) {
		const joinedText = contentWithoutExistingBrief
			.map((block) => (block.type === "text" ? block.text : ""))
			.filter((text) => text.trim().length > 0)
			.join("\n\n");
		messages[firstUserIndex] = {
			...message,
			content: joinedText.length > 0 ? `${focusBrief}\n\n${joinedText}` : focusBrief,
		};
		return true;
	}
	messages[firstUserIndex] = {
		...message,
		content: [{ type: "text", text: focusBrief }, ...contentWithoutExistingBrief],
	};
	return true;
}

function buildGenericToolResultSummary(reference: ToolResultReference): string {
	const originalText = stringifyToolResultContent(reference.block.content);
	return [
		`[!Klein context focus: older ${reference.toolName} result compacted before the next model request.]`,
		`Tool input: ${summarizeValue(reference.toolInput)}`,
		`Original result size: ${originalText.length.toLocaleString()} characters.`,
		`Preview: ${summarizeText(originalText, COMPACTED_TOOL_RESULT_PREVIEW_CHARS)}`,
	].join("\n");
}

function estimateMessageTokens(message: NKleinSdkPersistedMessage): number {
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

export function countKanbanPersistedMessagesTokens(messages: readonly NKleinSdkPersistedMessage[]): number {
	return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

/**
 * F4.46 pinned-facts RETENTION contract: a message stamped `metadata.compactionPinned === true` is never
 * summarized, truncated, or dropped by any compaction stage — the caller pins evidence/citation messages whose
 * exact bytes (e.g. `file:line` provenance) must survive summarization. The emergency rebuild carries pinned
 * messages over verbatim as well, so the contract holds even at the last resort.
 */
export function isCompactionPinnedMessage(message: NKleinSdkPersistedMessage): boolean {
	return (message.metadata as { compactionPinned?: unknown } | undefined)?.compactionPinned === true;
}

function compactOlderTextMessages(
	messages: NKleinSdkPersistedMessage[],
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
		if (!message || isCompactionPinnedMessage(message) || typeof message.content !== "string") {
			continue;
		}
		if (message.content.length <= COMPACTED_MESSAGE_PREVIEW_CHARS) {
			continue;
		}
		messages[index] = {
			...message,
			content: buildCompressedContextPreview(message.content, 160),
		};
		changed.value = true;
	}
}

async function compactOlderTextMessagesWithProvider(
	messages: NKleinSdkPersistedMessage[],
	targetTokens: number,
	changed: { value: boolean },
): Promise<void> {
	for (
		let index = 1;
		index < messages.length - 1 && countKanbanPersistedMessagesTokens(messages) > targetTokens;
		index += 1
	) {
		const message = messages[index];
		if (
			!message ||
			isCompactionPinnedMessage(message) ||
			typeof message.content !== "string" ||
			message.content.length <= COMPACTED_MESSAGE_PREVIEW_CHARS
		) {
			continue;
		}
		try {
			messages[index] = {
				...message,
				content: await buildCompressedContextPreviewWithProvider(message.content, 160),
			};
			changed.value = true;
		} catch {
			messages[index] = {
				...message,
				content: buildCompressedContextPreview(message.content, 160),
			};
			changed.value = true;
		}
	}
}

function compactStructuredContentBlock(block: NKleinSdkContentBlock): NKleinSdkContentBlock {
	if (block.type === "text" && block.text.length > COMPACTED_MESSAGE_PREVIEW_CHARS) {
		return {
			...block,
			text: buildCompressedContextPreview(block.text, 160),
		};
	}
	if (block.type === "thinking" && block.thinking.length > COMPACTED_MESSAGE_PREVIEW_CHARS) {
		return {
			...block,
			thinking: `[!Klein context focus: older reasoning compacted.] ${summarizeText(
				block.thinking,
				COMPACTED_MESSAGE_PREVIEW_CHARS,
			)}`,
		};
	}
	if (block.type === "file" && block.content.length > COMPACTED_MESSAGE_PREVIEW_CHARS) {
		return {
			...block,
			content: `[!Klein context focus: older attached file content compacted.] ${summarizeText(
				block.content,
				COMPACTED_MESSAGE_PREVIEW_CHARS,
			)}`,
		};
	}
	if (block.type === "tool_use") {
		const inputText = summarizeValue(block.input);
		if (inputText.length > COMPACTED_MESSAGE_PREVIEW_CHARS) {
			return {
				...block,
				input: {
					summary: summarizeText(inputText, COMPACTED_MESSAGE_PREVIEW_CHARS),
				},
			};
		}
	}
	return block;
}

function compactStructuredMessages(
	messages: NKleinSdkPersistedMessage[],
	targetTokens: number,
	changed: { value: boolean },
): void {
	for (
		let index = 1;
		index < messages.length && countKanbanPersistedMessagesTokens(messages) > targetTokens;
		index += 1
	) {
		const message = messages[index];
		if (!message || isCompactionPinnedMessage(message) || typeof message.content === "string") {
			continue;
		}
		const compactedContent = message.content.map(compactStructuredContentBlock);
		if (compactedContent.some((block, blockIndex) => block !== message.content[blockIndex])) {
			messages[index] = {
				...message,
				content: compactedContent,
			};
			changed.value = true;
		}
	}
}

function buildEmergencyCompactionMessage(
	messages: readonly NKleinSdkPersistedMessage[],
	targetTokens: number,
): NKleinSdkPersistedMessage[] {
	const firstUserMessage = messages.find((message) => message.role === "user");
	const recentPreviews = messages.slice(-6).map((message) => {
		const preview =
			typeof message.content === "string"
				? message.content
				: message.content
						.map((block) => {
							if (block.type === "text") {
								return block.text;
							}
							if (block.type === "thinking") {
								return block.thinking;
							}
							if (block.type === "file") {
								return `Attached file: ${block.path}`;
							}
							if (block.type === "tool_use") {
								return `Tool ${block.name}: ${summarizeValue(block.input)}`;
							}
							if (block.type === "tool_result") {
								return stringifyToolResultContent(block.content);
							}
							return "";
						})
						.join("\n");
		return `${message.role}: ${summarizeText(preview, COMPACTED_MESSAGE_PREVIEW_CHARS)}`;
	});
	const firstUserPreview = firstUserMessage
		? summarizeText(
				typeof firstUserMessage.content === "string"
					? firstUserMessage.content
					: firstUserMessage.content
							.map((block) => (block.type === "text" ? block.text : ""))
							.filter(Boolean)
							.join("\n"),
				COMPACTED_MESSAGE_PREVIEW_CHARS,
			)
		: "unavailable";
	let summary = [
		"[!Klein context focus: earlier conversation history was compacted to prevent context overflow.]",
		`Initial user request preview: ${firstUserPreview}`,
		"Recent transcript previews:",
		...recentPreviews,
	].join("\n");
	while (countKanbanTextTokens(summary) > targetTokens && summary.length > 1) {
		summary = summary.slice(0, Math.max(1, Math.floor(summary.length * 0.75)));
	}
	const baseMessage = firstUserMessage ?? messages[0];
	// F4.46 retention contract: pinned evidence messages ride through even the emergency rebuild verbatim.
	const pinned = messages.filter((message) => isCompactionPinnedMessage(message));
	return [
		{
			...(baseMessage ?? {}),
			role: "user",
			content: summary,
		},
		...pinned,
	];
}

export function compactKanbanMessagesForContextTarget(
	messagesInput: readonly NKleinSdkPersistedMessage[],
	targetTokens: number,
): NKleinSdkPersistedMessage[] | null {
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
		if (result.toolUseId === latestReadToolUseId) {
			continue;
		}
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
	if (countKanbanPersistedMessagesTokens(messages) > normalizedTargetTokens) {
		compactStructuredMessages(messages, normalizedTargetTokens, changed);
	}
	if (countKanbanPersistedMessagesTokens(messages) > normalizedTargetTokens) {
		return buildEmergencyCompactionMessage(messages, normalizedTargetTokens);
	}

	return changed.value ? messages : null;
}

async function compactKanbanMessagesForContextTargetWithModelProvider(
	messagesInput: readonly NKleinSdkPersistedMessage[],
	targetTokens: number,
): Promise<NKleinSdkPersistedMessage[] | null> {
	const normalizedTargetTokens = Math.max(1, Math.trunc(targetTokens));
	if (countKanbanPersistedMessagesTokens(messagesInput) <= normalizedTargetTokens) {
		return null;
	}
	const messages = cloneMessages(messagesInput);
	const changed = { value: false };
	await compactOlderTextMessagesWithProvider(messages, normalizedTargetTokens, changed);
	if (countKanbanPersistedMessagesTokens(messages) > normalizedTargetTokens) {
		return compactKanbanMessagesForContextTarget(messages, normalizedTargetTokens);
	}
	return changed.value ? messages : null;
}

export function focusKanbanReadFilesForNextRequest(
	messages: readonly NKleinSdkPersistedMessage[],
): NKleinSdkPersistedMessage[] | null {
	return compactKanbanMessagesForContextTarget(messages, Number.MAX_SAFE_INTEGER);
}

export async function compactKanbanFocusedMessages(
	context: NKleinSdkContextCompactionContext,
): Promise<Awaited<NKleinSdkContextCompactionResult>> {
	const targetTokens = Math.max(1, Math.min(context.triggerTokens, context.maxInputTokens));
	const messages =
		(await compactKanbanMessagesForContextTargetWithModelProvider(context.messages, targetTokens)) ??
		compactKanbanMessagesForContextTarget(context.messages, targetTokens);
	return messages ? { messages } : undefined;
}
