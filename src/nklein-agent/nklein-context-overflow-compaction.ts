import { compactKanbanMessagesForContextTarget } from "./nklein-context-focus-policy";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary";

/**
 * Temporary !Klein-side fallback for context overflow recovery.
 * TODO: remove this once SDK-side pluggable compaction policies are available and wired through !Klein.
 */
const CONTEXT_OVERFLOW_ERROR_PATTERNS = [
	/prompt is too long/i,
	/prompt is too long.*tokens?\s*>\s*\d+\s*maximum/i,
	/maximum prompt length/i,
	/input is too long/i,
	/context length exceeded/i,
	/context length.*exceeds/i,
	/maximum context length/i,
	/\bcontext\s*(?:length|window)\b/i,
	/\bcontext\s*(?:length|window)\b.*exceed/i,
	/\bmaximum\s*context\b/i,
	/context window.*(exceed|limit|too)/i,
	/(exceed|exceeds|exceeded).*context window/i,
	/input exceeds.*context window/i,
	/too many tokens/i,
	/\btoo\s*many\s*tokens?\b/i,
	/\b(?:input\s*)?tokens?\s*exceed/i,
	/maximum tokens.*exceeds.*model limit/i,
	/input length and max_tokens exceed context limit/i,
	/total number of tokens.*exceeds.*limit/i,
	/requested.*tokens.*exceeds.*limit/i,
	/requested input length.*exceeds.*maximum input length/i,
	/input token count exceeds.*maximum.*tokens? allowed/i,
	/reduce.*length.*messages.*completion/i,
	/tokens?\s*>\s*[\d,]+\s*(maximum|limit)/i,
	/input tokens?.*(exceed|exceeds).*(limit|maximum|context)/i,
];
const CONTEXT_COMPACTION_PREVIEW_CHARS = 300;
const CONTEXT_OVERFLOW_RECOVERY_TARGET_TOKENS = 60_000;

export function isContextOverflowError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return CONTEXT_OVERFLOW_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

function readMessagePreview(message: NKleinSdkPersistedMessage): string {
	const rawText =
		typeof message.content === "string"
			? message.content
			: message.content
					.map((block) => {
						if (block.type === "text") {
							return block.text;
						}
						if (block.type === "file") {
							return block.path;
						}
						if (block.type === "tool_use") {
							return `${block.name} ${JSON.stringify(block.input)}`;
						}
						if (block.type === "tool_result") {
							return typeof block.content === "string" ? block.content : "[tool_result]";
						}
						if (block.type === "thinking") {
							return block.thinking;
						}
						if (block.type === "redacted_thinking") {
							return "[redacted_thinking]";
						}
						return "[image]";
					})
					.join(" ");

	const normalized = rawText.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "(empty)";
	}
	if (normalized.length <= CONTEXT_COMPACTION_PREVIEW_CHARS) {
		return normalized;
	}
	return `${normalized.slice(0, CONTEXT_COMPACTION_PREVIEW_CHARS)}...`;
}

/**
 * A user-role message whose blocks are ALL `tool_result` — i.e. the second half of a tool_use/tool_result pair, not a
 * real turn start. Cutting the transcript here (keeping the tool_result but not its assistant `tool_use`) orphans it and
 * the provider rejects the request. A string-content user message, or one with any non-tool_result block, IS a turn start.
 */
function isToolResultOnlyUserMessage(message: NKleinSdkPersistedMessage): boolean {
	if (message.role !== "user" || typeof message.content === "string") {
		return false;
	}
	return message.content.length > 0 && message.content.every((block) => block.type === "tool_result");
}

function prependCompactionNotice(
	message: NKleinSdkPersistedMessage,
	firstUserMessage: string,
): NKleinSdkPersistedMessage {
	const note = `[Previous conversation history was removed due to context window limits. Infer prior actions from the current environment state. First user message from the removed history: ${firstUserMessage}]`;
	if (typeof message.content === "string") {
		return {
			...message,
			content: `${note}\n\n${message.content}`,
		};
	}
	return {
		...message,
		content: [{ type: "text", text: note }, ...message.content],
	};
}

export function compactPersistedMessagesForContextOverflow(
	messages: NKleinSdkPersistedMessage[],
): NKleinSdkPersistedMessage[] | null {
	if (messages.length < 2) {
		return null;
	}

	const focusedMessages = compactKanbanMessagesForContextTarget(messages, CONTEXT_OVERFLOW_RECOVERY_TARGET_TOKENS);
	if (focusedMessages) {
		return focusedMessages;
	}

	const firstUserMessage = messages.find((message) => message.role === "user");
	if (!firstUserMessage) {
		return null;
	}
	const firstUserMessagePreview = readMessagePreview(firstUserMessage);

	// Snap the cut to a TURN-START user message — one carrying real user/text content, NOT a tool_result-only message.
	// A tool_result-only user message pairs with a `tool_use` in the assistant turn before it; if that assistant turn
	// was dropped in the first half, keeping the tool_result orphans it and the provider rejects the request (HTTP 400),
	// defeating the overflow recovery. If no clean turn-start exists in the retained slice, return null (no safe cut) —
	// the caller already handles a null (couldn't-compact) result. Mirrors the SDK's isTurnStartMessage guard.
	let retained = messages.slice(Math.floor(messages.length / 2));
	while (retained.length > 0 && (retained[0]?.role !== "user" || isToolResultOnlyUserMessage(retained[0]))) {
		retained = retained.slice(1);
	}
	if (retained.length === 0) {
		return null;
	}

	const rewrittenFirstMessage = prependCompactionNotice(retained[0], firstUserMessagePreview);
	const compactedMessages = [rewrittenFirstMessage, ...retained.slice(1)];
	if (compactedMessages.length >= messages.length) {
		return null;
	}
	return compactedMessages;
}
