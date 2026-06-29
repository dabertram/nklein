/**
 * Two-stage swarm model pick (todo §5.AB — the ≥3-agent parallel swarm, user 2026-06-29).
 *
 * Composes the two pure stages into the single decision the swarm's per-role assignment needs, WITHOUT touching the
 * live task-start path (that plumbing + its §5.Z re-verify ride the wiring leaf separately):
 *
 *  1. **class stage** ({@link import("./role-model-class").rankModelsForRole}) — drop models whose CLASS is wrong for
 *     the role (a tool-unsuitable model can't be a worker) and rank the rest by class fit (reasoning-led architect /
 *     reviewer, coding-led worker).
 *  2. **instance stage** ({@link import("./role-model-selection").selectRoleModel}) — among the class-eligible models,
 *     pick the best free + feasible one for THIS task (difficulty floor, ≥32k context, free-first, user weighting/pin).
 *
 * Keeping the composition pure + injectable (candidates carry their own capability/context/free facts) makes the
 * "right kind, then right instance" policy unit-testable end-to-end without a live registry; the live seam just maps
 * its `guardCandidates` into {@link SwarmRoleModelCandidate}s and calls this.
 */

import type { ModelClassFacts, RankedRoleModel, SwarmRole } from "./role-model-class";
import { rankModelsForRole } from "./role-model-class";
import type { ModelSelectionWeighting, RoleModelSelection } from "./role-model-selection";
import { selectRoleModel } from "./role-model-selection";

export interface SwarmRoleModelCandidate {
	modelKey: string;
	/** Class dimensions (kind + tool-use); resolved from the §5.AL catalog by id when omitted. */
	facts?: ModelClassFacts;
	/** Effective capability score (0–100), e.g. from the MCSR. */
	capability: number;
	/** Effective context window in tokens. */
	contextWindow: number;
	/** Predicted wall time for this task in ms; `null` when unknown. */
	predictedWallTimeMs: number | null;
	/** Whether the model is currently idle (not running another task). */
	isFree: boolean;
}

export interface SelectSwarmRoleModelInput {
	role: SwarmRole;
	candidates: readonly SwarmRoleModelCandidate[];
	difficulty: number;
	requiredContextTokens: number;
	pinnedModelKey?: string | null;
	weighting?: ModelSelectionWeighting;
}

export interface SwarmRoleModelDecision {
	/** The instance-stage outcome over the class-eligible pool (`assign` with a model, or `no_fit`). */
	selection: RoleModelSelection;
	/** Class-stage ranking (eligible-first), so the caller can log/telemeter why the pool was shaped this way. */
	classRanking: readonly RankedRoleModel[];
	/** Model keys that passed the class gate, in class-fit order (the pool handed to the instance stage). */
	classEligibleKeys: readonly string[];
}

/**
 * Pure: pick the best LOADED model for a swarm role + task — class gate first, then the free-first/difficulty
 * instance pick within the class-eligible pool. Returns a `no_fit` selection (with the reason) when no model is the
 * right class for the role, or when class-eligible models exist but none clears the difficulty/context floor.
 */
export function selectSwarmRoleModel(input: SelectSwarmRoleModelInput): SwarmRoleModelDecision {
	const classRanking = rankModelsForRole(
		input.role,
		input.candidates.map((c) => ({ modelKey: c.modelKey, facts: c.facts })),
	);
	const eligibleKeys = classRanking.filter((r) => r.eligible).map((r) => r.modelKey);
	const eligibleKeySet = new Set(eligibleKeys);

	if (eligibleKeys.length === 0) {
		return {
			selection: {
				type: "no_fit",
				reason: `No candidate is the right model class for the ${input.role} role (all class-ineligible).`,
			},
			classRanking,
			classEligibleKeys: eligibleKeys,
		};
	}

	const byKey = new Map(input.candidates.map((c) => [c.modelKey, c]));
	const selection = selectRoleModel({
		// Preserve the class-fit order so equal-capability ties break toward the better-class model.
		candidates: eligibleKeys.flatMap((key) => {
			const c = byKey.get(key);
			return c
				? [
						{
							modelKey: c.modelKey,
							capability: c.capability,
							contextWindow: c.contextWindow,
							predictedWallTimeMs: c.predictedWallTimeMs,
							isFree: c.isFree,
						},
					]
				: [];
		}),
		difficulty: input.difficulty,
		requiredContextTokens: input.requiredContextTokens,
		// Honor a pin only when it is itself class-eligible for the role (never pin a wrong-class model).
		pinnedModelKey: input.pinnedModelKey && eligibleKeySet.has(input.pinnedModelKey) ? input.pinnedModelKey : null,
		weighting: input.weighting,
	});

	return { selection, classRanking, classEligibleKeys: eligibleKeys };
}
