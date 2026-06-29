/**
 * Pool-aware routing (todo §5.AB per-machine pools, user 2026-06-29).
 *
 * The machine-selection layer ABOVE {@link import("./role-model-selection").selectRoleModel} (which picks a model
 * within a role) and the §6.5 scheduler (which GATES a pool at its concurrency cap). This pure core picks WHICH
 * machine pool a task should land on, encoding the user's intent: **offload easy/small cards to the secondary
 * machines and reserve the strong machine for hard cards**, while fanning out across pools that have free capacity.
 *
 *  - **Capability floor.** A pool is *feasible* only if its `capabilityTier` clears the task `difficulty` (the pool
 *    hosts a model strong enough for the task).
 *  - **Free-capacity first.** Only pools with `freeSlots > 0` are assignable; when every feasible pool is full the
 *    result is `no_capacity` (the caller queues), never a wrong pick.
 *  - **Weighting.** `efficient` (default) picks the SMALLEST sufficient pool — so an easy card takes the weakest
 *    capable machine and leaves the strong machine free for hard cards; `capability` picks the strongest (quality-max);
 *    `speed`-style is left to the within-pool model pick. Ties break to more free slots, then by `poolId`.
 *
 * Pure (lightweight descriptors), so the routing policy is unit-testable without a live scheduler; a thin adapter
 * feeds it from the §6.5 endpoint scheduler's per-pool running counts + the resolved per-pool concurrency caps.
 */

import type { ModelSelectionWeighting } from "./role-model-selection";

export interface RoleModelPoolCandidate {
	/** The machine pool id (its endpoint/baseUrl). */
	poolId: string;
	/** The strongest task difficulty (0–100) this pool can serve — e.g. its best resident model's capability. */
	capabilityTier: number;
	/** Remaining concurrency capacity right now (maxConcurrency − running); 0 = full. */
	freeSlots: number;
}

export interface SelectPoolForTaskInput {
	pools: readonly RoleModelPoolCandidate[];
	/** Task difficulty (0–100). */
	difficulty: number;
	/** How to order feasible pools. Defaults to `efficient` (smallest-sufficient → reserve strong pools for hard cards). */
	weighting?: ModelSelectionWeighting;
}

export type SelectPoolForTaskResult =
	| { type: "assign"; poolId: string; weighting: ModelSelectionWeighting; reason: string }
	| { type: "no_capacity"; reason: string }
	| { type: "no_fit"; reason: string };

function makePoolComparator(
	weighting: ModelSelectionWeighting,
): (a: RoleModelPoolCandidate, b: RoleModelPoolCandidate) => number {
	return (a, b) => {
		if (weighting === "capability") {
			if (a.capabilityTier !== b.capabilityTier) {
				return b.capabilityTier - a.capabilityTier; // strongest first (quality-max)
			}
		} else {
			// "efficient" (default) + "speed": smallest sufficient tier first, so easy cards take the weakest capable
			// machine and the strong machine stays free for hard cards.
			if (a.capabilityTier !== b.capabilityTier) {
				return a.capabilityTier - b.capabilityTier;
			}
		}
		if (a.freeSlots !== b.freeSlots) {
			return b.freeSlots - a.freeSlots; // more headroom first
		}
		return a.poolId.localeCompare(b.poolId);
	};
}

/** Pure: pick the best machine pool for a task, or report no-fit / no-capacity. */
export function selectPoolForTask(input: SelectPoolForTaskInput): SelectPoolForTaskResult {
	const weighting = input.weighting ?? "efficient";
	const capable = input.pools.filter((pool) => pool.capabilityTier >= input.difficulty);
	if (capable.length === 0) {
		return { type: "no_fit", reason: `No machine pool can serve difficulty ${input.difficulty}.` };
	}
	const free = capable.filter((pool) => pool.freeSlots > 0);
	if (free.length === 0) {
		return {
			type: "no_capacity",
			reason: `All ${capable.length} capable machine pool(s) are at capacity; queue until one frees a slot.`,
		};
	}
	const selected = free.slice().sort(makePoolComparator(weighting))[0];
	return {
		type: "assign",
		poolId: selected.poolId,
		weighting,
		reason:
			weighting === "capability"
				? `Routed to strongest free pool ${selected.poolId} (tier ${selected.capabilityTier}) for difficulty ${input.difficulty}.`
				: `Routed to smallest-sufficient free pool ${selected.poolId} (tier ${selected.capabilityTier}) for difficulty ${input.difficulty}; strong pools stay free for hard cards.`,
	};
}
