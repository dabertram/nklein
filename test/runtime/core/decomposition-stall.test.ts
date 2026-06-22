import { describe, expect, it } from "vitest";

import {
	type DecompositionStallInputs,
	decideDecompositionStallRecovery,
	isStatefulReadWorkflowTool,
} from "../../../src/core/decomposition-stall";

/** A clean model-stop decomposition turn that has not decomposed and still has nudge budget. */
const CLEAN_STALL: DecompositionStallInputs = {
	isDecompositionTask: true,
	state: "awaiting_review",
	reviewReason: "hook",
	decomposed: false,
	lastToolName: null,
	endedOnQuestion: false,
	nudgeCount: 0,
	nudgeLimit: 2,
};

describe("isStatefulReadWorkflowTool", () => {
	it("matches read_large_file regardless of casing/whitespace", () => {
		expect(isStatefulReadWorkflowTool("read_large_file")).toBe(true);
		expect(isStatefulReadWorkflowTool("  READ_LARGE_FILE ")).toBe(true);
	});

	it("does not match other read tools or empty values", () => {
		expect(isStatefulReadWorkflowTool("read_files")).toBe(false);
		expect(isStatefulReadWorkflowTool("decompose_project")).toBe(false);
		expect(isStatefulReadWorkflowTool(null)).toBe(false);
		expect(isStatefulReadWorkflowTool("")).toBe(false);
	});
});

describe("decideDecompositionStallRecovery", () => {
	it("re-prompts a reasoning-only turn to emit decompose_project", () => {
		expect(decideDecompositionStallRecovery(CLEAN_STALL).action).toBe("decompose");
	});

	it("continues the read when the turn stalled right after read_large_file (the evidence-bundle case)", () => {
		// Regression: the model narrated the next read_large_file call as text in its reasoning channel, so the turn
		// ended mid-document with read_large_file as the last (preserved) tool. This must recover, not be exempted.
		const decision = decideDecompositionStallRecovery({ ...CLEAN_STALL, lastToolName: "read_large_file" });
		expect(decision.action).toBe("continue_read");
	});

	it("treats a read_large_file stall as continue_read even though a tool ran this turn", () => {
		// `agent_end` preserves the last tool name, so "a tool ran" cannot exempt a mid-read stall.
		const decision = decideDecompositionStallRecovery({ ...CLEAN_STALL, lastToolName: "READ_LARGE_FILE" });
		expect(decision.action).toBe("continue_read");
	});

	it("does not nudge when a non-read tool ran this turn (genuine progress)", () => {
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, lastToolName: "write_files" }).action).toBe("none");
	});

	it("does nothing for a non-decomposition task", () => {
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, isDecompositionTask: false }).action).toBe("none");
	});

	it("does nothing unless the turn ended on a clean model-stop hook", () => {
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, state: "running" }).action).toBe("none");
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, reviewReason: "interrupted" }).action).toBe("none");
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, reviewReason: "error" }).action).toBe("none");
	});

	it("does nothing once the turn already decomposed", () => {
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, decomposed: true }).action).toBe("none");
		// even mid-read: a completed decomposition wins.
		expect(
			decideDecompositionStallRecovery({ ...CLEAN_STALL, decomposed: true, lastToolName: "read_large_file" }).action,
		).toBe("none");
	});

	it("does not override a turn that ended on a clarifying question", () => {
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, endedOnQuestion: true }).action).toBe("none");
	});

	it("stops once the re-prompt budget is exhausted", () => {
		expect(decideDecompositionStallRecovery({ ...CLEAN_STALL, nudgeCount: 2 }).action).toBe("none");
		expect(
			decideDecompositionStallRecovery({ ...CLEAN_STALL, nudgeCount: 2, lastToolName: "read_large_file" }).action,
		).toBe("none");
	});
});
