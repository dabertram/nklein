import { type DeliberationTriggerDecision, shouldDeliberate } from "./deliberation-trigger";

/**
 * W4.3 — the decompose-specific adapter over the §5.AW deliberation trigger: should THIS validated plan get one
 * diverse-critic round before the cascade starts? Maps plan shape onto the trigger's stakes/confidence axes:
 *
 *  - STAKES: a plan the whole cascade builds on is high-stakes when it is BIG (≥4 tasks) or heavily COUPLED
 *    (≥3 dependency edges) — a wrong small/flat plan is cheap to fix after the fact, so it never deliberates.
 *  - CONFIDENCE: the structural quality assessment is the decider's own confidence signal — a warning-free graph
 *    is a confident decomposition (no debate), quality warnings mean medium confidence (worth one critique).
 *
 * One critique per plan slug (the caller tracks `alreadyCritiqued`), a per-run count budget, and the diverse-critic
 * requirement all ride the shared trigger (waivers surfaced, never silent).
 */
export interface PlanCritiqueDecisionInput {
	taskCount: number;
	dependencyCount: number;
	qualityWarningCount: number;
	diverseCriticAvailable: boolean;
	critiqueBudgetRemaining: number;
	/** True when this plan slug already received its one critique round (revisions never re-critique). */
	alreadyCritiqued: boolean;
}

export function decidePlanCritique(input: PlanCritiqueDecisionInput): DeliberationTriggerDecision {
	if (input.alreadyCritiqued) {
		return {
			deliberate: false,
			reason: "This plan already received its one critique round — revisions apply it, not re-debate it.",
			diversityWaived: false,
		};
	}
	const highStakes = input.taskCount >= 4 || input.dependencyCount >= 3;
	return shouldDeliberate({
		stakes: highStakes ? "high" : "low",
		confidence: input.qualityWarningCount === 0 ? "high" : "medium",
		diverseCriticAvailable: input.diverseCriticAvailable,
		budgetRemaining: input.critiqueBudgetRemaining,
	});
}
