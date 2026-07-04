import { describe, expect, it } from "vitest";
import {
	decideOpportunisticIdleWork,
	findMemoryAuditCandidates,
	findReviewCandidateTaskIds,
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

describe("findMemoryAuditCandidates", () => {
	it("returns recently-written note refs not already audited", () => {
		expect(findMemoryAuditCandidates(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
	});

	it("empty when every recent note was already audited", () => {
		expect(findMemoryAuditCandidates(["a", "b"], new Set(["a", "b"]))).toEqual([]);
	});
});
