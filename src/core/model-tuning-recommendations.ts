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
 * Collapse a model key to a canonical per-model display name so the two recording paths line up. The attempt ledger
 * records `modelId` as the full registry key `provider:model:endpoint` (buildNKleinModelRegistryKey), while
 * model-performance observations record the bare model name — so the SAME model otherwise appears as two rows (one with
 * context/retry from the ledger, one with the answer budget from model-perf). Model names never contain a colon, so the
 * middle `:`-segment of a `provider:model:endpoint` key is always the bare model; a key with no provider/endpoint is
 * already bare. This unifies a model's evidence across endpoints/hosts, which is what a per-model tuning view wants.
 */
export function canonicalModelName(key: string): string {
	const parts = key.split(":");
	// provider:model:endpoint → the model is parts[1] (endpoint URLs add more colon-segments after it). Bare names,
	// which carry no provider prefix, have a single segment and pass through unchanged.
	return parts.length >= 3 ? parts[1] : key;
}

/** Re-key a per-model projection by canonical model name, concatenating the evidence of keys that collapse together. */
function recanonicalize<T>(byModel: Map<string, T[]>): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const [key, list] of byModel) {
		const canon = canonicalModelName(key);
		const existing = out.get(canon);
		if (existing) {
			existing.push(...list);
		} else {
			out.set(canon, [...list]);
		}
	}
	return out;
}

/**
 * Consolidate the three learned per-model budgets — context cap (F4.9), answer budget (F4.10), and retry budget
 * (F3.30) — into one per-model row for the model-tuning UI surface. Each budget is derived only when its projection has
 * evidence for that model; otherwise the field is null (the UI renders it as "—"). PURE — the runtime-api layer supplies
 * the two persisted sources so this stays unit-testable. Rows are sorted by model id for a stable UI ordering.
 */
export function buildModelTuningRecommendations(inputs: ModelTuningInputs): RuntimeModelTuningRow[] {
	// Canonicalize each projection's keys so a model's ledger evidence (endpoint-suffixed registry key) and its
	// model-perf evidence (bare name) land on the same row instead of fragmenting into two.
	const contextByModel = recanonicalize(buildContextTimingObservationsByModel(inputs.ledgerEvents));
	const retryByModel = recanonicalize(buildRetryBudgetObservationsByModel(inputs.ledgerEvents));
	const answerByModel = recanonicalize(buildAnswerSizesByModel(inputs.answerSizeObservations));

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
