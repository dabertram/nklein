import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import { reconcileOrphanedInProgressCards } from "../../../src/core/startup-orphan-reconcile";

function card(id: string): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `do ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	} as RuntimeBoardCard;
}

function board(byColumn: Partial<Record<string, string[]>>): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({ id, title: id, cards: (byColumn[id] ?? []).map(card) })),
		dependencies: [],
	} as RuntimeBoardData;
}

function lane(b: RuntimeBoardData, columnId: string): string[] {
	return (b.columns.find((column) => column.id === columnId)?.cards ?? []).map((c) => c.id);
}

describe("reconcileOrphanedInProgressCards (§5.0.5 W2.2 startup crash-recovery)", () => {
	it("parks in_progress cards with NO live session into Review (the lying-board fix)", () => {
		const result = reconcileOrphanedInProgressCards({
			board: board({ in_progress: ["a", "b"], planning: ["c"] }),
			liveSessionTaskIds: new Set(), // fresh startup — no sessions
			now: 100,
		});
		expect(result.parkedTaskIds).toEqual(["a", "b"]);
		expect(lane(result.board, "review")).toEqual(["a", "b"]);
		expect(lane(result.board, "in_progress")).toEqual([]);
		expect(lane(result.board, "planning")).toEqual(["c"]); // planning survives in place
	});

	it("leaves an in_progress card that STILL has a live session (a real resume) untouched", () => {
		const result = reconcileOrphanedInProgressCards({
			board: board({ in_progress: ["live", "orphan"] }),
			liveSessionTaskIds: new Set(["live"]),
			now: 100,
		});
		expect(result.parkedTaskIds).toEqual(["orphan"]);
		expect(lane(result.board, "in_progress")).toEqual(["live"]);
		expect(lane(result.board, "review")).toEqual(["orphan"]);
	});

	it("is a no-op after a clean shutdown already parked everything (nothing in in_progress)", () => {
		const b = board({ review: ["done-attention"], planning: ["queued"] });
		const result = reconcileOrphanedInProgressCards({ board: b, liveSessionTaskIds: new Set(), now: 100 });
		expect(result.parkedTaskIds).toEqual([]);
		expect(result.board).toBe(b); // untouched reference
	});
});
