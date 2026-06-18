import type { AgentAfterModelContext, AgentMessage, AgentStopControl } from "@clinebot/shared";

const UNFINISHED_PATTERNS = [
	/\bnot implemented\b/i,
	/\bplaceholder implementation\b/i,
	/\bcould not complete\b/i,
	/\bunable to complete\b/i,
	/\b(?:todo|fixme)\b.{0,80}\b(?:remaining|left|still|not addressed)\b/i,
	/\b(?:remaining|left|still|not addressed)\b.{0,80}\b(?:todo|fixme)\b/i,
];

const COMPLETION_CLAIM_PATTERN = /\b(done|complete|completed|implemented|fixed|finished)\b/i;
const NO_CHANGE_PATTERN = /\bno (?:files|changes|edits) (?:were )?(?:changed|made|needed)\b/i;

export interface ClineSelfReviewOptions {
	hasChangedFiles?: boolean | null;
}

function readAssistantText(message: AgentMessage): string {
	return message.content
		.flatMap((part) => {
			if (part.type !== "text") {
				return [];
			}
			return [part.text];
		})
		.join("\n")
		.trim();
}

function hasToolCall(message: AgentMessage): boolean {
	return message.content.some((part) => part.type === "tool-call");
}

export function reviewClineAfterModelCompletion(
	context: AgentAfterModelContext,
	options: ClineSelfReviewOptions = {},
): AgentStopControl | undefined {
	if (context.finishReason !== "stop" || hasToolCall(context.assistantMessage)) {
		return undefined;
	}
	const text = readAssistantText(context.assistantMessage);
	if (text.length === 0) {
		return undefined;
	}
	const admitsUnfinishedWork = UNFINISHED_PATTERNS.some((pattern) => pattern.test(text));
	const claimsCompletion = COMPLETION_CLAIM_PATTERN.test(text);
	const claimsCompletionWithoutChanges =
		claimsCompletion && (NO_CHANGE_PATTERN.test(text) || options.hasChangedFiles === false);
	if (!admitsUnfinishedWork && !claimsCompletionWithoutChanges) {
		return undefined;
	}
	return {
		stop: true,
		reason:
			"!Klein self-review blocked completion because the assistant response admits unfinished work or claims completion without changes.",
	};
}
