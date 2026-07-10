// §5.BB phase 2 — ACTIVITY TICKS for the chat-centric view: turn successive board+session snapshots into small
// system "tick" lines the chat transcript streams live ("Classify trends → review", "model started on Fix parser"),
// so the chat gives the activity impression without watching the board. PURE diff: the caller supplies snapshots
// and the timestamp; no I/O, no clock — the whole tick stream is unit-testable. Client-side only (derived from the
// queries the app already polls): zero server surface, and inherently read-only under harness watch mode.

import type { RuntimeTaskSessionState, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardColumn } from "@/types";

export interface ActivityTick {
	/** Stable id (`{at}:{kind}:{cardId}`) for React keys. */
	id: string;
	/** Arrival timestamp (epoch ms) — merges the tick into the transcript's time order. */
	at: number;
	kind: "card_moved" | "card_created" | "session_started" | "session_ended" | "card_blocked";
	/** The card the tick is about (click ⇒ open in the main panel). */
	cardId: string;
	/** The full human line, card title included (e.g. "Classify trends → review"). */
	label: string;
}

export interface BoardActivitySnapshot {
	columns: readonly BoardColumn[];
	sessions: Readonly<Record<string, RuntimeTaskSessionSummary>>;
}

/** How a column arrival reads in a tick; columns not listed don't tick (backlog shuffles are noise). */
const COLUMN_ARRIVAL_LABEL: Record<string, string> = {
	in_progress: "→ in progress",
	review: "→ review",
	completed: "✓ completed",
	trash: "→ trash",
};

/** Session states that mean "a model is actively driving the card". */
const LIVE_SESSION_STATES: ReadonlySet<RuntimeTaskSessionState> = new Set(["queued", "running"]);
/** Terminal session states worth a tick (awaiting_review is covered by the column move instead). */
const ENDED_SESSION_LABEL: Partial<Record<RuntimeTaskSessionState, string>> = {
	failed: "session failed",
	interrupted: "session interrupted",
};

interface CardFacts {
	title: string;
	columnId: string;
	blockedKind: string | null;
}

function indexCards(snapshot: BoardActivitySnapshot): Map<string, CardFacts> {
	const byId = new Map<string, CardFacts>();
	for (const column of snapshot.columns) {
		for (const card of column.cards) {
			byId.set(card.id, { title: card.title, columnId: column.id, blockedKind: card.blockedKind ?? null });
		}
	}
	return byId;
}

/** Session summaries are keyed by session id (`task-1`, `task-1::review`) — ticks care about the base task. */
function baseTaskId(sessionKey: string, summary: RuntimeTaskSessionSummary): string {
	return summary.taskId ?? sessionKey.split("::", 1)[0] ?? sessionKey;
}

/**
 * Diff two snapshots into ticks. The FIRST snapshot seeds silently (`previous === null` ⇒ no ticks) so a page
 * load doesn't replay the whole board as "activity". Deterministic order: card ticks in board order, then
 * session ticks in sorted session-key order.
 */
export function diffBoardActivity(
	previous: BoardActivitySnapshot | null,
	next: BoardActivitySnapshot,
	at: number,
): ActivityTick[] {
	if (previous === null) {
		return [];
	}
	const before = indexCards(previous);
	const after = indexCards(next);
	const ticks: ActivityTick[] = [];
	const push = (kind: ActivityTick["kind"], cardId: string, label: string): void => {
		ticks.push({ id: `${at}:${kind}:${cardId}`, at, kind, cardId, label });
	};

	for (const column of next.columns) {
		for (const card of column.cards) {
			const prior = before.get(card.id);
			if (!prior) {
				push("card_created", card.id, `new card: ${card.title}`);
				continue;
			}
			if (prior.columnId !== column.id) {
				const arrival = COLUMN_ARRIVAL_LABEL[column.id];
				if (arrival) {
					push("card_moved", card.id, `${card.title} ${arrival}`);
				}
			}
			const blockedKind = card.blockedKind ?? null;
			if (blockedKind && blockedKind !== prior.blockedKind) {
				push("card_blocked", card.id, `${card.title} blocked (${blockedKind})`);
			}
		}
	}

	const sessionKeys = [...new Set([...Object.keys(previous.sessions), ...Object.keys(next.sessions)])].sort();
	for (const key of sessionKeys) {
		// Synthetic sub-sessions (`::review` / `::acceptance` / `::spec`) are the card's JUDGES, not its work —
		// they end `interrupted` by design after delivering, so ticking them spammed healthy boards with
		// "session interrupted" (live-found 2026-07-10, 8× on a clean drain). The card's own lane moves and its
		// base session carry the story; sub-sessions stay silent (matching the server bridge's derived-id skip).
		if (key.includes("::")) {
			continue;
		}
		const prior = previous.sessions[key];
		const current = next.sessions[key];
		const wasLive = prior !== undefined && LIVE_SESSION_STATES.has(prior.state);
		const isLive = current !== undefined && LIVE_SESSION_STATES.has(current.state);
		if (!wasLive && isLive && current) {
			const cardId = baseTaskId(key, current);
			const title = after.get(cardId)?.title ?? cardId;
			const model = current.modelId ? ` (${current.modelId})` : "";
			push("session_started", cardId, `model started on ${title}${model}`);
			continue;
		}
		// Only a session we SAW live may tick its death. `prior === undefined` used to tick too ("appeared dead
		// between polls = news") — but on page load the board snapshot hydrates BEFORE the sessions map, so every
		// historical terminal session "first appeared" and replayed as fresh activity (live-found 2026-07-11:
		// 23 spurious "session interrupted" lines stamped at load time — exactly the §5.BF replay concern). A
		// genuinely-dying live session still ticks (running/queued -> failed/interrupted), and the SERVER digest
		// independently reports real failures, so dropping the appear-as-terminal tick loses no real news.
		if (current && prior !== undefined && prior.state !== current.state && LIVE_SESSION_STATES.has(prior.state)) {
			const endedLabel = ENDED_SESSION_LABEL[current.state];
			if (endedLabel) {
				const cardId = baseTaskId(key, current);
				const title = after.get(cardId)?.title ?? cardId;
				push("session_ended", cardId, `${endedLabel}: ${title}`);
			}
		}
	}
	return ticks;
}

/** Keep at most this many ticks in the live feed (older activity ages out of the chat). */
export const ACTIVITY_TICK_LIMIT = 60;

/** Append fresh ticks to the feed, trimming to the cap from the front (oldest out). */
export function appendActivityTicks(feed: readonly ActivityTick[], fresh: readonly ActivityTick[]): ActivityTick[] {
	if (fresh.length === 0) {
		return [...feed];
	}
	const merged = [...feed, ...fresh];
	return merged.length > ACTIVITY_TICK_LIMIT ? merged.slice(merged.length - ACTIVITY_TICK_LIMIT) : merged;
}
