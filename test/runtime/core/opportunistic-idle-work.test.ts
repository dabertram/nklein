import { describe, expect, it } from "vitest";
import {
	decideOpportunisticIdleWork,
	findMemoryAuditCandidates,
	findReviewCandidateTaskIds,
	findStalledReviewTaskIds,
	findThinEvalCells,
	RE_EVAL_MIN_SETTLED_RUNS,
} from "../../../src/core/opportunistic-idle-work";

const board = (reviewCardIds: string[]) => ({
	columns: [
		{ id: "in_progress", cards: [{ id: "running-1" }] },
		{ id: "review", cards: reviewCardIds.map((id) => ({ id })) },
		{ id: "completed", cards: [{ id: "done-1" }] },
	],
});

describe("findReviewCandidateTaskIds", () => {
	it("returns review-lane card ids not already dispatched", () => {
		expect(findReviewCandidateTaskIds(board(["r1", "r2", "r3"]), new Set(["r2"]))).toEqual(["r1", "r3"]);
	});

	it("empty when there is no review lane or it is empty", () => {
		expect(findReviewCandidateTaskIds({ columns: [{ id: "backlog", cards: [] }] }, new Set())).toEqual([]);
		expect(findReviewCandidateTaskIds(board([]), new Set())).toEqual([]);
	});
});

describe("decideOpportunisticIdleWork", () => {
	it("HARD veto: real queued/active work suppresses all opportunistic work, even with review candidates", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: true,
			reviewCandidateTaskIds: ["card-1"],
		});
		expect(decision.verdict.chosen).toBeNull();
		expect(decision.reviewTaskId).toBeNull();
		expect(decision.verdict.reason).toMatch(/vetoed/i);
	});

	it("idle + a review candidate ⇒ chooses review and targets the first candidate", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: false,
			reviewCandidateTaskIds: ["card-1", "card-2"],
		});
		expect(decision.verdict.chosen).toBe("review");
		expect(decision.reviewTaskId).toBe("card-1");
	});

	it("idle with nothing available ⇒ null (the remaining pickers have no producer yet)", () => {
		const decision = decideOpportunisticIdleWork({ hasRealQueuedWork: false, reviewCandidateTaskIds: [] });
		expect(decision.verdict.chosen).toBeNull();
		expect(decision.reviewTaskId).toBeNull();
		expect(decision.memoryAuditNoteRef).toBeNull();
	});

	it("idle + a memory-audit candidate ⇒ chooses memory_audit and targets the first note ref", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: false,
			reviewCandidateTaskIds: [],
			memoryAuditNoteRefs: ["notes/a.md", "notes/b.md"],
		});
		expect(decision.verdict.chosen).toBe("memory_audit");
		expect(decision.memoryAuditNoteRef).toBe("notes/a.md");
	});

	it("review outranks memory_audit when both are available (priority order)", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: false,
			reviewCandidateTaskIds: ["card-1"],
			memoryAuditNoteRefs: ["notes/a.md"],
		});
		expect(decision.verdict.chosen).toBe("review");
		expect(decision.memoryAuditNoteRef).toBeNull();
	});

	it("HARD veto suppresses memory_audit too", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: true,
			reviewCandidateTaskIds: [],
			memoryAuditNoteRefs: ["notes/a.md"],
		});
		expect(decision.verdict.chosen).toBeNull();
		expect(decision.memoryAuditNoteRef).toBeNull();
	});
});

describe("findStalledReviewTaskIds (board-liveness watchdog review rescue)", () => {
	const reviewBoard = (cards: Array<{ id: string; review?: { status: string } | null }>) => ({
		columns: [
			{ id: "in_progress", cards: [{ id: "running-1" }] },
			{ id: "review", cards },
			{ id: "completed", cards: [{ id: "done-1" }] },
		],
	});

	it("finds verdict-less review cards (no persisted review state) with no live session", () => {
		const stalled = findStalledReviewTaskIds(
			reviewBoard([{ id: "never-reviewed" }, { id: "parked", review: { status: "parked" } }]),
			new Set(),
			new Set(),
		);
		expect(stalled).toEqual(["never-reviewed"]);
	});

	it("excludes cards with a live session and already-dispatched cards", () => {
		const stalled = findStalledReviewTaskIds(
			reviewBoard([{ id: "live" }, { id: "dispatched" }, { id: "frozen" }]),
			new Set(["live"]),
			new Set(["dispatched"]),
		);
		expect(stalled).toEqual(["frozen"]);
	});

	it("never treats a reviewed/held card as stalled (any persisted review state excludes it)", () => {
		const stalled = findStalledReviewTaskIds(
			reviewBoard([
				{ id: "held", review: { status: "in_review" } },
				{ id: "changes", review: { status: "changes_requested" } },
			]),
			new Set(),
			new Set(),
		);
		expect(stalled).toEqual([]);
	});
});

describe("findThinEvalCells (§5.AB idle re-eval budget)", () => {
	const corpus = [
		{ id: "d1", role: "architect", difficulty: "easy" },
		{ id: "d2", role: "architect", difficulty: "easy" },
		{ id: "r1", role: "reviewer", difficulty: "medium" },
	];

	it("finds cells below the settled floor for LOADED models only, thinnest first", () => {
		const candidates = findThinEvalCells({
			fitnessRows: [
				{ modelKey: "m1", role: "architect", difficultyTier: "easy", sampleCount: 2 },
				{ modelKey: "m1", role: "reviewer", difficultyTier: "medium", sampleCount: 0 },
				{ modelKey: "unloaded", role: "architect", difficultyTier: "easy", sampleCount: 0 },
			],
			loadedModelIds: ["m1"],
			corpusPrompts: corpus,
			alreadyDispatched: new Set(),
		});
		expect(candidates.map((candidate) => candidate.cellKey)).toEqual([
			"m1::reviewer::medium", // 4 owed — thinnest first
			"m1::architect::easy", // 2 owed
		]);
		expect(candidates[0]?.runsOwed).toBe(RE_EVAL_MIN_SETTLED_RUNS);
		expect(candidates[0]?.promptIds).toEqual(["r1"]);
		expect(candidates[1]?.promptIds).toEqual(["d1", "d2"]);
	});

	it("treats a model with NO rows at all as fully owed", () => {
		const candidates = findThinEvalCells({
			fitnessRows: [],
			loadedModelIds: ["fresh"],
			corpusPrompts: corpus,
			alreadyDispatched: new Set(),
		});
		expect(candidates).toHaveLength(2); // architect::easy + reviewer::medium groups
		expect(candidates.every((candidate) => candidate.runsOwed === RE_EVAL_MIN_SETTLED_RUNS)).toBe(true);
	});

	it("skips settled cells and in-flight dispatches", () => {
		const candidates = findThinEvalCells({
			fitnessRows: [{ modelKey: "m1", role: "architect", difficultyTier: "easy", sampleCount: 4 }],
			loadedModelIds: ["m1"],
			corpusPrompts: corpus,
			alreadyDispatched: new Set(["m1::reviewer::medium"]),
		});
		expect(candidates).toEqual([]);
	});
});

describe("decideOpportunisticIdleWork — re_eval rung", () => {
	const reEval = {
		modelId: "m1",
		role: "architect",
		difficulty: "easy",
		promptIds: ["d1"],
		cellKey: "m1::architect::easy",
		runsOwed: 4,
	};

	it("chooses re_eval when idle and nothing higher-value is available", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: false,
			reviewCandidateTaskIds: [],
			reEvalCandidates: [reEval],
		});
		expect(decision.verdict.chosen).toBe("re_eval");
		expect(decision.reEvalCandidate?.cellKey).toBe("m1::architect::easy");
	});

	it("review outranks re_eval; the hard veto suppresses it entirely", () => {
		expect(
			decideOpportunisticIdleWork({
				hasRealQueuedWork: false,
				reviewCandidateTaskIds: ["card-1"],
				reEvalCandidates: [reEval],
			}).verdict.chosen,
		).toBe("review");
		expect(
			decideOpportunisticIdleWork({
				hasRealQueuedWork: true,
				reviewCandidateTaskIds: [],
				reEvalCandidates: [reEval],
			}).verdict.chosen,
		).toBeNull();
	});
});

describe("findMemoryAuditCandidates", () => {
	it("returns recently-written note refs not already audited", () => {
		expect(findMemoryAuditCandidates(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
	});

	it("empty when every recent note was already audited", () => {
		expect(findMemoryAuditCandidates(["a", "b"], new Set(["a", "b"]))).toEqual([]);
	});
});
