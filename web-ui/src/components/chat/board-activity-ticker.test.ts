import { describe, expect, it } from "vitest";
import {
	ACTIVITY_TICK_LIMIT,
	type ActivityTick,
	appendActivityTicks,
	type BoardActivitySnapshot,
	diffBoardActivity,
} from "@/components/chat/board-activity-ticker";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumn } from "@/types";

function card(id: string, overrides: Partial<BoardCard> = {}): BoardCard {
	return { id, title: `Card ${id}`, description: "", createdAt: 1, updatedAt: 1, ...overrides } as BoardCard;
}

function column(id: string, cards: BoardCard[]): BoardColumn {
	return { id, title: id, cards } as BoardColumn;
}

function session(taskId: string, state: RuntimeTaskSessionSummary["state"], modelId?: string) {
	return { taskId, state, modelId } as RuntimeTaskSessionSummary;
}

function snapshot(columns: BoardColumn[], sessions: Record<string, RuntimeTaskSessionSummary> = {}) {
	return { columns, sessions } satisfies BoardActivitySnapshot;
}

describe("diffBoardActivity (§5.BB chat activity ticks)", () => {
	it("seeds silently on the first snapshot (no page-load replay)", () => {
		expect(diffBoardActivity(null, snapshot([column("in_progress", [card("a")])]), 1000)).toEqual([]);
	});

	it("ticks column arrivals for the meaningful lanes and stays quiet for backlog shuffles", () => {
		const before = snapshot([column("backlog", [card("a"), card("b")]), column("review", [])]);
		const after = snapshot([column("backlog", [card("b")]), column("review", [card("a")])]);
		const ticks = diffBoardActivity(before, after, 2000);
		expect(ticks).toEqual([
			{ id: "2000:card_moved:a", at: 2000, kind: "card_moved", cardId: "a", label: "Card a → review" },
		]);
		// backlog → planning (an unlisted lane) is noise, not activity
		const planning = diffBoardActivity(
			snapshot([column("backlog", [card("b")]), column("planning", [])]),
			snapshot([column("backlog", []), column("planning", [card("b")])]),
			3000,
		);
		expect(planning).toEqual([]);
	});

	it("ticks new cards, fresh blocks, session starts (with model) and failed/interrupted ends", () => {
		const before = snapshot([column("in_progress", [card("a")])], { a: session("a", "queued") });
		const after = snapshot([column("in_progress", [card("a", { blockedKind: "needs_decomposition" }), card("b")])], {
			a: session("a", "running", "qwop4b-a"),
			"b::review": session("b", "failed"),
		});
		const ticks = diffBoardActivity(before, after, 5000);
		expect(ticks.map((tick) => tick.label)).toEqual([
			"Card a blocked (needs_decomposition)",
			"new card: Card b",
			"session failed: Card b",
		]);
		// queued was already live ⇒ queued→running is NOT a second "model started"
		expect(ticks.some((tick) => tick.kind === "session_started")).toBe(false);
		const started = diffBoardActivity(
			snapshot([column("in_progress", [card("a")])]),
			snapshot([column("in_progress", [card("a")])], { a: session("a", "running", "qwop4b-a") }),
			6000,
		);
		expect(started).toEqual([
			{
				id: "6000:session_started:a",
				at: 6000,
				kind: "session_started",
				cardId: "a",
				label: "model started on Card a (qwop4b-a)",
			},
		]);
	});

	it("appendActivityTicks caps the feed from the front", () => {
		const feed: ActivityTick[] = Array.from({ length: ACTIVITY_TICK_LIMIT }, (_, index) => ({
			id: `t${index}`,
			at: index,
			kind: "card_moved",
			cardId: "a",
			label: `tick ${index}`,
		}));
		const appended = appendActivityTicks(feed, [
			{ id: "fresh", at: 999, kind: "card_moved", cardId: "a", label: "fresh" },
		]);
		expect(appended).toHaveLength(ACTIVITY_TICK_LIMIT);
		expect(appended[0]?.id).toBe("t1");
		expect(appended.at(-1)?.id).toBe("fresh");
	});
});
