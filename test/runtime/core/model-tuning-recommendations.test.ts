import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { buildModelTuningRecommendations } from "../../../src/core/model-tuning-recommendations";

function attempt(
	modelId: string,
	outcome: ModelOutcomeKind,
	extra: { retriesBefore?: number; contextTokens?: number; startedAt?: number; completedAt?: number } = {},
): AgentLedgerEvent {
	return buildAttemptEvent({
		workflowId: "wf",
		taskId: "t",
		workspacePathHash: "h",
		attemptId: `a-${modelId}-${outcome}-${extra.retriesBefore ?? 0}-${extra.startedAt ?? 0}`,
		modelId,
		outcome,
		recordedAt: 1000,
		retriesBefore: extra.retriesBefore ?? 0,
		contextTokens: extra.contextTokens ?? null,
		startedAt: extra.startedAt ?? null,
		completedAt: extra.completedAt ?? null,
	});
}

describe("buildModelTuningRecommendations", () => {
	it("consolidates context / answer / retry budgets per model, sorted by id", () => {
		const rows = buildModelTuningRecommendations({
			ledgerEvents: [
				attempt("m-b", "success", { retriesBefore: 0, contextTokens: 4000, startedAt: 0, completedAt: 1000 }),
				attempt("m-b", "success", { retriesBefore: 1, contextTokens: 8000, startedAt: 0, completedAt: 5000 }),
				attempt("m-a", "success", { retriesBefore: 0 }),
			],
			answerSizeObservations: [
				{ modelId: "m-b", usage: { outputTokens: 500 } },
				{ modelId: "m-b", usage: { outputTokens: 700 } },
			],
		});
		expect(rows.map((r) => r.modelId)).toEqual(["m-a", "m-b"]);
		const b = rows.find((r) => r.modelId === "m-b");
		expect(b?.retryBudget).not.toBeNull();
		expect(b?.answerBudgetTokens).not.toBeNull();
		expect(b?.sampleCount).toBeGreaterThan(0);
	});

	it("leaves a budget null when its projection has no evidence for that model", () => {
		// Only an answer observation, no ledger timing/retry evidence.
		const rows = buildModelTuningRecommendations({
			ledgerEvents: [],
			answerSizeObservations: [{ modelId: "m", usage: { outputTokens: 300 } }],
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.contextCapTokens).toBeNull();
		expect(rows[0]?.retryBudget).toBeNull();
	});

	it("normalizes a zero answer budget (no usable samples) to null", () => {
		const rows = buildModelTuningRecommendations({
			ledgerEvents: [attempt("m", "success", { retriesBefore: 0 })],
			answerSizeObservations: [{ modelId: "m", usage: null }],
		});
		expect(rows[0]?.answerBudgetTokens).toBeNull();
	});
});
