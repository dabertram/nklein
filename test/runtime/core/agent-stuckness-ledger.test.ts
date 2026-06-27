import { describe, expect, it } from "vitest";
import { type BuildAttemptEventInput, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { buildStucknessSignalsFromLedger } from "../../../src/core/agent-ledger-projections";
import { classifyAgentStuckness, isHardStuck } from "../../../src/core/agent-stuckness";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

let seq = 0;
function attempt(taskId: string, outcome: ModelOutcomeKind, overrides: Partial<BuildAttemptEventInput> = {}) {
	seq += 1;
	return buildAttemptEvent({
		workflowId: "wf",
		taskId,
		workspacePathHash: "hash",
		attemptId: `a${seq}`,
		modelId: "model-a",
		recordedAt: seq,
		outcome,
		...overrides,
	});
}

describe("buildStucknessSignalsFromLedger", () => {
	it("returns an empty/progressing signal set when there are no attempts for the task", () => {
		const signals = buildStucknessSignalsFromLedger([], "task-1");
		expect(signals).toEqual({
			recentOutcomes: [],
			distinctApproachesTried: 0,
			loopUncleared: false,
			retryBudgetExhausted: false,
			hadProgressSinceStuck: false,
		});
		expect(classifyAgentStuckness(signals)).toBe("progressing");
	});

	it("scopes the episode to the trailing run of consecutive non-success attempts", () => {
		const events = [
			attempt("task-1", "other_failure", { endpointStrategy: "e1" }),
			attempt("task-1", "success"),
			attempt("task-1", "loop", { endpointStrategy: "e2" }),
			attempt("task-1", "other_failure", { endpointStrategy: "e3" }),
		];
		const signals = buildStucknessSignalsFromLedger(events, "task-1");
		// Only the two attempts AFTER the success are in the current episode.
		expect(signals.recentOutcomes).toEqual<ModelOutcomeKind[]>(["loop", "other_failure"]);
		expect(signals.distinctApproachesTried).toBe(2);
	});

	it("ignores attempts belonging to other tasks", () => {
		const events = [
			attempt("task-other", "other_failure"),
			attempt("task-1", "malformed", { endpointStrategy: "e1" }),
			attempt("task-other", "loop"),
		];
		const signals = buildStucknessSignalsFromLedger(events, "task-1");
		expect(signals.recentOutcomes).toEqual<ModelOutcomeKind[]>(["malformed"]);
		expect(signals.distinctApproachesTried).toBe(1);
	});

	it("counts an uncleared loop (loop outcome with no salvage) but not a salvaged one", () => {
		const uncleared = buildStucknessSignalsFromLedger([attempt("task-1", "loop", { salvage: null })], "task-1");
		expect(uncleared.loopUncleared).toBe(true);
		const salvaged = buildStucknessSignalsFromLedger(
			[attempt("task-2", "loop", { salvage: "looped→salvaged" })],
			"task-2",
		);
		expect(salvaged.loopUncleared).toBe(false);
	});

	it("flags forward progress when a failing attempt still produced an artifact", () => {
		const signals = buildStucknessSignalsFromLedger(
			[
				attempt("task-1", "other_failure", {
					artifacts: { resultBranch: "nklein/tasks/x", patchRef: null, evidenceBundle: null },
				}),
			],
			"task-1",
		);
		expect(signals.hadProgressSinceStuck).toBe(true);
		expect(classifyAgentStuckness(signals)).toBe("progressing");
	});

	it("passes retryBudgetExhausted through from the caller", () => {
		const events = [attempt("task-1", "other_failure")];
		expect(buildStucknessSignalsFromLedger(events, "task-1").retryBudgetExhausted).toBe(false);
		expect(
			buildStucknessSignalsFromLedger(events, "task-1", { retryBudgetExhausted: true }).retryBudgetExhausted,
		).toBe(true);
	});

	it("end-to-end: a genuinely stuck episode triggers the bigger-model consult", () => {
		const events = [
			attempt("task-1", "other_failure", { endpointStrategy: "e1", promptStrategy: "p1" }),
			attempt("task-1", "loop", { endpointStrategy: "e2", promptStrategy: "p1", salvage: null }),
			attempt("task-1", "other_failure", { endpointStrategy: "e3", promptStrategy: "p2" }),
		];
		const signals = buildStucknessSignalsFromLedger(events, "task-1", { retryBudgetExhausted: true });
		expect(signals.distinctApproachesTried).toBe(3);
		expect(signals.loopUncleared).toBe(true);
		expect(isHardStuck(signals)).toBe(true);
	});

	it("sorts attempts chronologically by recordedAt regardless of input order", () => {
		const later = attempt("task-1", "other_failure", { endpointStrategy: "late", recordedAt: 100 });
		const earlier = attempt("task-1", "success", { recordedAt: 50 });
		// Pass them out of order; the success (earlier) must end the episode, leaving only the later failure.
		const signals = buildStucknessSignalsFromLedger([later, earlier], "task-1");
		expect(signals.recentOutcomes).toEqual<ModelOutcomeKind[]>(["other_failure"]);
	});
});
