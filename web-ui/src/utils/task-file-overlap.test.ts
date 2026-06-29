import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardData } from "@/types";
import {
	getBoardActiveTaskCardsForFileOverlap,
	getSessionActiveTaskCardsForFileOverlap,
	hasLikelyTouchedFileOverlap,
	tasksHaveLikelyTouchedFileOverlap,
} from "./task-file-overlap";

const card = (id: string, filesLikelyTouched?: string[]): BoardCard => ({ id, filesLikelyTouched }) as BoardCard;
const session = (taskId: string, state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary =>
	({ taskId, state }) as RuntimeTaskSessionSummary;

describe("tasksHaveLikelyTouchedFileOverlap", () => {
	it("detects an overlap, normalizing case and leading ./", () => {
		expect(tasksHaveLikelyTouchedFileOverlap(card("a", ["./Src/A.ts"]), card("b", ["src/a.ts"]))).toBe(true);
	});
	it("returns false with no shared path or when either side is empty", () => {
		expect(tasksHaveLikelyTouchedFileOverlap(card("a", ["src/a.ts"]), card("b", ["src/b.ts"]))).toBe(false);
		expect(tasksHaveLikelyTouchedFileOverlap(card("a", []), card("b", ["src/a.ts"]))).toBe(false);
		expect(tasksHaveLikelyTouchedFileOverlap(card("a", ["  "]), card("b", ["src/a.ts"]))).toBe(false);
	});
});

describe("hasLikelyTouchedFileOverlap", () => {
	it("finds an overlap among other cards, ignoring the task itself", () => {
		const task = card("t", ["src/a.ts"]);
		expect(hasLikelyTouchedFileOverlap(task, [card("t", ["src/a.ts"]), card("x", ["src/b.ts"])])).toBe(false);
		expect(hasLikelyTouchedFileOverlap(task, [card("y", ["SRC/A.ts"])])).toBe(true);
	});
});

describe("getBoardActiveTaskCardsForFileOverlap", () => {
	const board: BoardData = {
		columns: [
			{ id: "backlog", cards: [card("b1")] },
			{ id: "in_progress", cards: [card("p1"), card("p2")] },
			{ id: "review", cards: [card("r1")] },
		],
	} as BoardData;

	it("returns only in_progress/review cards, minus excluded ids", () => {
		expect(getBoardActiveTaskCardsForFileOverlap(board).map((c) => c.id)).toEqual(["p1", "p2", "r1"]);
		expect(getBoardActiveTaskCardsForFileOverlap(board, new Set(["p1"])).map((c) => c.id)).toEqual(["p2", "r1"]);
	});
});

describe("getSessionActiveTaskCardsForFileOverlap", () => {
	const board: BoardData = {
		columns: [{ id: "in_progress", cards: [card("t1"), card("t2")] }],
	} as BoardData;

	it("collects cards for active sessions (queued/running/awaiting_review), skipping inactive + excluded", () => {
		const sessions = {
			t1: session("t1", "running"),
			t2: session("t2", "idle"), // inactive ⇒ skipped
		};
		expect(getSessionActiveTaskCardsForFileOverlap(board, sessions).map((c) => c.id)).toEqual(["t1"]);
		expect(getSessionActiveTaskCardsForFileOverlap(board, { t1: session("t1", "running") }, new Set(["t1"]))).toEqual(
			[],
		);
	});
});
