import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { createEmptyBoard, normalizeRuntimeBoardData } from "../../../src/state/runtime-board-normalization";

const CANONICAL = ["backlog", "planning", "in_progress", "review", "completed", "trash"];

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
	it("has the six canonical columns in order, with no cards or dependencies", () => {
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
});
