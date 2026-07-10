import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { resolveReadyLaneMoves } from "../../../src/core/ready-lane-reconcile.js";

function card(id: string): {
	id: string;
	title: string;
	prompt: string;
	startInPlanMode: boolean;
	baseRef: string;
	createdAt: number;
	updatedAt: number;
} {
	return { id, title: id, prompt: id, startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 };
}

function board(
	cardsByColumn: Partial<Record<string, string[]>>,
	dependencies: Array<{ fromTaskId: string; toTaskId: string }> = [],
): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "ready", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({ id, title: id, cards: (cardsByColumn[id] ?? []).map(card) })),
		dependencies,
	} as RuntimeBoardData;
}

const NONE = new Set<string>();

describe("resolveReadyLaneMoves", () => {
	it("promotes a dep-free, session-less planning card to ready", () => {
		const moves = resolveReadyLaneMoves({ board: board({ planning: ["a"] }), activeSessionTaskIds: NONE });
		expect(moves).toEqual([{ taskId: "a", from: "planning", to: "ready" }]);
	});

	it("leaves a planning card that has a live session (being decomposed/worked)", () => {
		const moves = resolveReadyLaneMoves({ board: board({ planning: ["a"] }), activeSessionTaskIds: new Set(["a"]) });
		expect(moves).toEqual([]);
	});

	it("leaves a planning card that is mid-start (race guard)", () => {
		const moves = resolveReadyLaneMoves({
			board: board({ planning: ["a"] }),
			activeSessionTaskIds: NONE,
			pendingStartTaskIds: new Set(["a"]),
		});
		expect(moves).toEqual([]);
	});

	it("leaves a planning card whose dependency is not yet completed", () => {
		// a depends on b; b is not in completed ⇒ a is still blocked.
		const moves = resolveReadyLaneMoves({
			board: board({ planning: ["a", "b"] }, [{ fromTaskId: "a", toTaskId: "b" }]),
			activeSessionTaskIds: NONE,
		});
		// b is dep-free and promotes; a stays blocked.
		expect(moves).toEqual([{ taskId: "b", from: "planning", to: "ready" }]);
	});

	it("promotes a planning card once its dependency reaches completed", () => {
		const moves = resolveReadyLaneMoves({
			board: board({ planning: ["a"], completed: ["b"] }, [{ fromTaskId: "a", toTaskId: "b" }]),
			activeSessionTaskIds: NONE,
		});
		expect(moves).toEqual([{ taskId: "a", from: "planning", to: "ready" }]);
	});

	it("advances a ready card to in_progress once it gains a session", () => {
		const moves = resolveReadyLaneMoves({ board: board({ ready: ["a"] }), activeSessionTaskIds: new Set(["a"]) });
		expect(moves).toEqual([{ taskId: "a", from: "ready", to: "in_progress" }]);
	});

	it("falls a ready card back to planning if it becomes re-blocked", () => {
		const moves = resolveReadyLaneMoves({
			board: board({ ready: ["a"], planning: ["b"] }, [{ fromTaskId: "a", toTaskId: "b" }]),
			activeSessionTaskIds: NONE,
		});
		// a re-blocked → planning; b dep-free → ready.
		expect(moves).toContainEqual({ taskId: "a", from: "ready", to: "planning" });
		expect(moves).toContainEqual({ taskId: "b", from: "planning", to: "ready" });
	});

	it("never auto-promotes a backlog card", () => {
		const moves = resolveReadyLaneMoves({ board: board({ backlog: ["a"] }), activeSessionTaskIds: NONE });
		expect(moves).toEqual([]);
	});

	it("is stable (no moves) when a ready card is dep-free and unstarted — it waits there", () => {
		const moves = resolveReadyLaneMoves({ board: board({ ready: ["a"] }), activeSessionTaskIds: NONE });
		expect(moves).toEqual([]);
	});
});
