import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { DecompositionStallNudger, type DecompositionStallNudgerCallbacks } from "./decomposition-stall-nudger";

// Coverage for the refinement-promotion nudge (maybeNudgeStalledRefinement): a refinable --no-plan card that ended
// a turn in Planning without begin_implementation gets ONE nudge to promote; the gating lives in the pure core.

function stalledRefinementSummary(): RuntimeTaskSessionSummary {
	return {
		state: "awaiting_review",
		reviewReason: "hook",
		workspacePath: "/ws",
		latestHookActivity: {
			toolName: "read_files",
			activityText: "reading files",
			finalMessage: null,
			hookEventName: "agent_end",
			toolInputSummary: null,
			notificationType: null,
			source: "nklein",
		},
	} as unknown as RuntimeTaskSessionSummary;
}

function makeNudger(overrides: Partial<DecompositionStallNudgerCallbacks> = {}) {
	const sendTaskSessionInput = vi.fn(async () => null);
	const recordObservation = vi.fn();
	const callbacks: DecompositionStallNudgerCallbacks = {
		isExplicitDecompositionTask: () => false,
		getTaskSummary: () => stalledRefinementSummary(),
		resolveProviderId: () => "lmstudio",
		resolveModelId: () => "qwen/qwen3.8-27b",
		resolveWorkspacePath: () => "/ws",
		recordObservation,
		cancelTaskTurn: async () => null,
		sendTaskSessionInput,
		isRefinableWorkCard: () => true,
		hasBegunImplementation: () => false,
		...overrides,
	};
	return { nudger: new DecompositionStallNudger(callbacks), sendTaskSessionInput, recordObservation };
}

describe("DecompositionStallNudger.maybeNudgeStalledRefinement", () => {
	it("nudges a stalled refinement card to call begin_implementation — exactly once", () => {
		const { nudger, sendTaskSessionInput, recordObservation } = makeNudger();
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(true);
		expect(sendTaskSessionInput).toHaveBeenCalledWith("t1", expect.stringContaining("begin_implementation"), "act");
		expect(recordObservation).toHaveBeenCalledOnce();
		// Budget is one per card — a second stalled turn does not re-nudge (it parks on its own).
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
		expect(sendTaskSessionInput).toHaveBeenCalledOnce();
	});

	it("does not nudge a card that already promoted to In Progress", () => {
		const { nudger, sendTaskSessionInput } = makeNudger({ hasBegunImplementation: () => true });
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
	});

	it("does not nudge a plan-mode / non-refinable card (the decomposition path owns that)", () => {
		const { nudger, sendTaskSessionInput } = makeNudger({ isRefinableWorkCard: () => false });
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
	});

	it("resetTask clears the refinement nudge budget so a fresh start can nudge again", () => {
		const { nudger, sendTaskSessionInput } = makeNudger();
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(true);
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
		nudger.resetTask("t1");
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(true);
		expect(sendTaskSessionInput).toHaveBeenCalledTimes(2);
	});
});
