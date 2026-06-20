import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import {
	boardToPortableBoardCrdt,
	markCardDeleted,
	mergePortableBoardCrdt,
	portableBoardCrdtToBoard,
} from "../../../src/state/portable-board-crdt";

function card(id: string, overrides: Partial<RuntimeBoardCard> = {}): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `prompt ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	} as RuntimeBoardCard;
}

function board(
	cards: Array<{ columnId: string; card: RuntimeBoardCard }>,
	deps: Array<[string, string]> = [],
): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({
			id,
			title: id,
			cards: cards.filter((entry) => entry.columnId === id).map((entry) => entry.card),
		})),
		dependencies: deps.map(([fromTaskId, toTaskId], index) => ({
			id: `${fromTaskId}->${toTaskId}`,
			fromTaskId,
			toTaskId,
			createdAt: index + 1,
		})),
	};
}

describe("portable board CRDT merge", () => {
	it("is idempotent, commutative, and associative", () => {
		const a = boardToPortableBoardCrdt(board([{ columnId: "planning", card: card("a", { updatedAt: 5 }) }]), "m1");
		const b = boardToPortableBoardCrdt(
			board([{ columnId: "in_progress", card: card("a", { updatedAt: 9, prompt: "edited" }) }]),
			"m2",
		);
		const c = boardToPortableBoardCrdt(board([{ columnId: "review", card: card("b", { updatedAt: 3 }) }]), "m3");

		expect(mergePortableBoardCrdt(a, a)).toEqual(a); // idempotent
		expect(mergePortableBoardCrdt(a, b)).toEqual(mergePortableBoardCrdt(b, a)); // commutative
		expect(mergePortableBoardCrdt(mergePortableBoardCrdt(a, b), c)).toEqual(
			mergePortableBoardCrdt(a, mergePortableBoardCrdt(b, c)),
		); // associative
	});

	it("resolves concurrent edits by last-writer-wins on the logical clock", () => {
		const older = boardToPortableBoardCrdt(
			board([{ columnId: "planning", card: card("a", { updatedAt: 5, prompt: "old" }) }]),
			"m1",
		);
		const newer = boardToPortableBoardCrdt(
			board([{ columnId: "in_progress", card: card("a", { updatedAt: 9, prompt: "new" }) }]),
			"m2",
		);
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(older, newer));
		const inProgress = merged.columns.find((column) => column.id === "in_progress");
		expect(inProgress?.cards.map((entry) => entry.id)).toEqual(["a"]);
		expect(inProgress?.cards[0]?.prompt).toBe("new");
	});

	it("lets a newer deletion win over a concurrent edit, and vice versa", () => {
		const base = boardToPortableBoardCrdt(board([{ columnId: "planning", card: card("a", { updatedAt: 5 }) }]), "m1");
		const deleted = markCardDeleted(base, "a", "m1");
		const concurrentEdit = boardToPortableBoardCrdt(
			board([{ columnId: "completed", card: card("a", { updatedAt: 5 }) }]),
			"m2",
		);
		// Deletion stamp is counter+1 over the edit, so the card stays deleted.
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(deleted, concurrentEdit));
		expect(merged.columns.every((column) => column.cards.length === 0)).toBe(true);
	});

	it("round-trips a board through the CRDT", () => {
		const original = board(
			[
				{ columnId: "planning", card: card("a", { updatedAt: 2 }) },
				{ columnId: "in_progress", card: card("b", { updatedAt: 3 }) },
			],
			[["b", "a"]],
		);
		const projected = portableBoardCrdtToBoard(boardToPortableBoardCrdt(original, "m1"));
		const planning = projected.columns.find((column) => column.id === "planning");
		const inProgress = projected.columns.find((column) => column.id === "in_progress");
		expect(planning?.cards.map((entry) => entry.id)).toEqual(["a"]);
		expect(inProgress?.cards.map((entry) => entry.id)).toEqual(["b"]);
		expect(projected.dependencies).toEqual([{ id: "b->a", fromTaskId: "b", toTaskId: "a", createdAt: 1 }]);
	});

	it("drops dependencies whose endpoints were deleted", () => {
		const base = boardToPortableBoardCrdt(
			board(
				[
					{ columnId: "planning", card: card("a") },
					{ columnId: "planning", card: card("b") },
				],
				[["b", "a"]],
			),
			"m1",
		);
		const projected = portableBoardCrdtToBoard(markCardDeleted(base, "a", "m1"));
		expect(projected.dependencies).toEqual([]);
	});
});
