/**
 * §5.AT STEP 2 — build the board→chat digest MESSAGE from a set of surfaced feedback items (the output of
 * {@link decideBoardChatFeedback}) + an optional board-health rollup. Pure + deterministic: it is the SHARED renderer
 * used by BOTH the push path (a coalesced burst of transition verdicts) AND the pull path (`get_board_status` — the
 * board-health rollup on demand), so a pushed digest and an on-demand digest are byte-identical.
 *
 * Anti-spam rendering rules (from the §5.AT research): priority-ordered (ASK on top, then NOTIFY, then MILESTONE); capped
 * to the first N card-lines with a "+M more — open the board" pointer so it stays scannable; a single item renders as one
 * plain line (no "board update:" ceremony). It NEVER re-narrates a card's whole life — each line is a pointer + the
 * agent's own result snippet. The local-model rewrite (§5.AT STEP 7) is a LATER optional layer; this deterministic
 * template is the guaranteed floor.
 *
 * `groupLabel` is the forward-compat seam for §5.AU (epics/streams): the bridge groups items by their owning STREAM and
 * calls this per stream with the stream's name, so "Auth stream — board update: …" falls out with no renderer change.
 */

import type { BoardChatTier } from "./board-chat-feedback";

/** One surfaced feedback item, enriched from a verdict with the card's title + (for terminal outcomes) its result text. */
export interface BoardChatDigestItem {
	taskId: string;
	/** The card's title (the human handle in the message). */
	title: string;
	/** The tier that earned the surface. */
	tier: BoardChatTier;
	/** The verdict reason — for NOTIFY this is `done` / `failed` / `heartbeat_lost`; used to pick the line template. */
	reason: string;
	/** The agent's own result / error text (done → `finalMessage`, failed → the error) — a snippet, not the whole thread. */
	resultText?: string;
	/** For ASK items: the decision verbs to offer. */
	suggestedVerbs?: readonly string[];
	/** For MILESTONE items: the plan progress (focus-chain steps) — rendered as "N of M planned steps done". */
	milestone?: { done: number; total: number };
}

/** The compact board-health counts (a subset of §5.AG `OperatorBoardSummary.counts`) rendered on the pull/status path. */
export interface BoardChatHealthCounts {
	healthy: number;
	stuck: number;
	risky: number;
	done: number;
}

export interface BoardChatDigestInput {
	items: readonly BoardChatDigestItem[];
	/** §5.AU forward-compat: a stream/epic name to head the rollup with; omit for an ungrouped digest. */
	groupLabel?: string;
	/** Optional board-health rollup — the whole payload on the pull path, or a trailing summary line on push. */
	boardHealth?: BoardChatHealthCounts;
	/** Max card-lines before truncating with a "+M more" pointer (default 5). */
	cardLineCap?: number;
}

export interface BoardChatDigest {
	/** The rendered message (empty string only when there is genuinely nothing to say). */
	message: string;
	/** How many items the digest represents (pre-cap). */
	itemCount: number;
	/** Whether the card-lines were capped. */
	truncated: boolean;
	/** How many ASK-tier items — lets the bridge decide urgency (an ASK-bearing digest surfaces promptly). */
	askCount: number;
}

const DEFAULT_CARD_LINE_CAP = 5;
const RESULT_SNIPPET_MAX = 140;

/** Tier render order — ASK first (most urgent), then terminal NOTIFY, then MILESTONE. */
const TIER_RANK: Record<BoardChatTier, number> = { ask: 0, notify: 1, milestone: 2 };

/** Collapse a result/error blob to a single trimmed line, capped. */
function snippet(text: string | undefined): string {
	if (!text) {
		return "";
	}
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > RESULT_SNIPPET_MAX ? `${oneLine.slice(0, RESULT_SNIPPET_MAX - 1)}…` : oneLine;
}

/** Render one item as a single scannable line. */
function renderLine(item: BoardChatDigestItem): string {
	const title = `"${item.title}"`;
	const detail = snippet(item.resultText);
	if (item.tier === "ask") {
		const verbs = item.suggestedVerbs && item.suggestedVerbs.length > 0 ? ` (${item.suggestedVerbs.join("/")})` : "";
		return `⚠️ ${title} needs you — ${item.reason}${verbs}`;
	}
	if (item.tier === "milestone") {
		// Show the ACTUAL plan progress (the milestone's done/total steps) in plain language, not the internal
		// "decomposition phase boundary" reason a beginner can't parse. The counts were previously discarded.
		const m = item.milestone;
		if (m && m.total > 0) {
			return m.done >= m.total
				? `▸ ${title} — all ${m.total} planned steps done`
				: `▸ ${title} — ${m.done} of ${m.total} planned steps done`;
		}
		return `▸ ${title} — made progress on its plan`;
	}
	// NOTIFY: pick by reason.
	if (item.reason === "done") {
		return detail ? `✅ ${title} ready for review: ${detail}` : `✅ ${title} ready for review`;
	}
	if (item.reason === "failed") {
		return detail ? `❌ ${title} failed: ${detail}` : `❌ ${title} failed`;
	}
	if (item.reason === "heartbeat_lost") {
		return `🔌 ${title} — heartbeat lost (the run may be dead)`;
	}
	return detail ? `• ${title} — ${item.reason}: ${detail}` : `• ${title} — ${item.reason}`;
}

/** Compact health line for the pull/status path: only the non-zero, operator-relevant buckets. */
function renderHealthLine(counts: BoardChatHealthCounts): string {
	const parts: string[] = [];
	if (counts.risky > 0) {
		parts.push(`${counts.risky} need${counts.risky === 1 ? "s" : ""} you`);
	}
	if (counts.stuck > 0) {
		parts.push(`${counts.stuck} stuck`);
	}
	if (counts.healthy > 0) {
		parts.push(`${counts.healthy} on track`);
	}
	if (counts.done > 0) {
		parts.push(`${counts.done} done`);
	}
	return parts.length > 0 ? `Board: ${parts.join(" · ")}.` : "Board: nothing in progress.";
}

/**
 * Build the digest. Stable-sorts items by tier (ASK→NOTIFY→MILESTONE), caps the card-lines, and heads a multi-item
 * digest with the group label (or a generic "Board update"). Pure; no I/O, no clock.
 */
export function buildBoardChatDigest(input: BoardChatDigestInput): BoardChatDigest {
	const cap = input.cardLineCap ?? DEFAULT_CARD_LINE_CAP;
	const items = [...input.items].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
	const askCount = items.filter((i) => i.tier === "ask").length;

	// Nothing to report → optionally the health rollup (the pull path), else an empty digest.
	if (items.length === 0) {
		return {
			message: input.boardHealth ? renderHealthLine(input.boardHealth) : "",
			itemCount: 0,
			truncated: false,
			askCount: 0,
		};
	}

	const shown = items.slice(0, cap);
	const truncated = items.length > cap;
	const lines = shown.map(renderLine);

	// A single item is a plain one-liner (no rollup ceremony).
	if (items.length === 1) {
		return { message: lines[0] ?? "", itemCount: 1, truncated: false, askCount };
	}

	const header = input.groupLabel ? `${input.groupLabel} — board update:` : "Board update:";
	const body = [header, ...lines];
	if (truncated) {
		body.push(`+${items.length - cap} more — open the board.`);
	}
	if (input.boardHealth) {
		body.push(renderHealthLine(input.boardHealth));
	}
	return { message: body.join("\n"), itemCount: items.length, truncated, askCount };
}
