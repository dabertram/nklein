import { describe, expect, it } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import {
	listStartableUnstartedTaskIds,
	listUnmetDependencyTaskIds,
	resolveCardExecutionState,
} from "../../../src/core/task-board-ready-sweep";

function board(input: {
	planning?: string[];
	backlog?: string[];
	completed?: string[];
	deps?: Array<[from: string, to: string]>;
}): RuntimeBoardData {
	const toCards = (ids: string[] = []) =>
		ids.map((id) => ({ id, prompt: `do ${id}`, baseRef: "main", createdAt: 1, updatedAt: 1 }));
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: toCards(input.backlog) },
			{ id: "planning", title: "Planning", cards: toCards(input.planning) },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: toCards(input.completed) },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: (input.deps ?? []).map(([from, to], i) => ({
			id: `dep-${i}`,
			fromTaskId: from,
			toTaskId: to,
			createdAt: 1,
		})),
	} as unknown as RuntimeBoardData;
}

describe("listStartableUnstartedTaskIds (the ready-sweep — runs 12/14/15 stall class)", () => {
	it("finds the run15 shape: dependency-free planning cards no trigger ever attempted", () => {
		const b = board({
			planning: ["trend-classification", "test-score-clamping", "add-recommendation"],
			completed: ["clamp-score"],
			deps: [["add-recommendation", "trend-classification"]],
		});
		expect(listStartableUnstartedTaskIds(b, new Set())).toEqual(["trend-classification", "test-score-clamping"]);
	});

	it("a completed prerequisite releases its dependent; an incomplete one blocks it", () => {
		const b = board({
			planning: ["released", "blocked"],
			completed: ["done-prereq"],
			deps: [
				["released", "done-prereq"],
				["blocked", "released"],
			],
		});
		expect(listStartableUnstartedTaskIds(b, new Set())).toEqual(["released"]);
	});

	it("skips cards with a live session (started cards park in planning while running)", () => {
		const b = board({ planning: ["running-card", "waiting-card"] });
		expect(listStartableUnstartedTaskIds(b, new Set(["running-card"]))).toEqual(["waiting-card"]);
	});

	it("includes backlog cards and ignores non-waiting lanes", () => {
		const b = board({ backlog: ["queued-card"], completed: ["done"] });
		expect(listStartableUnstartedTaskIds(b, new Set())).toEqual(["queued-card"]);
	});

	it("returns empty on an empty/fully-blocked board", () => {
		expect(listStartableUnstartedTaskIds(board({}), new Set())).toEqual([]);
		const blocked = board({ planning: ["a"], deps: [["a", "ghost-incomplete"]] });
		expect(listStartableUnstartedTaskIds(blocked, new Set())).toEqual([]);
	});
});

describe("resolveCardExecutionState + listUnmetDependencyTaskIds (§5.AU relay facts)", () => {
	const b = board({
		planning: ["blocked-card", "ready-card", "live-card"],
		completed: ["finished"],
		deps: [
			["blocked-card", "ready-card"],
			["blocked-card", "finished"], // completed prerequisite — met, must not count
		],
	});

	it("maps live session / completed lane / unmet deps / waiting to running / done / blocked / ready", () => {
		const active = new Set(["live-card"]);
		expect(resolveCardExecutionState(b, active, "live-card")).toBe("running");
		expect(resolveCardExecutionState(b, active, "finished")).toBe("done");
		expect(resolveCardExecutionState(b, active, "blocked-card")).toBe("blocked");
		expect(resolveCardExecutionState(b, active, "ready-card")).toBe("ready");
		expect(resolveCardExecutionState(b, active, "never-existed")).toBeNull();
	});

	it("lists only the UNMET prerequisites (completed ones excluded)", () => {
		expect(listUnmetDependencyTaskIds(b, "blocked-card")).toEqual(["ready-card"]);
		expect(listUnmetDependencyTaskIds(b, "ready-card")).toEqual([]);
	});
});
