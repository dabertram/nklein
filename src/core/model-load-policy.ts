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

// ---------------------------------------------------------------------------
// F1.23 — idle-TTL eviction with current-task-need awareness (the scheduler's unload side).
// ---------------------------------------------------------------------------

export interface IdleModelState extends LoadedModelState {
	/** Last time a request touched this model (epoch ms); null = never observed → idle since it was loaded. */
	lastUsedAtMs: number | null;
	/** When the model was loaded (epoch ms); the idle clock starts here when no use was ever observed. */
	loadedAtMs: number;
}

export interface IdleEvictionInput {
	/** ONLY the models !Klein autonomously loaded — operator-loaded (resident) models are never candidates. */
	autoLoaded: readonly IdleModelState[];
	/** Models QUEUED/READY cards will need soon (current task need) — never evicted even when idle. */
	neededModelIds: readonly string[];
	now: number;
	/** Idle time after which an unneeded auto-loaded model is reclaimed (default 30 min). */
	idleTtlMs?: number;
}

export const DEFAULT_MODEL_IDLE_TTL_MS = 1_800_000;

export interface IdleEvictionPlan {
	/** Models to unload, LARGEST first (the caller unloads one, re-reads state, and re-consults). */
	unloadModelIds: string[];
	reasons: Record<string, string>;
}

/**
 * Which auto-loaded models the scheduler should reclaim: idle past the TTL, not busy, and not needed by any
 * queued/ready card. Pure; safe by construction — the input is ALREADY restricted to !Klein-loaded models, so an
 * operator's resident set can never appear here (prime directive: resident models are sacred).
 */
export function decideIdleEvictions(input: IdleEvictionInput): IdleEvictionPlan {
	const ttl = input.idleTtlMs ?? DEFAULT_MODEL_IDLE_TTL_MS;
	const needed = new Set(input.neededModelIds);
	const reasons: Record<string, string> = {};
	const victims = input.autoLoaded
		.filter((model) => {
			if (model.busy || needed.has(model.id)) {
				return false;
			}
			const idleSince = model.lastUsedAtMs ?? model.loadedAtMs;
			return input.now - idleSince >= ttl;
		})
		.sort((left, right) => (right.sizeGb ?? 0) - (left.sizeGb ?? 0));
	for (const victim of victims) {
		const idleMinutes = Math.round((input.now - (victim.lastUsedAtMs ?? victim.loadedAtMs)) / 60_000);
		reasons[victim.id] =
			`auto-loaded, idle ${idleMinutes} min (TTL ${Math.round(ttl / 60_000)} min), not busy, no queued/ready card needs it`;
	}
	return { unloadModelIds: victims.map((victim) => victim.id), reasons };
}
