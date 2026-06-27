import { describe, expect, it } from "vitest";
import type { RuntimeBoardColumnId } from "../../../src/core/runtime-config-api-contract";
import { workflowPhaseToBoardColumn } from "../../../src/core/workflow-board-bridge";
import type { WorkflowPhase } from "../../../src/core/workflow-kernel";

const EXPECTED: Record<WorkflowPhase, RuntimeBoardColumnId> = {
	idle: "backlog",
	queued_for_board_capacity: "planning",
	queued_for_endpoint: "planning",
	queued_for_sandbox: "planning",
	planning: "planning",
	implementing: "in_progress",
	awaiting_acceptance: "in_progress",
	awaiting_review: "review",
	reviewing: "review",
	ready_for_delivery: "review",
	delivering: "review",
	completed: "completed",
	failed: "in_progress",
	cancelled: "trash",
};

describe("workflowPhaseToBoardColumn", () => {
	it("maps every workflow phase to the expected board column", () => {
		for (const [phase, column] of Object.entries(EXPECTED) as [WorkflowPhase, RuntimeBoardColumnId][]) {
			expect(workflowPhaseToBoardColumn(phase)).toBe(column);
		}
	});

	it("groups the pre-implementation phases (queue ladder + planning) into the Planning lane", () => {
		for (const phase of [
			"queued_for_board_capacity",
			"queued_for_endpoint",
			"queued_for_sandbox",
			"planning",
		] as WorkflowPhase[]) {
			expect(workflowPhaseToBoardColumn(phase)).toBe("planning");
		}
	});

	it("surfaces the whole review→delivery span in the Review lane", () => {
		for (const phase of ["awaiting_review", "reviewing", "ready_for_delivery", "delivering"] as WorkflowPhase[]) {
			expect(workflowPhaseToBoardColumn(phase)).toBe("review");
		}
	});

	it("maps terminal completed/cancelled to their lanes and parks failed in progress", () => {
		expect(workflowPhaseToBoardColumn("completed")).toBe("completed");
		expect(workflowPhaseToBoardColumn("cancelled")).toBe("trash");
		expect(workflowPhaseToBoardColumn("failed")).toBe("in_progress");
	});
});
