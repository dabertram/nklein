import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { buildContextTimingObservationsByModel } from "../../../src/core/context-timing-projection";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

function attempt(input: {
	modelId: string;
	contextTokens: number | null;
	startedAt: number | null;
	completedAt: number | null;
	outcome: ModelOutcomeKind;
}): AgentLedgerEvent {
	return buildAttemptEvent({
		workflowId: "wf",
		taskId: "t",
		workspacePathHash: "h",
		attemptId: `a-${Math.round(Math.random() * 1e9)}`,
		modelId: input.modelId,
		outcome: input.outcome,
		recordedAt: 1000,
		contextTokens: input.contextTokens,
		startedAt: input.startedAt,
		completedAt: input.completedAt,
	});
}

describe("buildContextTimingObservationsByModel (F4.9)", () => {
	it("projects context load + wall time + success/stall per model", () => {
		const events = [
			attempt({ modelId: "m1", contextTokens: 8000, startedAt: 0, completedAt: 5000, outcome: "success" }),
			attempt({ modelId: "m1", contextTokens: 24000, startedAt: 0, completedAt: 40000, outcome: "timeout" }),
			attempt({ modelId: "m2", contextTokens: 4000, startedAt: 0, completedAt: 2000, outcome: "success" }),
		];
		const byModel = buildContextTimingObservationsByModel(events);
		expect(byModel.get("m1")).toEqual([
			{ contextTokens: 8000, wallTimeMs: 5000, success: true, stalled: false },
			{ contextTokens: 24000, wallTimeMs: 40000, success: false, stalled: true },
		]);
		expect(byModel.get("m2")).toHaveLength(1);
	});

	it("skips attempts missing the context load or timing", () => {
		const events = [
			attempt({ modelId: "m", contextTokens: null, startedAt: 0, completedAt: 1000, outcome: "success" }),
			attempt({ modelId: "m", contextTokens: 8000, startedAt: null, completedAt: 1000, outcome: "success" }),
			attempt({ modelId: "m", contextTokens: 8000, startedAt: 0, completedAt: null, outcome: "success" }),
		];
		expect(buildContextTimingObservationsByModel(events).get("m")).toBeUndefined();
	});
});
