/**
 * Small-model-safe context compaction (todo §5.AQ item F) — summarization **compaction** + **tool-result clearing**
 * for long agent loops. This is NOT query-agnostic token-compression / truncation: §5.AQ research found those HURT weak
 * local models most (truncation → 74–96% task collapse) and the compressor itself is a wall-clock cost, so they are a
 * fit-more-context / RAG-noise tool, never a local latency lever. The local wins this module encodes are the two
 * Anthropic-style compaction moves: keep the durable signal (decisions / bugs / state), and CLEAR raw tool output
 * (the safest thing to drop, since it can be re-fetched and is the bulkiest noise).
 *
 * Pure, no I/O — these are decision functions over token accounting + message metadata. Actually summarizing a message
 * (calling a model) and re-fetching cleared tool output are effectful concerns left to the caller; this module only
 * decides WHEN to compact and WHICH messages go in which bucket.
 *
 * **High-recall-then-precision** (the §5.AQ-F mandate): bias toward RETENTION first — anything that might carry a
 * decision/bug/state is kept verbatim or summarized (never silently dropped); only raw tool output is dropped. System
 * and pinned messages are load-bearing and always survive; the most-recent slice survives verbatim because recency is
 * where the live task state lives.
 */

/** Inputs to the ~80% compaction trigger: current usage vs the model's window, with an optional threshold override. */
export interface CompactionTrigger {
	/** Tokens currently occupied by the conversation/context. */
	usedTokens: number;
	/** The model's (quality-effective) context window size in tokens. */
	windowTokens: number;
	/** Fraction of the window at which compaction should fire. Defaults to 0.8 (the ~80% threshold). */
	thresholdFraction?: number;
}

/** Default compaction threshold — fire at ~80% of the window, leaving headroom for the next turn + the summary. */
const DEFAULT_THRESHOLD_FRACTION = 0.8;

/**
 * True once the context has filled to the compaction threshold (`usedTokens >= windowTokens * thresholdFraction`,
 * default 0.8). A non-positive `windowTokens` is unusable (we cannot reason about a fraction of it) → never compact.
 */
export function shouldCompact(trigger: CompactionTrigger): boolean {
	if (trigger.windowTokens <= 0) {
		return false;
	}
	const fraction = trigger.thresholdFraction ?? DEFAULT_THRESHOLD_FRACTION;
	return trigger.usedTokens >= trigger.windowTokens * fraction;
}

/** Roles a compactable message can carry. `system` framing is always preserved; `tool` is raw output, safest to drop. */
export type CompactMessageRole = "system" | "user" | "assistant" | "tool";

/** A single message considered for compaction: its role, its token cost, and whether it is explicitly pinned. */
export interface CompactableMessage {
	role: CompactMessageRole;
	tokens: number;
	/** Pinned messages are load-bearing (e.g. a captured decision/bug) and are ALWAYS kept verbatim. */
	pinned?: boolean;
}

/**
 * The compaction decision over a message list. Each array holds indices INTO the input `messages`; every index appears
 * in exactly one bucket (the three buckets partition the input), and indices within each bucket are ascending.
 */
export interface CompactionPlan {
	/** Indices kept untouched: system, pinned, and the most-recent slice within the recency budget. */
	keepVerbatim: number[];
	/** Indices to replace with a summary: older user/assistant turns (carry decisions/bugs/state → preserve, condensed). */
	summarize: number[];
	/** Indices to clear: older raw tool output (re-fetchable, bulkiest noise → safest to drop). */
	drop: number[];
}

/** Inputs to {@link planCompaction}: the message list and the recency budget kept verbatim, scanning from the end. */
export interface PlanCompactionInput {
	messages: readonly CompactableMessage[];
	/** Token budget for the most-recent messages to keep VERBATIM (cumulative from the END, inclusive of the edge). */
	keepRecentTokens: number;
}

/**
 * Plan a compaction over `messages`, high-recall-then-precision:
 *
 * 1. ALWAYS keep verbatim every `system` message and every `pinned` message (load-bearing framing/decisions), and the
 *    most-recent messages whose CUMULATIVE tokens — scanning from the END — stay within `keepRecentTokens` (the live
 *    task state). A message exactly at the budget edge is kept (`cumulative <= keepRecentTokens`).
 * 2. Of the REMAINING (older, non-system, non-pinned) messages: `tool` output → `drop` (raw tool output is the safest
 *    to clear); everything else (old user/assistant) → `summarize` (condense, preserving decisions/bugs/state).
 *
 * Pure — the input is never mutated. The returned buckets partition `[0, messages.length)`; within each, ascending.
 */
export function planCompaction(input: PlanCompactionInput): CompactionPlan {
	const { messages, keepRecentTokens } = input;
	const recent = new Set<number>();

	// Recency pass: walk from the END, keeping messages whose cumulative cost stays within the budget (edge inclusive).
	let cumulative = 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const next = cumulative + messages[index].tokens;
		if (next > keepRecentTokens) {
			break;
		}
		cumulative = next;
		recent.add(index);
	}

	const keepVerbatim: number[] = [];
	const summarize: number[] = [];
	const drop: number[] = [];

	messages.forEach((message, index) => {
		if (message.role === "system" || message.pinned === true || recent.has(index)) {
			keepVerbatim.push(index);
			return;
		}
		// Older, non-system, non-pinned: clear raw tool output; summarize the rest (it may carry decisions/bugs/state).
		if (message.role === "tool") {
			drop.push(index);
			return;
		}
		summarize.push(index);
	});

	return { keepVerbatim, summarize, drop };
}
