/**
 * §5.AB/§10 model load/unload POLICY (operational resource governance) — the pure decider a sweep runner consults
 * before touching `lms load`/`lms unload`. Prime rules (user directives + the sweep-phase grant):
 *
 *  - RESIDENT models are sacred: a model the OPERATOR loaded (the resident set) is never proposed for unload;
 *  - load only with HEADROOM: a load is proposed only when the estimated size fits the available budget, otherwise
 *    propose unloading the largest NON-resident, NON-busy model first (one step at a time — the caller re-consults);
 *  - never fight the user: a busy model (in-flight requests) is never proposed for unload even if non-resident;
 *  - idempotent: requesting an already-loaded model is a no-op.
 *
 * Pure + injected state — the effectful sweep runner owns the actual lms calls and re-reads state between steps.
 */

export interface LoadedModelState {
	id: string;
	/** Estimated resident size in GB (null = unknown; unknown sizes are treated as unmovable last). */
	sizeGb: number | null;
	/** In-flight/queued work on this model — never unload a busy model. */
	busy: boolean;
}

export interface ModelLoadPolicyInput {
	/** The model the sweep wants next. */
	requestedModelId: string;
	/** Estimated size of the requested model in GB (null = unknown ⇒ require `minFreeGbForUnknown`). */
	requestedSizeGb: number | null;
	loaded: readonly LoadedModelState[];
	/** Available memory budget in GB for model residency. */
	freeGb: number;
	/** Operator-pinned resident model ids — NEVER proposed for unload. */
	residentModelIds: readonly string[];
	/** Free-GB floor demanded when the requested size is unknown (default 8). */
	minFreeGbForUnknown?: number;
}

export type ModelLoadAction =
	| { action: "noop"; reason: string }
	| { action: "load"; modelId: string; reason: string }
	| { action: "unload_first"; unloadModelId: string; reason: string }
	| { action: "blocked"; reason: string };

export function decideModelLoadAction(input: ModelLoadPolicyInput): ModelLoadAction {
	if (input.loaded.some((model) => model.id === input.requestedModelId)) {
		return { action: "noop", reason: `${input.requestedModelId} is already loaded.` };
	}
	const needed = input.requestedSizeGb ?? input.minFreeGbForUnknown ?? 8;
	if (input.freeGb >= needed) {
		return {
			action: "load",
			modelId: input.requestedModelId,
			reason: `${input.freeGb.toFixed(1)}GB free ≥ ~${needed.toFixed(1)}GB needed.`,
		};
	}
	const resident = new Set(input.residentModelIds);
	const evictable = input.loaded
		.filter((model) => !resident.has(model.id) && !model.busy && model.sizeGb !== null)
		.sort((left, right) => (right.sizeGb ?? 0) - (left.sizeGb ?? 0));
	const victim = evictable[0];
	if (victim) {
		return {
			action: "unload_first",
			unloadModelId: victim.id,
			reason: `Need ~${needed.toFixed(1)}GB, only ${input.freeGb.toFixed(1)}GB free — unload non-resident idle ${victim.id} (~${victim.sizeGb?.toFixed(1)}GB) first.`,
		};
	}
	return {
		action: "blocked",
		reason: `Need ~${needed.toFixed(1)}GB with ${input.freeGb.toFixed(1)}GB free, and every loaded model is resident, busy, or of unknown size — refusing to evict (resident models are never unloaded).`,
	};
}
