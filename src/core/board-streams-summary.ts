/**
 * §5.AU — compose a board into its per-STREAM overview: for each stream, the member cards + their rolled-up status
 * ({@link deriveStreamRollup}). Pure + deterministic (injected clock + per-task signals); no I/O. This is the data behind
 * the main chat's "stream overview surface" (one row per stream: title · health · progress · frontier) and the
 * `get_streams` pull tool — the "group altitude" the user drills from into cards → threads.
 *
 * Membership is read straight off `card.streamId` (the effective value the store already resolved: manual ?? derived),
 * so this composes cleanly over a persisted board without re-deriving. Cards with no `streamId` (or a `streamId` that
 * names no known stream) are reported as `ungroupedCardIds` — the "loose" cards the UI shows outside any stream.
 * Callers holding a raw board should resolve membership through {@link resolveEffectiveBoardStreamMembership}, which
 * adds the legacy-board `deriveStreams` fallback (audit 2026-08-12).
 */

import type { RuntimeBoardData, RuntimeStream } from "./board-api-contract";
import type { OperatorTaskSignals } from "./operator-task-state";
import { deriveStreams } from "./stream-derivation";
import { deriveStreamRollup, type StreamHealth, type StreamRollup } from "./stream-rollup";

/** The live state of a member card the rollup needs. */
export interface BoardStreamMemberState {
	signals: OperatorTaskSignals;
	/** Epoch ms of the card's last transition (for staleness). */
	lastActivityAt: number;
}

/** A board's EFFECTIVE stream state: persisted when present, else the pure derivation. Read-only projection. */
export interface EffectiveBoardStreamMembership {
	/** The board's streams — `board.streams` when non-empty, else the derived proposals materialized ephemerally. */
	streams: readonly RuntimeStream[];
	/** Non-trash cardId → effective streamId (persisted `card.streamId`, else the derived membership). */
	streamIdByCardId: Readonly<Record<string, string>>;
}

/**
 * Resolve a board's effective streams + card membership with the `deriveStreams` FALLBACK the tRPC message-target
 * index already uses (runtime-api.ts). Audit 2026-08-12: this module's consumers read ONLY the persisted
 * `board.streams` / `card.streamId`, so a legacy board (cards carrying `generatedFromPlan` but no `streamId`, or a
 * board whose streams were stripped by the pre-fix normalizer) reported every card ungrouped and every broadcast
 * target missing. Persisted values win per card; derivation runs over non-trash cards only (a trashed card is not a
 * live member and must not shape components). READ-ONLY — derived streams are an ephemeral projection (zeroed
 * timestamps), never written back to the board.
 */
export function resolveEffectiveBoardStreamMembership(board: RuntimeBoardData): EffectiveBoardStreamMembership {
	const nonTrashCards = board.columns.filter((column) => column.id !== "trash").flatMap((column) => column.cards);
	const derived = deriveStreams({
		cards: nonTrashCards.map((card) => ({
			id: card.id,
			title: card.title,
			planSlug: card.generatedFromPlan?.planSlug ?? null,
		})),
		dependencies: board.dependencies ?? [],
	});
	const streamIdByCardId: Record<string, string> = {};
	for (const card of nonTrashCards) {
		const streamId = card.streamId ?? derived.cardStreamId[card.id];
		if (streamId) {
			streamIdByCardId[card.id] = streamId;
		}
	}
	const streams: readonly RuntimeStream[] =
		board.streams && board.streams.length > 0
			? board.streams
			: derived.streams.map((stream) => ({ ...stream, createdAt: 0, updatedAt: 0 }));
	return { streams, streamIdByCardId };
}

export interface BoardStreamsSummaryInput {
	/** The board's streams (`board.streams ?? []`). */
	streams: readonly RuntimeStream[];
	/** Every card on the board (columns flattened) with its effective stream membership. */
	cards: readonly { id: string; streamId?: string }[];
	/** taskId → live state; a card with no entry is counted as a member but contributes no signals to the rollup. */
	taskState: Readonly<Record<string, BoardStreamMemberState>>;
	now: number;
	stalenessMs: number;
}

export interface BoardStreamSummary {
	stream: RuntimeStream;
	rollup: StreamRollup;
	memberTaskIds: readonly string[];
}

export interface BoardStreamsSummary {
	/** Per-stream overview, in `streams` input order. */
	streams: readonly BoardStreamSummary[];
	/** Cards not in any known stream (no `streamId`, or one that names no stream). */
	ungroupedCardIds: readonly string[];
}

/**
 * Build the per-stream overview. Pure; groups cards by `streamId`, rolls each stream up via {@link deriveStreamRollup},
 * and reports the loose (ungrouped) cards. A member card missing from `taskState` still counts toward the stream's
 * membership but is skipped in the rollup (no signals to classify).
 */
export function summarizeBoardStreams(input: BoardStreamsSummaryInput): BoardStreamsSummary {
	const streamIds = new Set(input.streams.map((stream) => stream.id));
	const membersByStream = new Map<string, string[]>();
	const ungroupedCardIds: string[] = [];

	for (const card of input.cards) {
		if (card.streamId && streamIds.has(card.streamId)) {
			const members = membersByStream.get(card.streamId) ?? [];
			members.push(card.id);
			membersByStream.set(card.streamId, members);
		} else {
			ungroupedCardIds.push(card.id);
		}
	}

	const streams = input.streams.map((stream): BoardStreamSummary => {
		const memberTaskIds = membersByStream.get(stream.id) ?? [];
		const members = memberTaskIds
			.map((taskId) => {
				const state = input.taskState[taskId];
				return state ? { taskId, signals: state.signals, lastActivityAt: state.lastActivityAt } : null;
			})
			.filter(
				(member): member is { taskId: string; signals: OperatorTaskSignals; lastActivityAt: number } =>
					member !== null,
			);
		return {
			stream,
			memberTaskIds,
			rollup: deriveStreamRollup({ members, now: input.now, stalenessMs: input.stalenessMs }),
		};
	});

	return { streams, ungroupedCardIds };
}

const STREAM_HEALTH_LABEL: Record<StreamHealth, string> = {
	on_track: "on track",
	stale: "stale",
	at_risk: "at risk",
	blocked: "blocked",
	done: "done",
	empty: "empty",
};

/**
 * Render a {@link BoardStreamsSummary} into a compact, scannable text block for the `get_streams` pull tool — one line
 * per stream (title · health · done/total · running count), plus a trailing loose-cards line. Pure; the SAME data the
 * UI stream-overview surface renders. Never empty (a board with no streams says so).
 */
export function renderBoardStreamsSummary(summary: BoardStreamsSummary): string {
	const lines: string[] = summary.streams.map((entry) => {
		const { rollup } = entry;
		const running = rollup.frontierTaskIds.length;
		const runningNote = running > 0 ? ` · running: ${running}` : "";
		return `"${entry.stream.title}" — ${STREAM_HEALTH_LABEL[rollup.health]} · ${rollup.progress.done}/${rollup.progress.total} done${runningNote}`;
	});
	if (summary.ungroupedCardIds.length > 0) {
		lines.push(`(+${summary.ungroupedCardIds.length} card(s) not in any stream)`);
	}
	if (summary.streams.length === 0) {
		return summary.ungroupedCardIds.length > 0
			? `No streams yet — ${summary.ungroupedCardIds.length} loose card(s) on the board.`
			: "No streams on the board yet.";
	}
	return `Streams (${summary.streams.length}):\n${lines.join("\n")}`;
}

/** One lean stream row for the §5.AU stream-overview surface — the serializable projection the chat API returns. */
export interface BoardStreamOverviewRow {
	id: string;
	title: string;
	health: StreamHealth;
	done: number;
	total: number;
	/** How many of the stream's cards are running right now. */
	running: number;
}

/**
 * Flatten a {@link BoardStreamsSummary} into lean, serializable overview rows (drops the per-card member lists + the full
 * rollup, keeping just what the stream-overview UI shows). Pure; the chat API wraps these + `ungroupedCardIds.length`.
 */
export function toStreamOverviewRows(summary: BoardStreamsSummary): BoardStreamOverviewRow[] {
	return summary.streams.map((entry) => ({
		id: entry.stream.id,
		title: entry.stream.title,
		health: entry.rollup.health,
		done: entry.rollup.progress.done,
		total: entry.rollup.progress.total,
		running: entry.rollup.frontierTaskIds.length,
	}));
}
