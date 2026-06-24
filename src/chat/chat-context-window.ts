import type { ChatMessage } from "./chat-transcript-store";

/**
 * Short-term chat memory: the lean live window (todo §5.M). A long session's transcript is split into the most
 * recent messages that fit a token budget (kept verbatim) and the older overflow (rolling-summarized into one
 * note), so a small model sustains a long conversation within the ≥32k floor.
 *
 * The split (`splitChatContextWindow`) is pure + token-estimator-injected, so it's fully unit-testable; the
 * summarization (`consolidateChatContextWindow`) injects the model call. The current/last turn is always kept
 * even if it alone exceeds the budget — we never drop the message being responded to.
 */

export interface ChatContextWindow {
	/** Older messages beyond the budget, to be folded into a summary. */
	overflow: ChatMessage[];
	/** The most recent messages kept verbatim within the budget (chronological order). */
	recent: ChatMessage[];
}

export function splitChatContextWindow(input: {
	messages: readonly ChatMessage[];
	tokenBudget: number;
	estimateTokens: (text: string) => number;
}): ChatContextWindow {
	const recent: ChatMessage[] = [];
	let used = 0;
	for (let i = input.messages.length - 1; i >= 0; i--) {
		const message = input.messages[i];
		if (!message) {
			continue;
		}
		const cost = input.estimateTokens(message.content);
		// Keep at least the most recent message; stop once the next-older one would overflow the budget.
		if (recent.length > 0 && used + cost > input.tokenBudget) {
			return { overflow: [...input.messages.slice(0, i + 1)], recent };
		}
		recent.unshift(message);
		used += cost;
	}
	return { overflow: [], recent };
}

export interface ConsolidatedChatContextWindow {
	/** A summary of the overflow, or null when nothing overflowed. */
	summary: string | null;
	recent: ChatMessage[];
}

/**
 * Fold the overflow into a single summary via the injected summarizer (a model call). When nothing overflows,
 * the summarizer is not invoked and `summary` is null.
 */
export async function consolidateChatContextWindow(
	window: ChatContextWindow,
	summarize: (overflow: readonly ChatMessage[]) => Promise<string>,
): Promise<ConsolidatedChatContextWindow> {
	if (window.overflow.length === 0) {
		return { summary: null, recent: window.recent };
	}
	const summary = await summarize(window.overflow);
	return { summary: summary.trim() || null, recent: window.recent };
}
