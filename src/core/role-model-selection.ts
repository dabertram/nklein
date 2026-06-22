/**
 * Per-task best-fit model selection for a role that has MORE THAN ONE model assigned (todo §5.L / chat #4).
 *
 * The existing single-model router (`nklein-task-router.ts`) picks the smallest sufficient model from a flat
 * candidate list given a difficulty. This pure core adds the swarm-throughput policy on top of that idea so a
 * role can be backed by several local models and each task lands on the best-fit one:
 *
 *  - **Difficulty floor.** A candidate is *feasible* only if its capability clears the task difficulty and its
 *    context window holds the task (the ≥32k floor is enforced upstream; `requiredContextTokens` carries it).
 *  - **Free-first.** When at least one feasible model is free, never pick a busy one — that is the whole point of
 *    assigning multiple models to a role: tasks fan out instead of queueing behind one model. Only when every
 *    feasible model is busy do we fall back to the best busy one (the caller queues on it) rather than failing.
 *  - **User-overridable priority.** A pinned model wins whenever it is feasible (busy or not). Otherwise the
 *    `weighting` orders the pool: `efficient` (default — smallest sufficient, so easy cards take a fast/small
 *    model and the strong models stay free for hard cards), `capability` (most capable first, quality-max), or
 *    `speed` (fastest first).
 *
 * Keeping this pure (lightweight candidate descriptors, no registry/SDK types) makes the policy unit-testable
 * without a live model registry; a thin adapter feeds it from the MCSR + the swarm's free/busy accounting.
 */

export type ModelSelectionWeighting = "efficient" | "capability" | "speed";

/** Default favors swarm throughput: easy cards take a small/fast model, strong models stay free for hard ones. */
export const DEFAULT_MODEL_SELECTION_WEIGHTING: ModelSelectionWeighting = "efficient";

export interface RoleModelCandidate {
	modelKey: string;
	/** Effective capability score (0–100), e.g. from the Model Capability & Speed Registry. */
	capability: number;
	/** Effective context window in tokens. */
	contextWindow: number;
	/** Predicted wall time for this task in ms; `null` when unknown (sorted as slowest). */
	predictedWallTimeMs: number | null;
	/** Whether the model is currently idle (not running another task). */
	isFree: boolean;
}

export interface SelectRoleModelInput {
	candidates: readonly RoleModelCandidate[];
	/** Task difficulty (0–100). */
	difficulty: number;
	/** Context tokens the task needs the model to hold (carries the ≥32k floor enforced upstream). */
	requiredContextTokens: number;
	/** User override: force this model whenever it is feasible. */
	pinnedModelKey?: string | null;
	/** User override: how to order feasible candidates. Defaults to {@link DEFAULT_MODEL_SELECTION_WEIGHTING}. */
	weighting?: ModelSelectionWeighting;
}

export type RoleModelSelection =
	| {
			type: "assign";
			modelKey: string;
			/** True when no feasible model was free, so the caller must queue on a busy model. */
			busyFallback: boolean;
			weighting: ModelSelectionWeighting;
			reason: string;
	  }
	| {
			/** No assigned model clears the difficulty + context floor; caller should escalate / decompose. */
			type: "no_fit";
			reason: string;
	  };

function isFeasible(candidate: RoleModelCandidate, difficulty: number, requiredContextTokens: number): boolean {
	return candidate.capability >= difficulty && candidate.contextWindow >= requiredContextTokens;
}

function wallTimeRank(value: number | null): number {
	return value === null ? Number.POSITIVE_INFINITY : value;
}

function makeComparator(weighting: ModelSelectionWeighting): (a: RoleModelCandidate, b: RoleModelCandidate) => number {
	return (a, b) => {
		if (weighting === "capability") {
			if (a.capability !== b.capability) {
				return b.capability - a.capability; // most capable first
			}
			if (wallTimeRank(a.predictedWallTimeMs) !== wallTimeRank(b.predictedWallTimeMs)) {
				return wallTimeRank(a.predictedWallTimeMs) - wallTimeRank(b.predictedWallTimeMs);
			}
		} else if (weighting === "speed") {
			if (wallTimeRank(a.predictedWallTimeMs) !== wallTimeRank(b.predictedWallTimeMs)) {
				return wallTimeRank(a.predictedWallTimeMs) - wallTimeRank(b.predictedWallTimeMs); // fastest first
			}
			if (a.capability !== b.capability) {
				return b.capability - a.capability;
			}
		} else {
			// "efficient": smallest sufficient first (capability ascending), so an easy card takes a fast/small
			// model and leaves the strong models free for hard cards.
			if (a.capability !== b.capability) {
				return a.capability - b.capability;
			}
			if (wallTimeRank(a.predictedWallTimeMs) !== wallTimeRank(b.predictedWallTimeMs)) {
				return wallTimeRank(a.predictedWallTimeMs) - wallTimeRank(b.predictedWallTimeMs);
			}
		}
		return a.modelKey.localeCompare(b.modelKey);
	};
}

export function selectRoleModel(input: SelectRoleModelInput): RoleModelSelection {
	const weighting = input.weighting ?? DEFAULT_MODEL_SELECTION_WEIGHTING;
	const feasible = input.candidates.filter((candidate) =>
		isFeasible(candidate, input.difficulty, input.requiredContextTokens),
	);
	if (feasible.length === 0) {
		return {
			type: "no_fit",
			reason: `No assigned model clears difficulty ${input.difficulty} and ${input.requiredContextTokens} context tokens.`,
		};
	}

	// A pinned model is an explicit user override: honor it whenever it is feasible, even if busy.
	const pinned = input.pinnedModelKey
		? feasible.find((candidate) => candidate.modelKey === input.pinnedModelKey)
		: undefined;
	if (pinned) {
		return {
			type: "assign",
			modelKey: pinned.modelKey,
			busyFallback: !pinned.isFree,
			weighting,
			reason: pinned.isFree
				? `Pinned model ${pinned.modelKey} is feasible and free.`
				: `Pinned model ${pinned.modelKey} is feasible but busy; queuing on it (user pin overrides free-first).`,
		};
	}

	const freeFeasible = feasible.filter((candidate) => candidate.isFree);
	const busyFallback = freeFeasible.length === 0;
	const pool = busyFallback ? feasible : freeFeasible;
	const selected = pool.slice().sort(makeComparator(weighting))[0];
	return {
		type: "assign",
		modelKey: selected.modelKey,
		busyFallback,
		weighting,
		reason: busyFallback
			? `All feasible models are busy; queuing on best ${weighting} fit ${selected.modelKey}.`
			: `Selected best free ${weighting} fit ${selected.modelKey} for difficulty ${input.difficulty}.`,
	};
}
