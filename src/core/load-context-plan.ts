/**
 * Load-context planner (todo §5.AQ item G — the #1 VRAM lever) — decide what context-length to load a model AT, so
 * !Klein stops over-provisioning the KV cache (it grows linearly with context, so loading a 262k window for a task that
 * needs 40k can waste ~15 GB of VRAM/unified RAM).
 *
 * This composes `recommendContextLength` (right-size to the task) with !Klein's HARD minimum context floor (prime
 * directive #3: ≥32k). The floor WINS over the task fit when the task is small, so the common case lands AT the floor
 * (already right-sized) and this only ever sizes UP — never to the model's max blindly — for genuinely big-context tasks.
 *
 * Pure + deterministic: it's the decision the effectful loader (`buildLmsLoadArgs` `--context-length`) should consult;
 * it loads nothing itself.
 */

import { recommendContextLength } from "./kv-cache-size";

export interface LoadContextPlanInput {
	/** Tokens this task is expected to need (system prompt + task + working context budget). */
	taskNeededTokens: number;
	/** The model's maximum supported context (from `/api/v0/models` `max_context_length`). */
	maxContextLength: number;
	/** !Klein's hard minimum context floor in tokens (prime directive #3 — typically 32_000). */
	minContextFloor: number;
	/** Fraction of slack over the task need (default 0.25), forwarded to `recommendContextLength`. */
	safetyHeadroomFraction?: number;
	/** Round the fitted context up to this multiple (default 1024). */
	roundTo?: number;
}

/**
 * Plan the context-length to load a model at: right-size to the task, enforce the ≥-floor minimum, cap at the model max.
 *
 * Guarantees (for a sane `maxContextLength >= minContextFloor`): the result is in `[minContextFloor, maxContextLength]`,
 * never below the floor, never above the model's max, and as SMALL as the floor + task allow (so the KV cache isn't
 * over-provisioned). When `maxContextLength < minContextFloor` (a model that can't even meet the floor — the §5.L/§5.AB
 * suitability gate should have rejected it) the result clamps to `maxContextLength` so we never request more than the
 * model supports.
 */
export function planLoadContextLength(input: LoadContextPlanInput): number {
	const fitted = recommendContextLength({
		taskNeededTokens: input.taskNeededTokens,
		maxContextLength: input.maxContextLength,
		safetyHeadroomFraction: input.safetyHeadroomFraction,
		roundTo: input.roundTo,
	});
	const atLeastFloor = Math.max(input.minContextFloor, fitted);
	return Math.min(atLeastFloor, input.maxContextLength);
}

// ---------------------------------------------------------------------------
// F12.68 — slot-aware sizing: engine context is a SHARED budget across slots
// ---------------------------------------------------------------------------

export interface SharedSlotLoadContextPlanInput extends LoadContextPlanInput {
	/**
	 * How many sessions may run CONCURRENTLY on this loaded instance (the enforced per-model/host concurrency cap).
	 * llama.cpp `--ctx-size` — and therefore LM Studio's context length when the engine serves `-np N` parallel
	 * slots — is a SHARED budget: each slot silently gets `ctx / N`. Sizing for one session while serving N starves
	 * every session to `ctx/N` (< the ≥32k floor), which is exactly the latent bug this planner closes.
	 */
	concurrentSlots: number;
}

export interface SharedSlotLoadContextPlan {
	/** The context-length to LOAD at: the per-session plan × slots, capped at the model max. */
	contextLength: number;
	/** What each slot actually gets under the shared budget (`contextLength / slots`, floored). */
	perSlotContextLength: number;
	/**
	 * True when the model max forced the shared budget below `minContextFloor × slots` — i.e. running `concurrentSlots`
	 * sessions on this instance WOULD starve each below the floor. The caller must either lower the concurrency cap for
	 * this model or accept under-floor sessions knowingly (prime directive #3 says: don't).
	 */
	perSlotUnderFloor: boolean;
	/** Largest slot count the model max can serve with every slot at ≥ the floor (0 when even one slot can't). */
	maxSlotsAtFloor: number;
}

/**
 * Plan the LOAD context-length for an instance that serves `concurrentSlots` parallel sessions from ONE shared engine
 * context budget (llama.cpp `-np` semantics). Each session's need is planned by {@link planLoadContextLength} (task
 * fit, ≥floor, ≤max), then multiplied by the slot count and re-capped at the model max. `perSlotUnderFloor` flags the
 * mis-fit case the F12.68 audit exists for; `maxSlotsAtFloor` tells the caller the safe cap to fall back to.
 */
export function planSharedSlotLoadContextLength(input: SharedSlotLoadContextPlanInput): SharedSlotLoadContextPlan {
	const slots = Math.max(1, Math.floor(input.concurrentSlots));
	const perSession = planLoadContextLength(input);
	const contextLength = Math.min(perSession * slots, input.maxContextLength);
	const perSlotContextLength = Math.floor(contextLength / slots);
	return {
		contextLength,
		perSlotContextLength,
		perSlotUnderFloor: perSlotContextLength < input.minContextFloor,
		maxSlotsAtFloor: Math.floor(input.maxContextLength / Math.max(1, input.minContextFloor)),
	};
}
