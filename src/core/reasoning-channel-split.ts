/**
 * §5.AN: separate a completion's REASONING channel from its VISIBLE answer, across LM Studio's documented reasoning
 * conventions (pure).
 *
 * WHAT §5.AN maps: "Reasoning is split into `reasoning_content` vs `content` (llama.cpp `--reasoning-format deepseek`
 * default). DeepSeek-R1 uses `<think>…</think>`." So the SAME "here is my hidden thinking, here is my answer" fact reaches
 * the caller two ways depending on the model/runtime:
 *   1. as a SEPARATE `reasoning_content` field alongside `content` (the OpenAI-compat `/v1` split — the common case), or
 *   2. INLINE inside `content` as a `<think>…</think>` block (DeepSeek-R1 and other models the runtime does NOT split out),
 *      also seen as the `[THINK]…[/THINK]` bracket variant.
 *
 * WHY a shared core: today two hot paths each handle a SLICE of this ad-hoc and INCONSISTENTLY —
 *   - `chat-local-llm-adapter.ts` strips inline reasoning with `content.replace(/<think>[\s\S]*?<\/think>/g, "")`, which
 *     silently FAILS on a **truncated** reasoning block: a reasoning model that hit `max_tokens` mid-thought emits an
 *     OPEN `<think>` with NO closing `</think>` (exactly the §5.AA truncation case this section centers on), and the
 *     lazy `…*?</think>` requires the close — so the ENTIRE reasoning dump leaks into the user-visible answer; and it only
 *     STRIPS, discarding the reasoning text a truncation/over-rumination signal could use.
 *   - `nklein-local-llm-client.ts` concatenates `content + "\n" + reasoning_content` for narrated-tool-call recovery,
 *     handling only the split-field form (not inline `<think>`), and with no truncation awareness.
 * A single splitter gives every path ONE consistent, truncation-safe separation: a clean answer to show, PLUS the
 * reasoning text to mine (narration recovery reads BOTH channels; a truncated-open block is a strong over-rumination
 * signal that complements `completion-stop-reason.ts`'s stop-reason classifier).
 *
 * Pure + total: inputs are plain values (an already-received message's `content` + optional `reasoning_content`); no I/O,
 * no network, no model call, no clock. Never throws; an empty/whitespace message yields empty channels.
 *
 * SCOPE: this ONLY separates the reasoning channel from the answer. It does NOT classify the stop reason
 * ([completion-stop-reason.ts](./completion-stop-reason.ts)), size a reasoning budget
 * ([reasoning-output-budget.ts](./reasoning-output-budget.ts)), parse a tool call, or extract a JSON object
 * ([../nklein-agent/nklein-tool-argument-repair.ts]) — a caller composes those. It also does NOT collapse a repeated-tail
 * loop (`detectResponseLoop` does that, applied AFTER this by the chat adapter).
 */

/** The two channels of a reasoning-model completion, separated. */
export interface ReasoningChannelSplit {
	/**
	 * The VISIBLE answer — `content` with any inline reasoning block removed, trimmed. This is what to show a user / parse
	 * as the reply. Empty string when the model produced only reasoning and no answer (e.g. a turn truncated inside the
	 * thinking block — see {@link truncatedReasoning}).
	 */
	answer: string;
	/**
	 * The reasoning/chain-of-thought text — the separate `reasoning_content` field AND any inline `<think>…</think>` /
	 * `[THINK]…[/THINK]` blocks lifted out of `content`, joined by a blank line (in that order). Empty string when the
	 * completion carried no reasoning channel at all. Useful for narrated-tool-call recovery (a weak model may print the
	 * call in its reasoning) and as an over-rumination signal.
	 */
	reasoning: string;
	/** True when an inline reasoning block was found inside `content` (as opposed to only a separate `reasoning_content`). */
	hadInlineReasoning: boolean;
	/**
	 * True when an inline reasoning block was OPENED but never CLOSED — i.e. `<think>` (or `[THINK]`) with no matching
	 * terminator, the signature of a turn truncated MID-thought. A strong §5.AA over-rumination / truncation signal:
	 * everything after the open marker is treated as reasoning (so the answer is not polluted by the runaway thought), and
	 * the answer is whatever preceded the open marker. Always `false` when there was no inline block.
	 */
	truncatedReasoning: boolean;
}

/** A minimal completion-message shape — just the fields the reasoning split reads (matches the `/v1` `message` object). */
export interface ReasoningMessageLike {
	/** The `content` channel (may itself contain inline `<think>…</think>` reasoning). */
	content?: string | null;
	/** The SEPARATE reasoning channel field (`reasoning_content`), when the runtime split it out. */
	reasoning_content?: string | null;
}

/**
 * The inline reasoning-marker pairs to recognize, tried in order. `<think>…</think>` is the DeepSeek-R1 convention §5.AN
 * documents; `[THINK]…[/THINK]` is the bracket variant some templates emit. Matching is case-insensitive (see
 * {@link splitReasoningChannel}). Open/close are matched as literal tags; whitespace inside a tag (`< think >`) is NOT
 * accepted (conservative — only the exact documented markers are treated as reasoning, so ordinary prose mentioning the
 * word "think" is never mistaken for a channel marker).
 */
const INLINE_MARKERS: readonly { open: string; close: string }[] = [
	{ open: "<think>", close: "</think>" },
	{ open: "[THINK]", close: "[/THINK]" },
];

function asText(value: string | null | undefined): string {
	return typeof value === "string" ? value : "";
}

/**
 * Lift every CLOSED inline reasoning block out of `content`, plus detect a single trailing OPEN-but-unclosed block
 * (truncation). Returns the answer text (blocks removed) and the collected reasoning fragments, all UN-trimmed (the
 * caller trims once at the end). Works on a lowercased copy for locating markers so matching is case-insensitive, while
 * slicing the ORIGINAL text so the returned content preserves the model's casing.
 */
function extractInlineReasoning(content: string): {
	answer: string;
	fragments: string[];
	hadInline: boolean;
	truncated: boolean;
} {
	const lower = content.toLowerCase();
	const fragments: string[] = [];
	let answer = "";
	let cursor = 0;
	let hadInline = false;
	let truncated = false;

	// LEADING-CLOSE recovery (live-found 2026-07-08 on the resident 9B): when the endpoint splits the reasoning
	// channel mid-block, `content` can START inside the reasoning and carry only the CLOSING marker
	// ("…thought tail</think>real answer"). Everything up to (and including) a close marker that appears BEFORE any
	// open marker is reasoning, not answer — without this the thought tail AND the bare tag leak to the user.
	for (const marker of INLINE_MARKERS) {
		const closeAt = lower.indexOf(marker.close.toLowerCase());
		if (closeAt === -1) {
			continue;
		}
		const openAt = lower.indexOf(marker.open.toLowerCase());
		if (openAt !== -1 && openAt < closeAt) {
			continue; // a normal open…close block — the loop below owns it.
		}
		fragments.push(content.slice(0, closeAt));
		cursor = closeAt + marker.close.length;
		hadInline = true;
		break;
	}

	while (cursor < content.length) {
		// Find the NEXT opening marker (any variant), whichever comes first.
		let nextOpenAt = -1;
		let matched: { open: string; close: string } | null = null;
		for (const marker of INLINE_MARKERS) {
			const at = lower.indexOf(marker.open.toLowerCase(), cursor);
			if (at !== -1 && (nextOpenAt === -1 || at < nextOpenAt)) {
				nextOpenAt = at;
				matched = marker;
			}
		}
		if (nextOpenAt === -1 || matched === null) {
			answer += content.slice(cursor);
			break;
		}

		// Text before the open marker is answer text.
		answer += content.slice(cursor, nextOpenAt);
		hadInline = true;
		const contentStart = nextOpenAt + matched.open.length;
		const closeAt = lower.indexOf(matched.close.toLowerCase(), contentStart);
		if (closeAt === -1) {
			// OPEN with no CLOSE ⇒ truncated mid-thought: everything after the open marker is reasoning; no answer follows.
			fragments.push(content.slice(contentStart));
			truncated = true;
			cursor = content.length;
			break;
		}
		fragments.push(content.slice(contentStart, closeAt));
		cursor = closeAt + matched.close.length;
	}

	return { answer, fragments, hadInline, truncated };
}

/**
 * Separate a completion message's reasoning channel from its visible answer (pure) — see the module header for the two
 * conventions (§5.AN). Handles the separate `reasoning_content` field AND inline `<think>…</think>` / `[THINK]…[/THINK]`
 * blocks in `content`, including a TRUNCATED open-but-unclosed block (the §5.AA mid-thought truncation), which the naive
 * `replace(/<think>…<\/think>/)` strip misses.
 *
 * Accepts either the raw message object ({@link ReasoningMessageLike}) or a bare content string (in which case there is no
 * separate reasoning field). The returned {@link ReasoningChannelSplit.answer} and {@link ReasoningChannelSplit.reasoning}
 * are trimmed. Order of the joined reasoning: the separate `reasoning_content` first, then inline blocks in document
 * order.
 */
export function splitReasoningChannel(input: ReasoningMessageLike | string): ReasoningChannelSplit {
	const content = typeof input === "string" ? input : asText(input.content);
	const separateReasoning = typeof input === "string" ? "" : asText(input.reasoning_content);

	const inline = extractInlineReasoning(content);
	const reasoningParts: string[] = [];
	const trimmedSeparate = separateReasoning.trim();
	if (trimmedSeparate.length > 0) {
		reasoningParts.push(trimmedSeparate);
	}
	for (const fragment of inline.fragments) {
		const trimmed = fragment.trim();
		if (trimmed.length > 0) {
			reasoningParts.push(trimmed);
		}
	}

	return {
		answer: inline.answer.trim(),
		reasoning: reasoningParts.join("\n\n"),
		hadInlineReasoning: inline.hadInline,
		truncatedReasoning: inline.truncated,
	};
}

/**
 * Convenience: the VISIBLE answer only, with every reasoning block (separate + inline, closed OR truncated) removed and
 * trimmed. The truncation-safe replacement for the ad-hoc `content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()` —
 * unlike that regex, an unterminated `<think>` (a mid-thought truncation) does NOT leak the reasoning into the answer.
 */
export function stripReasoningChannel(input: ReasoningMessageLike | string): string {
	return splitReasoningChannel(input).answer;
}

/**
 * Convenience: the COMBINED reasoning + answer text (reasoning first, blank-line separated), the surface a narrated
 * tool-call recovery scans (a weak model may print the call in EITHER channel — §5.Z). Mirrors the ad-hoc
 * `content + "\n" + reasoning_content` concatenation in `nklein-local-llm-client.ts`, but also lifts inline `<think>`
 * reasoning into the reasoning half so an inline-reasoning model's narrated call is recoverable too. Empty channels are
 * omitted so there is no leading/trailing blank noise.
 */
export function reasoningAndAnswerText(input: ReasoningMessageLike | string): string {
	const split = splitReasoningChannel(input);
	return [split.reasoning, split.answer].filter((part) => part.length > 0).join("\n\n");
}
