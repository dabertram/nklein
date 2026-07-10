import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { createEmptyBoard, normalizeRuntimeBoardData } from "../../../src/state/runtime-board-normalization";

const CANONICAL = ["backlog", "planning", "ready", "in_progress", "review", "completed", "trash"];

// The normalizer only reads column.id, column.cards, and card.id — minimal shapes suffice.
const board = (
	columns: Array<{ id: string; cards: string[] }>,
	dependencies: RuntimeBoardData["dependencies"] = [],
): RuntimeBoardData =>
	({
		columns: columns.map((c) => ({ id: c.id, title: c.id, cards: c.cards.map((id) => ({ id, title: id })) })),
		dependencies,
	}) as unknown as RuntimeBoardData;

describe("createEmptyBoard", () => {
	it("has the seven canonical columns in order (incl. the Ready lane), with no cards or dependencies", () => {
		const result = createEmptyBoard();
		expect(result.columns.map((c) => c.id)).toEqual(CANONICAL);
		expect(result.columns.every((c) => c.cards.length === 0)).toBe(true);
		expect(result.dependencies).toEqual([]);
	});
});

describe("normalizeRuntimeBoardData", () => {
	it("rebuilds the canonical column order regardless of input order", () => {
		const result = normalizeRuntimeBoardData(
			board([
				{ id: "review", cards: [] },
				{ id: "backlog", cards: [] },
			]),
		);
		expect(result.columns.map((c) => c.id)).toEqual(CANONICAL);
	});

	it("redistributes cards into the column matching their id", () => {
		const result = normalizeRuntimeBoardData(
			board([
				{ id: "review", cards: ["r1"] },
				{ id: "backlog", cards: ["b1", "b2"] },
			]),
		);
		expect(result.columns.find((c) => c.id === "backlog")?.cards.map((c) => c.id)).toEqual(["b1", "b2"]);
		expect(result.columns.find((c) => c.id === "review")?.cards.map((c) => c.id)).toEqual(["r1"]);
	});

	it("drops cards belonging to an unknown column", () => {
		const result = normalizeRuntimeBoardData(
			board([
				{ id: "bogus", cards: ["x1", "x2"] },
				{ id: "backlog", cards: ["b1"] },
			]),
		);
		expect(result.columns.flatMap((c) => c.cards.map((card) => card.id))).toEqual(["b1"]);
	});

	it("passes the dependencies array through unchanged", () => {
		const dependencies = [] as RuntimeBoardData["dependencies"];
		expect(normalizeRuntimeBoardData(board([], dependencies)).dependencies).toBe(dependencies);
	});

	it("migrates an old board that predates the Ready lane by injecting an empty Ready column (todo 11116)", () => {
		const legacy = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [{ id: "p1" } as never] },
				{ id: "in_progress", title: "In Progress", cards: [{ id: "w1" } as never] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};
		const normalized = normalizeRuntimeBoardData(legacy as never);
		const ids = normalized.columns.map((c) => c.id);
		expect(ids).toEqual(CANONICAL);
		const ready = normalized.columns.find((c) => c.id === "ready");
		expect(ready?.cards).toHaveLength(0);
		// existing cards are preserved in their lanes.
		expect(normalized.columns.find((c) => c.id === "planning")?.cards).toHaveLength(1);
		expect(normalized.columns.find((c) => c.id === "in_progress")?.cards).toHaveLength(1);
	});
});
