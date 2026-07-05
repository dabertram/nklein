import { describe, expect, it } from "vitest";
import type { RuntimeStream } from "../../../src/core/board-api-contract";
import {
	type BoardStreamMemberState,
	type BoardStreamsSummary,
	renderBoardStreamsSummary,
	summarizeBoardStreams,
	toStreamOverviewRows,
} from "../../../src/core/board-streams-summary";
import type { OperatorTaskSignals } from "../../../src/core/operator-task-state";

function signals(over: Partial<OperatorTaskSignals> = {}): OperatorTaskSignals {
	return {
		sessionState: "running",
		columnId: "in_progress",
		paused: false,
		heartbeatLost: false,
		blockedKind: null,
		awaitingHostActionAck: false,
		deliveryGateHeld: false,
		clarifyingQuestionPending: false,
		noProgressOrLoop: false,
		approachingBudgetCeiling: false,
		escalatedToOperator: false,
		...over,
	};
}

const NOW = 1_000_000;
const state = (s: Partial<OperatorTaskSignals>, lastActivityAt = NOW): BoardStreamMemberState => ({
	signals: signals(s),
	lastActivityAt,
});

const stream = (id: string, title: string): RuntimeStream => ({
	id,
	title,
	source: "decomposition",
	createdAt: 1,
	updatedAt: 1,
});

describe("summarizeBoardStreams", () => {
	it("groups cards by streamId and rolls each stream up (worst-signal badge)", () => {
		const result = summarizeBoardStreams({
			streams: [stream("s1", "Auth"), stream("s2", "Billing")],
			cards: [
				{ id: "a", streamId: "s1" },
				{ id: "b", streamId: "s1" },
				{ id: "c", streamId: "s2" },
			],
			taskState: {
				a: state({ columnId: "completed" }), // done
				b: state({ deliveryGateHeld: true }), // risky ⇒ s1 blocked
				c: state({ sessionState: "running" }), // healthy
			},
			now: NOW,
			stalenessMs: 60_000,
		});

		const s1 = result.streams.find((x) => x.stream.id === "s1");
		expect(s1?.memberTaskIds).toEqual(["a", "b"]);
		expect(s1?.rollup.health).toBe("blocked"); // b is ASK-blocked even though a is done
		expect(s1?.rollup.progress).toEqual({ done: 1, total: 2, method: "card_count" });

		const s2 = result.streams.find((x) => x.stream.id === "s2");
		expect(s2?.rollup.health).toBe("on_track");
		expect(s2?.rollup.frontierTaskIds).toEqual(["c"]);
	});

	it("reports cards with no (or an unknown) streamId as ungrouped", () => {
		const result = summarizeBoardStreams({
			streams: [stream("s1", "Auth")],
			cards: [
				{ id: "a", streamId: "s1" },
				{ id: "loose" },
				{ id: "orphan", streamId: "gone" }, // names no known stream
			],
			taskState: { a: state({ sessionState: "running" }) },
			now: NOW,
			stalenessMs: 60_000,
		});
		expect(result.ungroupedCardIds).toEqual(["loose", "orphan"]);
		expect(result.streams[0]?.memberTaskIds).toEqual(["a"]);
	});

	it("preserves the input stream order and includes an empty stream", () => {
		const result = summarizeBoardStreams({
			streams: [stream("s2", "B"), stream("s1", "A")],
			cards: [{ id: "a", streamId: "s1" }],
			taskState: { a: state({ sessionState: "running" }) },
			now: NOW,
			stalenessMs: 60_000,
		});
		expect(result.streams.map((x) => x.stream.id)).toEqual(["s2", "s1"]);
		expect(result.streams[0]?.rollup.health).toBe("empty"); // s2 has no members
	});

	it("a member missing from taskState still counts as membership but is skipped in the rollup", () => {
		const result = summarizeBoardStreams({
			streams: [stream("s1", "A")],
			cards: [
				{ id: "a", streamId: "s1" },
				{ id: "b", streamId: "s1" }, // no taskState entry
			],
			taskState: { a: state({ sessionState: "running" }) },
			now: NOW,
			stalenessMs: 60_000,
		});
		expect(result.streams[0]?.memberTaskIds).toEqual(["a", "b"]);
		// Only 'a' contributes to the rollup counts (1 healthy), 'b' is skipped (no signals).
		expect(result.streams[0]?.rollup.counts.healthy).toBe(1);
		expect(result.streams[0]?.rollup.progress.total).toBe(1);
	});
});

describe("renderBoardStreamsSummary", () => {
	it("renders one line per stream (title · health · done/total · running) + a loose-cards line", () => {
		const summary: BoardStreamsSummary = {
			streams: [
				{
					stream: stream("s1", "Auth"),
					memberTaskIds: ["a", "b"],
					rollup: {
						counts: { healthy: 1, stuck: 0, risky: 0, done: 1 },
						progress: { done: 1, total: 2, method: "card_count" },
						health: "on_track",
						lifecycle: "active",
						frontierTaskIds: ["b"],
						stale: false,
					},
				},
			],
			ungroupedCardIds: ["z"],
		};
		expect(renderBoardStreamsSummary(summary)).toBe(
			'Streams (1):\n"Auth" — on track · 1/2 done · running: 1\n(+1 card(s) not in any stream)',
		);
	});

	it("omits the running note when no card is running", () => {
		const summary: BoardStreamsSummary = {
			streams: [
				{
					stream: stream("s1", "Billing"),
					memberTaskIds: ["a"],
					rollup: {
						counts: { healthy: 0, stuck: 0, risky: 0, done: 1 },
						progress: { done: 1, total: 1, method: "card_count" },
						health: "done",
						lifecycle: "done",
						frontierTaskIds: [],
						stale: false,
					},
				},
			],
			ungroupedCardIds: [],
		};
		expect(renderBoardStreamsSummary(summary)).toBe('Streams (1):\n"Billing" — done · 1/1 done');
	});

	it("says there are no streams (with or without loose cards) when the board has none", () => {
		expect(renderBoardStreamsSummary({ streams: [], ungroupedCardIds: [] })).toBe("No streams on the board yet.");
		expect(renderBoardStreamsSummary({ streams: [], ungroupedCardIds: ["a", "b"] })).toBe(
			"No streams yet — 2 loose card(s) on the board.",
		);
	});
});

describe("toStreamOverviewRows", () => {
	it("flattens each stream to a lean row (id · title · health · done/total · running)", () => {
		const rows = toStreamOverviewRows({
			streams: [
				{
					stream: stream("s1", "Auth"),
					memberTaskIds: ["a", "b", "c"],
					rollup: {
						counts: { healthy: 1, stuck: 0, risky: 1, done: 1 },
						progress: { done: 1, total: 3, method: "card_count" },
						health: "at_risk",
						lifecycle: "active",
						frontierTaskIds: ["a", "b"],
						stale: false,
					},
				},
			],
			ungroupedCardIds: ["z"],
		});
		expect(rows).toEqual([{ id: "s1", title: "Auth", health: "at_risk", done: 1, total: 3, running: 2 }]);
	});

	it("returns no rows for a board with no streams", () => {
		expect(toStreamOverviewRows({ streams: [], ungroupedCardIds: ["a"] })).toEqual([]);
	});
});
