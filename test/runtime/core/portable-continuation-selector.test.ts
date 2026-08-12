import { describe, expect, it } from "vitest";
import type {
	RuntimeBoardCard,
	RuntimeBoardColumn,
	RuntimeBoardData,
	RuntimeBoardDependency,
} from "../../../src/core/board-api-contract";
import {
	type CardContinuation,
	type ContinuationDisposition,
	classifyCardContinuation,
	selectContinuationPoints,
} from "../../../src/core/portable-continuation-selector";
import type { RuntimeBoardColumnId } from "../../../src/core/runtime-config-api-contract";

// ---- fixtures (all plain injected values; nothing read from disk) ----------------------------------------------

function card(id: string, overrides: Partial<RuntimeBoardCard> = {}): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `do ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	} as RuntimeBoardCard;
}

function column(id: RuntimeBoardColumnId, cards: RuntimeBoardCard[]): RuntimeBoardColumn {
	return { id, title: id, cards };
}

// Board edge semantics (task-board-mutations): `fromTaskId` DEPENDS ON `toTaskId` — dep("b", "a") means b needs a
// done first. This file used to encode the inverted reading; un-bent with the selector fix (audit 2026-08-12).
function dep(fromTaskId: string, toTaskId: string): RuntimeBoardDependency {
	return { id: `${fromTaskId}->${toTaskId}`, fromTaskId, toTaskId, createdAt: 1 };
}

function board(columns: RuntimeBoardColumn[], dependencies: RuntimeBoardDependency[] = []): RuntimeBoardData {
	return { columns, dependencies };
}

function byId(selection: { perCard: CardContinuation[] }, id: string): CardContinuation {
	const found = selection.perCard.find((entry) => entry.taskId === id);
	if (!found) {
		throw new Error(`no continuation for ${id}`);
	}
	return found;
}

// ---- classifyCardContinuation (per-card rule) -------------------------------------------------------------------

describe("classifyCardContinuation", () => {
	const noDeps = { unsatisfiedDependencies: [] as string[] };

	it("terminal lanes are done with the matching reason", () => {
		expect(classifyCardContinuation({ card: card("a"), columnId: "completed" }, noDeps)).toMatchObject({
			disposition: "done",
			reason: "terminal_completed",
		});
		expect(classifyCardContinuation({ card: card("a"), columnId: "trash" }, noDeps)).toMatchObject({
			disposition: "done",
			reason: "terminal_trashed",
		});
	});

	it("review lane is awaiting_review, never resume", () => {
		expect(classifyCardContinuation({ card: card("a"), columnId: "review" }, noDeps)).toMatchObject({
			disposition: "awaiting_review",
			reason: "in_review",
		});
	});

	it("a committed start-blocker beats everything below it", () => {
		const blocked = card("a", { blockedKind: "needs_decomposition" });
		expect(classifyCardContinuation({ card: blocked, columnId: "in_progress" }, noDeps)).toMatchObject({
			disposition: "blocked",
			reason: "start_blocked",
		});
	});

	it("an unsatisfied dependency blocks a would-be-resumable working card", () => {
		expect(
			classifyCardContinuation({ card: card("b"), columnId: "in_progress" }, { unsatisfiedDependencies: ["a"] }),
		).toMatchObject({ disposition: "blocked", reason: "dependency_unsatisfied", unsatisfiedDependencies: ["a"] });
	});

	it("start-blocker outranks an unsatisfied dependency (priority order)", () => {
		const blocked = card("b", { blockedKind: "local_model_required" });
		expect(
			classifyCardContinuation({ card: blocked, columnId: "in_progress" }, { unsatisfiedDependencies: ["a"] }),
		).toMatchObject({ disposition: "blocked", reason: "start_blocked" });
	});

	it("review parked / changes_requested in a working lane means replan, not resume", () => {
		const parked = card("a", { review: reviewState("parked") });
		expect(classifyCardContinuation({ card: parked, columnId: "in_progress" }, noDeps)).toMatchObject({
			disposition: "replan",
			reason: "review_parked",
		});
		const changes = card("a", { review: reviewState("changes_requested") });
		expect(classifyCardContinuation({ card: changes, columnId: "in_progress" }, noDeps)).toMatchObject({
			disposition: "replan",
			reason: "review_changes_requested",
		});
	});

	it("an approved/in_review review does NOT force replan in a working lane (it resumes)", () => {
		const approved = card("a", { review: reviewState("approved") });
		expect(classifyCardContinuation({ card: approved, columnId: "in_progress" }, noDeps)).toMatchObject({
			disposition: "resume",
			reason: "ready_to_resume",
		});
	});

	it("a card stranded in backlog has no working signal → replan", () => {
		expect(classifyCardContinuation({ card: card("a"), columnId: "backlog" }, noDeps)).toMatchObject({
			disposition: "replan",
			reason: "no_working_signal",
		});
	});

	it("a clean working card with all predecessors done resumes", () => {
		expect(classifyCardContinuation({ card: card("a"), columnId: "planning" }, noDeps)).toMatchObject({
			disposition: "resume",
			reason: "ready_to_resume",
		});
		expect(classifyCardContinuation({ card: card("a"), columnId: "in_progress" }, noDeps)).toMatchObject({
			disposition: "resume",
			reason: "ready_to_resume",
		});
	});
});

function reviewState(status: "in_review" | "changes_requested" | "approved" | "parked"): RuntimeBoardCard["review"] {
	return {
		status,
		round: 1,
		history: [],
		lastVerdict: null,
		lastSummary: null,
		lastFeedback: null,
		lastInsight: null,
		signOff: null,
		parkedReason: null,
		updatedAt: 1,
	};
}

// ---- selectContinuationPoints (board-level) ---------------------------------------------------------------------

describe("selectContinuationPoints", () => {
	it("empty board → empty frontier and zeroed counts", () => {
		const selection = selectContinuationPoints(board([]));
		expect(selection.perCard).toEqual([]);
		expect(selection.resumeFrontier).toEqual([]);
		expect(selection.counts).toEqual({ resume: 0, replan: 0, blocked: 0, awaiting_review: 0, done: 0 });
	});

	it("perCard is id-sorted regardless of column/card order", () => {
		const selection = selectContinuationPoints(
			board([column("in_progress", [card("m"), card("a")]), column("backlog", [card("z"), card("c")])]),
		);
		expect(selection.perCard.map((entry) => entry.taskId)).toEqual(["a", "c", "m", "z"]);
	});

	it("dependency: an open prerequisite blocks its dependent; a completed one lets it resume", () => {
		// b depends on a (edge b → a). While a is still open, b is blocked; once a completes, b resumes.
		const blockedSel = selectContinuationPoints(
			board([column("in_progress", [card("a"), card("b")])], [dep("b", "a")]),
		);
		expect(byId(blockedSel, "b")).toMatchObject({ disposition: "blocked", reason: "dependency_unsatisfied" });
		// a itself is a clean working card → resume.
		expect(byId(blockedSel, "a").disposition).toBe("resume");

		const readySel = selectContinuationPoints(
			board([column("completed", [card("a")]), column("in_progress", [card("b")])], [dep("b", "a")]),
		);
		expect(byId(readySel, "b")).toMatchObject({ disposition: "resume", reason: "ready_to_resume" });
	});

	it("a trashed prerequisite also satisfies the dependency", () => {
		const selection = selectContinuationPoints(
			board([column("trash", [card("a")]), column("in_progress", [card("b")])], [dep("b", "a")]),
		);
		expect(byId(selection, "b").disposition).toBe("resume");
	});

	it("an absent (tombstoned) prerequisite does not block its dependent forever", () => {
		// b depends on `ghost`, which is not on the imported board at all.
		const selection = selectContinuationPoints(board([column("in_progress", [card("b")])], [dep("b", "ghost")]));
		expect(byId(selection, "b")).toMatchObject({ disposition: "resume", unsatisfiedDependencies: [] });
	});

	it("collects multiple unsatisfied prerequisites, deduped and sorted", () => {
		const selection = selectContinuationPoints(
			board(
				[column("in_progress", [card("a"), card("b"), card("c")])],
				[dep("c", "a"), dep("c", "b"), dep("c", "a")],
			),
		);
		expect(byId(selection, "c")).toMatchObject({
			disposition: "blocked",
			reason: "dependency_unsatisfied",
			unsatisfiedDependencies: ["a", "b"],
		});
	});

	it("resumeFrontier holds only resume cards, in id order, matching the counts", () => {
		const selection = selectContinuationPoints(
			board([
				column("in_progress", [card("resume2"), card("resume1")]),
				column("completed", [card("done1")]),
				column("review", [card("rev1")]),
				column("backlog", [card("plan1")]),
				column("in_progress", [card("blk1", { blockedKind: "agent_sandbox_unavailable" })]),
			]),
		);
		expect(selection.resumeFrontier.map((entry) => entry.taskId)).toEqual(["resume1", "resume2"]);
		expect(selection.counts).toEqual({
			resume: 2,
			replan: 1, // plan1 (backlog, no working signal)
			blocked: 1, // blk1 (start-blocked)
			awaiting_review: 1, // rev1
			done: 1, // done1
		});
	});

	it("frontier + non-resume dispositions partition the board (counts sum to card total)", () => {
		const selection = selectContinuationPoints(
			board([
				column("in_progress", [card("a"), card("b")]),
				column("planning", [card("c", { review: reviewState("parked") })]),
				column("review", [card("d")]),
				column("completed", [card("e")]),
			]),
		);
		const total = Object.values(selection.counts).reduce((sum, n) => sum + n, 0);
		expect(total).toBe(selection.perCard.length);
		expect(total).toBe(5);
	});

	it("is deterministic — same board yields identical output twice", () => {
		const input = board(
			[column("in_progress", [card("b"), card("a")]), column("completed", [card("z")])],
			[dep("a", "z")],
		);
		expect(selectContinuationPoints(input)).toEqual(selectContinuationPoints(input));
	});

	it("does not mutate the injected board", () => {
		const input = board([column("in_progress", [card("a")])], [dep("a", "x")]);
		const snapshot = JSON.stringify(input);
		selectContinuationPoints(input);
		expect(JSON.stringify(input)).toBe(snapshot);
	});

	it("a realistic mixed import resolves the whole board correctly", () => {
		// a: completed (done) → b (depends on a) resumes; c (depends on still-open b) blocked; d parked → replan;
		// e: fresh in backlog → replan; f: in review → awaiting_review; g: trashed → done.
		const selection = selectContinuationPoints(
			board(
				[
					column("completed", [card("a")]),
					column("in_progress", [card("b"), card("c")]),
					column("planning", [card("d", { review: reviewState("changes_requested") })]),
					column("backlog", [card("e")]),
					column("review", [card("f")]),
					column("trash", [card("g")]),
				],
				[dep("b", "a"), dep("c", "b")],
			),
		);
		const dispositions: Record<string, ContinuationDisposition> = {};
		for (const entry of selection.perCard) {
			dispositions[entry.taskId] = entry.disposition;
		}
		expect(dispositions).toEqual({
			a: "done",
			b: "resume",
			c: "blocked",
			d: "replan",
			e: "replan",
			f: "awaiting_review",
			g: "done",
		});
		expect(selection.resumeFrontier.map((entry) => entry.taskId)).toEqual(["b"]);
	});
});
