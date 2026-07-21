import { type DeliberationTriggerDecision, shouldDeliberate } from "./deliberation-trigger";

/**
 * W4.3 — the decompose-specific adapter over the §5.AW deliberation trigger: every validated candidate plan gets one
 * lineage-diverse critic round before artifacts or board cards are materialized. A small or structurally warning-free
 * graph can still omit requirements or invent scope; structural validation is not semantic confidence. Because the
 * whole execution cascade inherits the graph, every decomposition is high-stakes and medium-confidence until that
 * independent sign-off.
 *
 * A slug is exempt only after a critic has accepted it (the caller tracks `critiqueAccepted`). Rejected revisions
 * return through the gate until accepted or the bounded escalation threshold is reached. The diverse-critic
 * requirement rides the shared trigger (waivers surfaced, never silent); loaded-model availability and admission
 * define capacity.
 */
export interface PlanCritiqueDecisionInput {
	taskCount: number;
	dependencyCount: number;
	qualityWarningCount: number;
	diverseCriticAvailable: boolean;
	critiqueBudgetRemaining: number;
	/** True only after this plan slug received a `proceed` verdict. */
	critiqueAccepted: boolean;
}

export function decidePlanCritique(input: PlanCritiqueDecisionInput): DeliberationTriggerDecision {
	if (input.critiqueAccepted) {
		return {
			deliberate: false,
			reason: "This plan already received its independent proceed verdict.",
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
