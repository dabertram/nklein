import type { AgentLedgerEvent } from "./agent-attempt-ledger.js";
import { learnAnswerBudget } from "./answer-budget-learn.js";
import { type AnswerSizeObservation, buildAnswerSizesByModel } from "./answer-budget-projection.js";
import { recommendContextCap } from "./context-size-recommender.js";
import { buildContextTimingObservationsByModel } from "./context-timing-projection.js";
import { estimateLearnedRetryBudget } from "./learned-retry-budget.js";
import { buildRetryBudgetObservationsByModel } from "./retry-budget-projection.js";
import type { RuntimeModelTuningRow } from "./telemetry-stats-api-contract.js";

export interface ModelTuningInputs {
	/** Attempt ledger — source for context-timing (F4.9) + retry-budget (F3.30) projections. */
	ledgerEvents: readonly AgentLedgerEvent[];
	/** Model-performance observations — source for the answer-budget (F4.10) projection. */
	answerSizeObservations: readonly AnswerSizeObservation[];
}

/**
 * Consolidate the three learned per-model budgets — context cap (F4.9), answer budget (F4.10), and retry budget
 * (F3.30) — into one per-model row for the model-tuning UI surface. Each budget is derived only when its projection has
 * evidence for that model; otherwise the field is null (the UI renders it as "—"). PURE — the runtime-api layer supplies
 * the two persisted sources so this stays unit-testable. Rows are sorted by model id for a stable UI ordering.
 */
export function buildModelTuningRecommendations(inputs: ModelTuningInputs): RuntimeModelTuningRow[] {
	const contextByModel = buildContextTimingObservationsByModel(inputs.ledgerEvents);
	const retryByModel = buildRetryBudgetObservationsByModel(inputs.ledgerEvents);
	const answerByModel = buildAnswerSizesByModel(inputs.answerSizeObservations);

	const modelIds = new Set<string>([...contextByModel.keys(), ...retryByModel.keys(), ...answerByModel.keys()]);
	const rows: RuntimeModelTuningRow[] = [];
	for (const modelId of modelIds) {
		const contextObs = contextByModel.get(modelId) ?? [];
		const retryObs = retryByModel.get(modelId) ?? [];
		const answerSizes = answerByModel.get(modelId) ?? [];

		const context = contextObs.length > 0 ? recommendContextCap(contextObs) : null;
		const answer = answerSizes.length > 0 ? learnAnswerBudget(answerSizes) : null;
		const retry = retryObs.length > 0 ? estimateLearnedRetryBudget(retryObs) : null;

		rows.push({
			modelId,
			contextCapTokens: context?.recommendedMaxContextTokens ?? null,
			// learnAnswerBudget returns 0 for "no usable samples" — normalize that to null (the contract wants positive).
			answerBudgetTokens: answer && answer.budgetTokens > 0 ? answer.budgetTokens : null,
			retryBudget: retry?.recommendedMaxRetries ?? null,
			answerBudgetConfident: answer?.confident ?? false,
			sampleCount: Math.max(contextObs.length, retryObs.length, answerSizes.length),
		});
	}
	rows.sort((a, b) => a.modelId.localeCompare(b.modelId));
	return rows;
}
