import { type DeliberationTriggerDecision, shouldDeliberate } from "./deliberation-trigger";

/**
 * W4.3 — the decompose-specific adapter over the §5.AW deliberation trigger: every validated candidate plan gets one
 * lineage-diverse critic round before artifacts or board cards are materialized. A small or structurally warning-free
 * graph can still omit requirements or invent scope; structural validation is not semantic confidence. Because the
 * whole execution cascade inherits the graph, every decomposition is high-stakes and medium-confidence until that
 * independent sign-off.
 *
 * One critique per plan slug (the caller tracks `alreadyCritiqued`) and the diverse-critic requirement ride the
 * shared trigger (waivers surfaced, never silent). Loaded-model availability and admission define capacity.
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
	return shouldDeliberate({
		stakes: "high",
		confidence: "medium",
		diverseCriticAvailable: input.diverseCriticAvailable,
		budgetRemaining: input.critiqueBudgetRemaining,
	});
}
