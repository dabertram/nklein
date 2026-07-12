import { describe, expect, it } from "vitest";
import {
	classifyDevTestRun,
	countDevTestBoardColumns,
	type DevTestBoardCounts,
} from "../../../src/core/dev-test-outcome";

function counts(overrides: Partial<DevTestBoardCounts> = {}): DevTestBoardCounts {
	return {
		completed: 0,
		review: 0,
		planning: 0,
		ready: 0,
		inProgress: 0,
		backlog: 0,
		failed: 0,
		trash: 0,
		...overrides,
	};
}

describe("classifyDevTestRun", () => {
	it("reports completed only when every non-trash card is Completed", () => {
		const result = classifyDevTestRun({
			counts: counts({ completed: 8, trash: 2 }),
			acceptancePassed: true,
			runtimeReachable: true,
		});
		expect(result.outcome).toBe("completed");
		expect(result.success).toBe(true);
	});

	it("an EMPTY board is NOT a successful completion (no card ran)", () => {
		const result = classifyDevTestRun({ counts: counts(), acceptancePassed: null, runtimeReachable: true });
		expect(result.outcome).not.toBe("completed");
		expect(result.success).toBe(false);
		expect(result.summary).toMatch(/no card reached Completed/i);
	});

	it("a board where every card was discarded to trash (0 completed) is NOT a success", () => {
		const result = classifyDevTestRun({
			counts: counts({ trash: 5 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		expect(result.success).toBe(false);
		expect(result.outcome).not.toBe("completed");
	});

	it("distinguishes acceptance-green from workflow-complete (the audio-VST case)", () => {
		const result = classifyDevTestRun({
			counts: counts({ completed: 8, review: 2, planning: 3 }),
			acceptancePassed: true,
			runtimeReachable: true,
		});
		expect(result.outcome).toBe("acceptance_green_workflow_incomplete");
		expect(result.success).toBe(false);
		expect(result.incompleteCardCount).toBe(5);
	});

	it("reports runtime_down when the runtime is unreachable and work remains", () => {
		const result = classifyDevTestRun({
			counts: counts({ completed: 8, review: 2 }),
			acceptancePassed: null,
			runtimeReachable: false,
		});
		expect(result.outcome).toBe("runtime_down");
	});

	it("reports blocked_by_review_cards when review cards sit with nothing in progress", () => {
		const result = classifyDevTestRun({
			counts: counts({ completed: 3, review: 2 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		expect(result.outcome).toBe("blocked_by_review_cards");
	});

	it("reports stagnant when cards remain, none in progress, acceptance not green", () => {
		const result = classifyDevTestRun({
			counts: counts({ completed: 1, planning: 4 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		expect(result.outcome).toBe("stagnant");
	});

	it("reports needs_attention when a card is parked for the operator (the §12 turn-loop park, live 2026-07-12)", () => {
		// The exact live shape: the smoke seed sat in planning, its session awaiting_review + attention, nothing running.
		const result = classifyDevTestRun({
			counts: counts({ planning: 1 }),
			acceptancePassed: null,
			runtimeReachable: true,
			attentionCardCount: 1,
		});
		expect(result.outcome).toBe("needs_attention");
		expect(result.success).toBe(false);
		expect(result.summary).toMatch(/Needs your attention: 1 card\(s\) parked with a question/);
	});

	it("needs_attention outranks blocked_by_review_cards (a parked review card is a question, not a mystery)", () => {
		const result = classifyDevTestRun({
			counts: counts({ completed: 3, review: 2 }),
			acceptancePassed: null,
			runtimeReachable: true,
			attentionCardCount: 2,
		});
		expect(result.outcome).toBe("needs_attention");
	});

	it("does NOT report needs_attention while work is still in progress (the run may resolve itself)", () => {
		const result = classifyDevTestRun({
			counts: counts({ planning: 1, inProgress: 1 }),
			acceptancePassed: null,
			runtimeReachable: true,
			attentionCardCount: 1,
		});
		expect(result.outcome).toBe("stagnant");
	});

	it("attentionCardCount absent behaves exactly as before (0 — callers without session visibility)", () => {
		const withAbsent = classifyDevTestRun({
			counts: counts({ completed: 1, planning: 4 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		const withZero = classifyDevTestRun({
			counts: counts({ completed: 1, planning: 4 }),
			acceptancePassed: null,
			runtimeReachable: true,
			attentionCardCount: 0,
		});
		expect(withAbsent.outcome).toBe("stagnant");
		expect(withZero.outcome).toBe("stagnant");
	});

	it("failure and completed still dominate an attention park", () => {
		expect(
			classifyDevTestRun({
				counts: counts({ failed: 1, planning: 1 }),
				acceptancePassed: null,
				runtimeReachable: true,
				attentionCardCount: 1,
			}).outcome,
		).toBe("failed");
		expect(
			classifyDevTestRun({
				counts: counts({ completed: 2 }),
				acceptancePassed: null,
				runtimeReachable: true,
				attentionCardCount: 0,
			}).outcome,
		).toBe("completed");
	});

	it("derives counts from board columns (persisted-state path)", () => {
		const board = {
			columns: [
				{ id: "backlog", cards: [] },
				{ id: "planning", cards: [{}, {}, {}] },
				{ id: "in_progress", cards: [] },
				{ id: "review", cards: [{}, {}] },
				{ id: "completed", cards: [{}, {}, {}, {}, {}, {}, {}, {}] },
				{ id: "trash", cards: [] },
			],
		};
		const derived = countDevTestBoardColumns(board);
		expect(derived).toEqual(counts({ planning: 3, review: 2, completed: 8 }));
		expect(classifyDevTestRun({ counts: derived, acceptancePassed: true, runtimeReachable: true }).outcome).toBe(
			"acceptance_green_workflow_incomplete",
		);
	});

	it("reports failed on a failed card or failing acceptance", () => {
		expect(
			classifyDevTestRun({
				counts: counts({ completed: 2, failed: 1 }),
				acceptancePassed: true,
				runtimeReachable: true,
			}).outcome,
		).toBe("failed");
		expect(
			classifyDevTestRun({
				counts: counts({ completed: 2, review: 1 }),
				acceptancePassed: false,
				runtimeReachable: true,
			}).outcome,
		).toBe("failed");
	});
});
