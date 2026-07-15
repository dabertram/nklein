import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { buildRetryBudgetObservationsByModel } from "../../../src/core/retry-budget-projection";

function attempt(modelId: string, outcome: ModelOutcomeKind, retriesBefore: number): AgentLedgerEvent {
	return buildAttemptEvent({
		workflowId: "wf",
		taskId: "t",
		workspacePathHash: "h",
		attemptId: `a-${modelId}-${outcome}-${retriesBefore}`,
		modelId,
		outcome,
		recordedAt: 1000,
		retriesBefore,
	});
}

describe("buildRetryBudgetObservationsByModel (F3.30)", () => {
	it("projects retriesBefore + success per model", () => {
		const byModel = buildRetryBudgetObservationsByModel([
			attempt("m1", "success", 0),
			attempt("m1", "loop", 1),
			attempt("m2", "success", 2),
		]);
		expect(byModel.get("m1")).toEqual([
			{ succeeded: true, retriesBefore: 0 },
			{ succeeded: false, retriesBefore: 1 },
		]);
		expect(byModel.get("m2")).toEqual([{ succeeded: true, retriesBefore: 2 }]);
	});
});
