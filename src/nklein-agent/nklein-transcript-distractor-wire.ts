import { estimateTextTokens } from "../core/eval-context-footprint";
import { type PrunableMessage, pruneTranscriptDistractors } from "../core/transcript-distractor-pruning";
import { deriveToolCallFilePaths } from "./nklein-ledger-tool-calls";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary";

/**
 * P18.3b — THE WIRE for `pruneTranscriptDistractors`: run it ahead of context-overflow compaction so superseded
 * tool output is REMOVED rather than summarized or blindly halved.
 *
 * ── WHY THE CORE DID NOTHING WITHOUT THIS ──
 * `pruneTranscriptDistractors` skips any message with no `target` (`transcript-distractor-pruning.ts`), because a
 * target is what makes supersession PROVABLE rather than guessed. Nothing populated one, so the core had zero
 * production consumers and would have looked installed while changing nothing — the `enabled_but_silent` shape.
 * **Extracting the target IS the wire**, which is why this module exists rather than a one-line call.
 *
 * Targets come from `deriveToolCallFilePaths` — the SAME extractor the attempt ledger uses — so "what did this
 * call act on" has one definition here rather than a second, subtly different one.
 *
 * ── THE SAFETY DECISION: STUB, NEVER DELETE ──
 * A `tool_result` may NOT simply be dropped. It pairs with a `tool_use` block in the assistant turn before it, and
 * an unmatched block of either kind makes the provider reject the whole request with a 400 — the same hazard
 * `nklein-context-overflow-compaction.ts` already documents for its turn-start snapping. Deleting superseded
 * results would therefore convert a context-pressure problem into a hard API failure.
 *
 * So a superseded result keeps its block and its `tool_use_id`, and only its CONTENT is replaced with a one-line
 * stub naming what superseded it. The pairing stays intact, the tokens are reclaimed, and the model is told the
 * content is gone rather than being left to infer it from a suspicious silence.
 *
 * Deliberately conservative: only `tool_result` blocks whose target was superseded by a LATER call on the same
 * target are touched. Everything else — text, assistant reasoning, the final call on each target, and anything the
 * core declines to prune — is passed through byte-identical.
 */

/** Marker prefix for a stubbed result, so a later pass can recognise its own work and never re-stub it. */
const SUPERSEDED_STUB_PREFIX = "[!Klein: superseded tool output removed]";

export interface TranscriptDistractorPruneOutcome {
	readonly messages: NKleinSdkPersistedMessage[];
	readonly prunedCount: number;
	readonly tokensFreed: number;
	readonly summary: string;
}

interface ToolResultLocation {
	readonly messageIndex: number;
	readonly blockIndex: number;
	readonly target: string;
	readonly tokens: number;
}

function blockText(block: unknown): string {
	if (typeof block === "string") {
		return block;
	}
	if (!block || typeof block !== "object") {
		return "";
	}
	const candidate = block as { content?: unknown; text?: unknown };
	if (typeof candidate.text === "string") {
		return candidate.text;
	}
	if (typeof candidate.content === "string") {
		return candidate.content;
	}
	if (Array.isArray(candidate.content)) {
		return candidate.content.map((inner) => blockText(inner)).join("\n");
	}
	return "";
}

/**
 * Prune superseded tool results from a persisted message list.
 *
 * Returns `null` when nothing was superseded, so the caller can keep its existing message array by reference and
 * skip any downstream work — an explicit "no change" rather than an equal-looking copy.
 */
export function pruneSupersededToolResults(
	messages: readonly NKleinSdkPersistedMessage[],
): TranscriptDistractorPruneOutcome | null {
	// Pass 1 — map every tool_use id to the single target it acted on. A call touching several files has no single
	// stable target, so it is left out: supersession across multi-file calls is not provable from paths alone, and
	// guessing here would prune output that was never actually replaced.
	const targetByToolUseId = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "assistant" || typeof message.content === "string") {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_use") {
				continue;
			}
			const paths = deriveToolCallFilePaths((block as { input?: unknown }).input);
			const id = (block as { id?: unknown }).id;
			if (paths.length === 1 && typeof id === "string" && id.length > 0) {
				targetByToolUseId.set(id, paths[0] as string);
			}
		}
	}
	if (targetByToolUseId.size === 0) {
		return null;
	}

	// Pass 2 — locate every tool_result that has a resolvable target, flattening (messageIndex, blockIndex) onto the
	// single numeric index the pure core speaks in.
	const locations: ToolResultLocation[] = [];
	const prunable: PrunableMessage[] = [];
	for (const [messageIndex, message] of messages.entries()) {
		if (typeof message.content === "string") {
			continue;
		}
		for (const [blockIndex, block] of message.content.entries()) {
			if (block.type !== "tool_result") {
				continue;
			}
			const toolUseId = (block as { tool_use_id?: unknown }).tool_use_id;
			const target = typeof toolUseId === "string" ? targetByToolUseId.get(toolUseId) : undefined;
			if (!target) {
				continue;
			}
			const text = blockText(block);
			// Never re-stub something this function already stubbed: it is tiny, and counting it again would inflate
			// the reported savings on every subsequent overflow.
			if (text.startsWith(SUPERSEDED_STUB_PREFIX)) {
				continue;
			}
			const tokens = estimateTextTokens(text);
			locations.push({ messageIndex, blockIndex, target, tokens });
			prunable.push({ index: locations.length - 1, role: "tool", target, tokens });
		}
	}
	if (prunable.length === 0) {
		return null;
	}

	const result = pruneTranscriptDistractors(prunable);
	if (result.prune.length === 0) {
		return null;
	}

	// Pass 3 — rewrite only the superseded blocks, copying each touched message shallowly so untouched messages stay
	// identical by reference.
	const stubsByMessage = new Map<number, Map<number, string>>();
	for (const decision of result.prune) {
		const location = locations[decision.index];
		if (!location) {
			continue;
		}
		const perMessage = stubsByMessage.get(location.messageIndex) ?? new Map<number, string>();
		perMessage.set(
			location.blockIndex,
			`${SUPERSEDED_STUB_PREFIX} for "${location.target}" — ${decision.detail}. Re-read it if you still need it.`,
		);
		stubsByMessage.set(location.messageIndex, perMessage);
	}

	const nextMessages = messages.map((message, messageIndex) => {
		const perMessage = stubsByMessage.get(messageIndex);
		if (!perMessage || typeof message.content === "string") {
			return message;
		}
		return {
			...message,
			content: message.content.map((block, blockIndex) => {
				const stub = perMessage.get(blockIndex);
				return stub ? { ...block, content: stub } : block;
			}),
		} as NKleinSdkPersistedMessage;
	});

	return {
		messages: nextMessages,
		prunedCount: result.prune.length,
		tokensFreed: result.tokensFreed,
		summary: result.summary,
	};
}
