import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { buildModelTuningRecommendations, canonicalModelName } from "../../../src/core/model-tuning-recommendations";

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

	it("canonicalModelName extracts the bare model from a provider:model:endpoint registry key", () => {
		expect(canonicalModelName("lmstudio:qwopus3.5-9b-coder-mtp:http://localhost:1234/v1")).toBe(
			"qwopus3.5-9b-coder-mtp",
		);
		expect(canonicalModelName("lmstudio:qwen/qwen3.6-27b:http://localhost:1234/v1")).toBe("qwen/qwen3.6-27b");
		expect(canonicalModelName("lmstudio:unknown:default")).toBe("unknown");
		// Already-bare names (no provider prefix) pass through unchanged.
		expect(canonicalModelName("qwopus3.5-9b-coder-mtp")).toBe("qwopus3.5-9b-coder-mtp");
		expect(canonicalModelName("deepseek/deepseek-r1-0528-qwen3-8b")).toBe("deepseek/deepseek-r1-0528-qwen3-8b");
	});

	it("merges a model's ledger (registry-key) and model-perf (bare) evidence into ONE row", () => {
		const rows = buildModelTuningRecommendations({
			// Ledger records the endpoint-suffixed registry key; carries context + retry evidence.
			ledgerEvents: [
				attempt("lmstudio:qwopus:http://localhost:1234/v1", "success", {
					retriesBefore: 0,
					contextTokens: 4000,
					startedAt: 0,
					completedAt: 1000,
				}),
			],
			// Model-perf records the bare name; carries the answer budget.
			answerSizeObservations: [
				{ modelId: "qwopus", usage: { outputTokens: 500 } },
				{ modelId: "qwopus", usage: { outputTokens: 700 } },
			],
		});
		// One unified row under the bare name — not two fragmented rows.
		expect(rows).toHaveLength(1);
		expect(rows[0]?.modelId).toBe("qwopus");
		expect(rows[0]?.retryBudget).not.toBeNull(); // from the ledger key
		expect(rows[0]?.answerBudgetTokens).not.toBeNull(); // from the bare model-perf key
	});

	it("normalizes a zero answer budget (no usable samples) to null", () => {
		const rows = buildModelTuningRecommendations({
			ledgerEvents: [attempt("m", "success", { retriesBefore: 0 })],
			answerSizeObservations: [{ modelId: "m", usage: null }],
		});
		expect(rows[0]?.answerBudgetTokens).toBeNull();
	});
});
