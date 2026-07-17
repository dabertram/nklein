import type { RuntimeWorkspaceStateResponse } from "./api-contract";
import { type BoardStreamMemberState, type BoardStreamsSummary, summarizeBoardStreams } from "./board-streams-summary";
import {
	buildOperatorBoardSummary,
	mapSessionSummaryToOperatorSignals,
	type OperatorBoardSummary,
	type OperatorColumnId,
	type OperatorInboxTask,
	type OperatorSessionSummaryView,
	type OperatorSignalOverrides,
	type OperatorTaskSignals,
} from "./operator-task-state";

/** Default staleness window for the stream rollup on the pull path — a stream quiet longer than this reads `stale`. */
const DEFAULT_STREAM_STALENESS_MS = 600_000;

export type { OperatorBoardSummary, OperatorSignalOverrides } from "./operator-task-state";
// F12.52: the prioritized "Needs you" queue over the inbox (the web header popover + any notifier read this).
export { buildNeedsYouQueue, type NeedsYouQueueEntry } from "./operator-task-state";

/**
 * The minimal board shape the rollup reads — columns of cards with an id and (optionally) the card's start-blocked
 * kind. Structurally a subset of both the runtime's `RuntimeBoardData` and the web-ui's `BoardData` (same
 * `RuntimeBoardColumnId` column ids, same `blockedKind` enum), so a caller passes either directly; kept inline so this
 * module stays a dependency-free pure bridge.
 */
export interface BoardHealthBoardView {
	columns: ReadonlyArray<{
		id: OperatorColumnId;
		cards: ReadonlyArray<{
			id: string;
			blockedKind?: OperatorTaskSignals["blockedKind"];
			/** The card's review state — a `parked` or `escalated` review is board state that needs the operator (§5.AW). */
			review?: { status?: string; escalated?: boolean } | null;
		}>;
	}>;
}

/**
 * §5.AG: derive the board-health rollup (healthy/stuck/risky/done counts + the risk/approval inbox) from a board +
 * its per-task session map. The single bridge from what the runtime + web-ui already hold onto the operator data
 * layer, so the `nklein task health` CLI and the web board-health header render the SAME tested rollup.
 *
 * Trash cards are excluded. A card with no live session maps to the `idle` session state (its column still drives
 * done/stuck/healthy). The off-summary signals (§5.L gate / §5.M ack / §5.S clarify / §5.A block) are not in the
 * board state; a caller that has them (e.g. from gate/clarify subsystems) supplies them via `resolveOverrides`.
 */
export function summarizeBoardHealth(
	board: BoardHealthBoardView,
	sessions: Record<string, OperatorSessionSummaryView>,
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides,
): OperatorBoardSummary {
	const tasks: OperatorInboxTask[] = [];
	for (const column of board.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			const summary = sessions[card.id] ?? { state: "idle" as const };
			// The card's own `blockedKind` is board state — fold it into the signals (a caller override wins if it also
			// supplies one), so a sandbox-unavailable card reads `risky` and a needs-decomposition card reads `stuck`
			// straight from the board, without waiting on the §5.L/§5.S/§5.M subsystems to expose per-task state.
			// A card the review ladder PARKED (gave up → held for a human) or ESCALATED to the user is board state that needs
			// the operator — fold it in so a parked/escalated card reads `risky` + lands in the inbox straight from the board
			// (a caller override still wins). §5.AW.
			const escalatedToOperator = card.review?.status === "parked" || card.review?.escalated === true;
			const overrides: OperatorSignalOverrides = {
				...(card.blockedKind ? { blockedKind: card.blockedKind } : {}),
				...(escalatedToOperator ? { escalatedToOperator: true } : {}),
				...resolveOverrides?.(card.id),
			};
			tasks.push({
				taskId: card.id,
				signals: mapSessionSummaryToOperatorSignals(summary, column.id, overrides),
			});
		}
	}
	return buildOperatorBoardSummary(tasks);
}

/** Convenience over {@link summarizeBoardHealth} for a full `RuntimeWorkspaceStateResponse` (the CLI/tRPC path). */
export function summarizeWorkspaceBoardHealth(
	state: RuntimeWorkspaceStateResponse,
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides,
): OperatorBoardSummary {
	return summarizeBoardHealth(state.board, state.sessions, resolveOverrides);
}

/**
 * §5.AU: the per-stream overview for a full workspace state — the `get_streams` pull path. Mirrors
 * {@link summarizeWorkspaceBoardHealth}: builds each non-trash card's live operator signals (from its session summary +
 * column) and its last-activity time, then composes {@link summarizeBoardStreams}. A card with no live session is still
 * a stream member (its column drives the rollup); trash cards are excluded.
 */
export function summarizeWorkspaceBoardStreams(
	state: RuntimeWorkspaceStateResponse,
	options: { now: number; stalenessMs?: number },
): BoardStreamsSummary {
	const cards: { id: string; streamId?: string }[] = [];
	const taskState: Record<string, BoardStreamMemberState> = {};
	for (const column of state.board.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			cards.push(card.streamId ? { id: card.id, streamId: card.streamId } : { id: card.id });
			const summary = state.sessions[card.id];
			if (summary) {
				taskState[card.id] = {
					signals: mapSessionSummaryToOperatorSignals(summary, column.id, {}),
					lastActivityAt: summary.lastOutputAt ?? summary.updatedAt ?? options.now,
				};
			}
		}
	}
	return summarizeBoardStreams({
		streams: state.board.streams ?? [],
		cards,
		taskState,
		now: options.now,
		stalenessMs: options.stalenessMs ?? DEFAULT_STREAM_STALENESS_MS,
	});
}
