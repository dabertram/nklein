/**
 * P18.3 — prune superseded messages from the TRANSCRIPT before compaction compresses it. PURE core.
 *
 * ⚠️ NOT TO BE CONFUSED WITH {@link ./distractor-pruning.ts} (§5.AD), which prunes low-relevance RETRIEVAL
 * RESULTS by score before they enter the context. Both are honestly called "distractor pruning" — the research
 * term covers both — but they act on different things at different times: that one filters what ENTERS the
 * context, this one removes what has since gone STALE inside it. Keeping them separate modules is deliberate.
 *
 * Chroma's "Context Rot" study measured that **even ONE distractor degrades performance** versus a needle-only
 * baseline, and that focused ~300-token prompts beat full ~113k-token ones on LongMemEval. Relevance density
 * beats token count. The consequence here is concrete: **compaction that shortens the transcript but leaves
 * stale failed attempts in place may not help at all** — it cuts tokens while preserving exactly the content
 * that degrades retrieval. Prune first, compress second.
 *
 * ── CONSERVATIVE BY CONSTRUCTION ──
 * Pruning is LOSSY and its failure mode is nasty: a failed attempt often records *why* a path was abandoned, so
 * dropping it can send the model back into the same wall — and that looks like model stupidity, not a context
 * bug. So this prunes ONLY on **provable supersession**, never on "looks unimportant":
 *  - a tool result superseded by a LATER result for the identical target (stale by definition), and
 *  - a failed tool call whose identical retry LATER SUCCEEDED (resolved, not informative).
 * The asymmetry is what drives that: keeping a distractor costs some retrieval quality; dropping a live
 * constraint costs a wasted loop and is blamed on the model.
 */

export interface PrunableMessage {
	/** Index in the caller's own list, echoed back so the caller maps the decision onto its structures. */
	readonly index: number;
	readonly role: "system" | "user" | "assistant" | "tool";
	readonly toolName?: string | null;
	/**
	 * Stable identifier for WHAT the call acted on (file path, query, URL). Two messages sharing a target are
	 * about the same thing — this is what makes supersession PROVABLE rather than guessed.
	 */
	readonly target?: string | null;
	readonly failed?: boolean;
	readonly tokens: number;
	/** Pinned messages are load-bearing and are never pruned, whatever else is true. */
	readonly pinned?: boolean;
}

export type TranscriptPruneReason = "superseded_read" | "resolved_failure";

export interface TranscriptPruneDecision {
	readonly index: number;
	readonly reason: TranscriptPruneReason;
	readonly detail: string;
	readonly tokens: number;
}

export interface TranscriptPruneResult {
	readonly prune: readonly TranscriptPruneDecision[];
	readonly tokensFreed: number;
	readonly keep: readonly number[];
	readonly summary: string;
}

/**
 * Identify provably-superseded transcript messages. Order-sensitive: "later" means later in the list, so the
 * caller must pass messages in conversation order.
 */
export function pruneTranscriptDistractors(messages: readonly PrunableMessage[]): TranscriptPruneResult {
	const prune = new Map<number, TranscriptPruneDecision>();
	const byTarget = new Map<string, PrunableMessage[]>();

	for (const message of messages) {
		if (message.role !== "tool" || message.pinned === true) {
			continue;
		}
		const target = message.target?.trim();
		if (!target) {
			continue;
		}
		const bucket = byTarget.get(target) ?? [];
		bucket.push(message);
		byTarget.set(target, bucket);
	}

	for (const [target, group] of byTarget) {
		if (group.length < 2) {
			continue;
		}
		const ordered = [...group].sort((left, right) => left.index - right.index);
		const last = ordered[ordered.length - 1];
		if (!last) {
			continue;
		}
		for (const message of ordered.slice(0, -1)) {
			if (message.failed === true && last.failed !== true) {
				prune.set(message.index, {
					index: message.index,
					reason: "resolved_failure",
					detail: `failed ${message.toolName ?? "tool"} on "${target}" later succeeded at index ${last.index}`,
					tokens: message.tokens,
				});
				continue;
			}
			if (message.failed !== true && last.failed !== true) {
				prune.set(message.index, {
					index: message.index,
					reason: "superseded_read",
					detail: `${message.toolName ?? "tool"} result for "${target}" superseded by index ${last.index}`,
					tokens: message.tokens,
				});
			}
			// DELIBERATE GAP: an earlier SUCCESS followed by a later FAILURE is NOT pruned. The success may hold
			// the only good state we ever had for that target, and a later failure does not supersede it.
		}
	}

	const decisions = [...prune.values()].sort((left, right) => left.index - right.index);
	const tokensFreed = decisions.reduce((sum, decision) => sum + decision.tokens, 0);
	const keep = messages.map((message) => message.index).filter((index) => !prune.has(index));

	return {
		prune: decisions,
		tokensFreed,
		keep,
		summary:
			decisions.length === 0
				? "No provably-superseded messages — nothing pruned. Anything whose supersession cannot be proven is kept, because dropping a live constraint costs more than keeping a distractor."
				: `${decisions.length} provably-superseded message(s), freeing ${tokensFreed} token(s). Prune BEFORE compacting: compaction that shortens the transcript while leaving stale failures in place cuts tokens without improving relevance density.`,
	};
}
