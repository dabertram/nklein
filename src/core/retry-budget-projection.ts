import { type AgentLedgerEvent, selectAttempts } from "./agent-attempt-ledger.js";
import type { RetryBudgetObservation } from "./learned-retry-budget.js";

/**
 * F3.30 — project the attempt ledger into {@link RetryBudgetObservation}s per model, so `estimateLearnedRetryBudget`
 * can derive a useful retry cap from real evidence. Each attempt contributes one observation: `retriesBefore` (the
 * durable prior-attempt count the ledger records) + `succeeded` (a success outcome). Grouped by `modelId` because the
 * budget is per-model (how many same-model retries are worth it before a failure mode stops recovering). PURE.
 */
export function buildRetryBudgetObservationsByModel(
	events: readonly AgentLedgerEvent[],
): Map<string, RetryBudgetObservation[]> {
	const byModel = new Map<string, RetryBudgetObservation[]>();
	for (const attempt of selectAttempts(events)) {
		const observation: RetryBudgetObservation = {
			succeeded: attempt.outcome === "success",
			retriesBefore: attempt.retriesBefore,
		};
		const list = byModel.get(attempt.modelId) ?? [];
		list.push(observation);
		byModel.set(attempt.modelId, list);
	}
	return byModel;
}
