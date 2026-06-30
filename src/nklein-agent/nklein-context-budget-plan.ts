// Pure context-budget planning for a known model window (extracted from nklein-task-session-service
// prepareMessagesForKnownContextWindow, §5.U). Given the pending prompt + history + window it estimates tokens,
// compacts history toward the safe working budget, and decides the outcome (ok / compacted / blocked) — leaving
// the SIDE EFFECTS (the context-guard observation, the overflow throws + their wording) to the session service.
import type { RuntimeTaskImage } from "../core/api-contract";
import { estimateNextPromptTokens } from "./nklein-context-budget-tokens";
import { buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
import {
	compactKanbanMessagesForContextTarget,
	countKanbanPersistedMessagesTokens,
} from "./nklein-context-focus-policy";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary";

/** Tokens reserved for the model's response when projecting whether a prompt fits the window. */
export const CONTEXT_BUDGET_SEND_RESERVE_TOKENS = 2_000;

export interface ContextBudgetPlan {
	compactedMessages: NKleinSdkPersistedMessage[];
	originalHistoryTokens: number;
	compactedHistoryTokens: number;
	nextPromptTokens: number;
	originalProjectedTokens: number;
	projectedTokens: number;
	/** "ok" = fits as-is; "compacted" = fits only after history compaction; "blocked" = overflows even compacted. */
	outcome: "ok" | "compacted" | "blocked";
	/** When blocked, whether the prompt ALONE overflows (vs. history pushing it over) — selects the error wording. */
	promptAloneOverflows: boolean;
}

/**
 * Plan the send: estimate the next-prompt + history tokens, compact history toward the window's safe working
 * budget, and classify the outcome. Pure — the caller performs the guard observation + the overflow throw.
 */
export function planContextBudget(input: {
	messages?: NKleinSdkPersistedMessage[] | null;
	prompt: string;
	images?: RuntimeTaskImage[];
	contextWindow: number;
}): ContextBudgetPlan {
	const messages = input.messages ?? [];
	const nextPromptTokens = estimateNextPromptTokens(input.prompt, input.images);
	const originalHistoryTokens = countKanbanPersistedMessagesTokens(messages);
	const originalProjectedTokens = originalHistoryTokens + nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
	const budgets = buildKanbanContextSafetyBudgets(input.contextWindow);
	const historyTargetTokens = Math.max(
		1,
		Math.min(
			budgets.safeWorkingBudget ?? input.contextWindow,
			input.contextWindow - nextPromptTokens - CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
		),
	);
	const compactedMessages =
		messages.length > 0
			? (compactKanbanMessagesForContextTarget(messages, historyTargetTokens) ?? messages)
			: messages;
	const compactedHistoryTokens = countKanbanPersistedMessagesTokens(compactedMessages);
	const projectedTokens = compactedHistoryTokens + nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
	const promptAloneOverflows = nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS > input.contextWindow;
	const outcome: ContextBudgetPlan["outcome"] =
		projectedTokens > input.contextWindow
			? "blocked"
			: compactedMessages !== messages || originalProjectedTokens > input.contextWindow
				? "compacted"
				: "ok";
	return {
		compactedMessages,
		originalHistoryTokens,
		compactedHistoryTokens,
		nextPromptTokens,
		originalProjectedTokens,
		projectedTokens,
		outcome,
		promptAloneOverflows,
	};
}
