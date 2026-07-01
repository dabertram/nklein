/**
 * §5.AU — compose a board into its per-STREAM overview: for each stream, the member cards + their rolled-up status
 * ({@link deriveStreamRollup}). Pure + deterministic (injected clock + per-task signals); no I/O. This is the data behind
 * the main chat's "stream overview surface" (one row per stream: title · health · progress · frontier) and the
 * `get_streams` pull tool — the "group altitude" the user drills from into cards → threads.
 *
 * Membership is read straight off `card.streamId` (the effective value the store already resolved: manual ?? derived),
 * so this composes cleanly over a persisted board without re-deriving. Cards with no `streamId` (or a `streamId` that
 * names no known stream) are reported as `ungroupedCardIds` — the "loose" cards the UI shows outside any stream.
 */

import type { RuntimeStream } from "./board-api-contract";
import type { OperatorTaskSignals } from "./operator-task-state";
import { deriveStreamRollup, type StreamRollup } from "./stream-rollup";

/** The live state of a member card the rollup needs. */
export interface BoardStreamMemberState {
	signals: OperatorTaskSignals;
	/** Epoch ms of the card's last transition (for staleness). */
	lastActivityAt: number;
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
