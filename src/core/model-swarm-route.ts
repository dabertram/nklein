/**
 * End-to-end swarm route: machine pool → model within the pool (todo §5.AB per-machine pools, user 2026-06-29).
 *
 * Composes the two pure layers into the single decision the pool-aware swarm needs, WITHOUT touching the live
 * start-task path (that plumbing + its §5.Z re-verify ride the wiring leaf):
 *
 *  1. **pool layer** ({@link import("./model-pool-routing").selectPoolForTask}) — pick the machine: easy cards to the
 *     smallest sufficient FREE pool (reserve the strong machine for hard cards), or `no_capacity`/`no_fit`.
 *  2. **model layer** ({@link import("./role-model-swarm-pick").selectSwarmRoleModel}) — within the chosen pool, the
 *     class-gate → free-first/difficulty instance pick.
 *
 * A pool's `capabilityTier` is derived from its class-ELIGIBLE candidates' best capability, so a pool is only routed
 * to when it actually hosts a right-class, strong-enough model for the role+task. Pure + injectable (candidates carry
 * their pool id + facts; per-pool free slots passed in), so the whole route is unit-testable without a live scheduler.
 */

import { type RoleModelPoolCandidate, type SelectPoolForTaskResult, selectPoolForTask } from "./model-pool-routing";
import { rankModelsForRole, type SwarmRole } from "./role-model-class";
import type { ModelSelectionWeighting } from "./role-model-selection";
import {
	type SwarmRoleModelCandidate,
	type SwarmRoleModelDecision,
	selectSwarmRoleModel,
} from "./role-model-swarm-pick";

export interface SwarmRouteCandidate extends SwarmRoleModelCandidate {
	/** The machine pool (endpoint/baseUrl) this model lives on. */
	poolId: string;
}

export interface SelectSwarmRouteInput {
	role: SwarmRole;
	candidates: readonly SwarmRouteCandidate[];
	difficulty: number;
	requiredContextTokens: number;
	/** Remaining concurrency capacity per pool id (poolId → free slots). A pool absent here is treated as full (0). */
	poolFreeSlots: Readonly<Record<string, number>>;
	pinnedModelKey?: string | null;
	weighting?: ModelSelectionWeighting;
}

export interface SwarmRouteDecision {
	/** The pool layer's outcome. */
	pool: SelectPoolForTaskResult;
	/** The within-pool model pick, or null when no pool was assigned (no_fit / no_capacity). */
	model: SwarmRoleModelDecision | null;
	/** The chosen pool id, or null. */
	poolId: string | null;
}

/**
 * Pure: route a task to a machine pool, then to the best model within it. Returns the pool result (with `model: null`)
 * when no pool is fit/free; otherwise the chosen pool + the within-pool model decision (which may itself be `no_fit`).
 */
export function selectSwarmRouteForTask(input: SelectSwarmRouteInput): SwarmRouteDecision {
	// Class-eligibility per role decides which candidates count toward a pool's tier (a tool-unsuitable worker model
	// must not make its machine look capable for the worker role).
	const ranking = rankModelsForRole(
		input.role,
		input.candidates.map((c) => ({ modelKey: c.modelKey, facts: c.facts })),
	);
	const eligibleKeys = new Set(ranking.filter((r) => r.eligible).map((r) => r.modelKey));
	const capabilityByKey = new Map(input.candidates.map((c) => [c.modelKey, c.capability]));

	const tierByPool = new Map<string, number>();
	for (const candidate of input.candidates) {
		if (!eligibleKeys.has(candidate.modelKey)) {
			continue;
		}
		const current = tierByPool.get(candidate.poolId);
		const cap = capabilityByKey.get(candidate.modelKey) ?? 0;
		if (current === undefined || cap > current) {
			tierByPool.set(candidate.poolId, cap);
		}
	}

	const pools: RoleModelPoolCandidate[] = [...tierByPool.entries()].map(([poolId, capabilityTier]) => ({
		poolId,
		capabilityTier,
		freeSlots: input.poolFreeSlots[poolId] ?? 0,
	}));

	const pool = selectPoolForTask({ pools, difficulty: input.difficulty, weighting: input.weighting });
	if (pool.type !== "assign") {
		return { pool, model: null, poolId: null };
	}

	const model = selectSwarmRoleModel({
		role: input.role,
		candidates: input.candidates.filter((c) => c.poolId === pool.poolId),
		difficulty: input.difficulty,
		requiredContextTokens: input.requiredContextTokens,
		pinnedModelKey: input.pinnedModelKey,
		weighting: input.weighting,
	});
	return { pool, model, poolId: pool.poolId };
}
