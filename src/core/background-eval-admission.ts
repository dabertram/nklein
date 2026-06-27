/**
 * §5.AI idle-aware admission gate for the always-on dev-test evaluation rail. The background runner asks, before
 * starting another evaluation run: "may I claim resources right now?" The answer must ALWAYS yield to real
 * (interactive / user-targeted) work so the rail never starves a genuine task, and must respect the resource ceilings
 * (a model is actually loaded + idle, the background concurrency cap, and the composed resource headroom — board cap +
 * sandbox pool + endpoint capacity + RAM/VRAM, evaluated upstream and passed in as a single `resourceHeadroom` flag).
 *
 * Pure + deterministic so the priority policy is fully testable; the durable runner (the §5.AF lease scheduler) wires
 * the live signals into it. The decision carries a typed `reason` for the §5.AG "what the scheduler did/why" surface.
 */

export type BackgroundEvalHoldReason =
	| "yield_to_interactive"
	| "no_idle_loaded_model"
	| "background_cap_reached"
	| "no_resource_headroom";

export interface BackgroundEvalAdmissionInput {
	/** Any user-initiated / targeted run active or queued. When true, the rail ALWAYS yields (highest-priority gate). */
	hasInteractiveWork: boolean;
	/** A model is loaded AND not claimed by targeted work — i.e. genuinely idle capacity to spend on evaluation. */
	loadedModelIdle: boolean;
	/** Background evaluation runs currently in flight. */
	runningBackgroundEvals: number;
	/** Max concurrent background evaluation runs (clamped to ≥0; 0 disables the rail). */
	maxBackgroundEvals: number;
	/** Composed upstream resource ceiling (board cap + sandbox pool + endpoint capacity + RAM/VRAM/disk). */
	resourceHeadroom: boolean;
}

export type BackgroundEvalAdmissionDecision =
	| { admit: true; reason: "idle_capacity_available" }
	| { admit: false; reason: BackgroundEvalHoldReason };

/**
 * Decide whether to admit another background evaluation run NOW. Gates are checked in PRIORITY order — interactive work
 * first (the rail must never compete with a real task), then a genuinely idle loaded model, then the background cap,
 * then composed resource headroom — so the `reason` always names the most important blocker.
 */
export function decideBackgroundEvalAdmission(input: BackgroundEvalAdmissionInput): BackgroundEvalAdmissionDecision {
	if (input.hasInteractiveWork) {
		return { admit: false, reason: "yield_to_interactive" };
	}
	if (!input.loadedModelIdle) {
		return { admit: false, reason: "no_idle_loaded_model" };
	}
	const cap = Math.max(0, Math.trunc(input.maxBackgroundEvals));
	if (input.runningBackgroundEvals >= cap) {
		return { admit: false, reason: "background_cap_reached" };
	}
	if (!input.resourceHeadroom) {
		return { admit: false, reason: "no_resource_headroom" };
	}
	return { admit: true, reason: "idle_capacity_available" };
}
