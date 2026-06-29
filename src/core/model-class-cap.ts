/**
 * §5.AE per-role model-class cap (compute control) — the PURE classifier + gate behind the user's "only the architect
 * role may use the big models" use-case. A role can declare a `modelClassCap`; at task-start the candidate models are
 * filtered to those within the cap, so e.g. a `worker` role can be pinned to small local models while `architect` keeps
 * the large ones. Pure + deterministic; the cap being ABSENT means uncapped (today's behavior), so the filter is a no-op
 * until a cap is configured. Cloud stays separately #1-locked regardless of the cap (the cap expresses INTENT; the
 * local-only policy enforces the cloud ban).
 */

import type { RuntimeModelClassCap } from "./runtime-config-api-contract";

/** A model's coarse class for capping: a small local model, a large local model, or a cloud model. */
export type ModelClass = "small" | "large" | "cloud";

/** Capability score at/above which a LOCAL model is considered "large" (a heuristic over the registry capability). */
export const DEFAULT_LARGE_MODEL_CAPABILITY_THRESHOLD = 70;

/**
 * Classify a model into a {@link ModelClass} (pure). Cloud is decided by `isLocal` (definitive); among local models, the
 * registry capability score is the size proxy — at/above the threshold is "large", below is "small". The threshold is a
 * heuristic over real registry data; tune via `options.largeThreshold`.
 */
export function classifyModelClass(
	input: { isLocal: boolean; capabilityScore: number },
	options?: { largeThreshold?: number },
): ModelClass {
	if (!input.isLocal) {
		return "cloud";
	}
	const threshold = options?.largeThreshold ?? DEFAULT_LARGE_MODEL_CAPABILITY_THRESHOLD;
	return input.capabilityScore >= threshold ? "large" : "small";
}

/**
 * Whether a model of the given class is permitted by a role's cap (pure). `small_only` ⇒ only small local models;
 * `any_local` ⇒ any local model (cloud excluded); `any` (or an absent cap) ⇒ no class restriction. Note `any` permitting
 * "cloud" only expresses intent — the local-only policy (#1) still blocks cloud at the provider gate.
 */
export function isModelAllowedByClassCap(
	cap: RuntimeModelClassCap | null | undefined,
	modelClass: ModelClass,
): boolean {
	if (!cap || cap === "any") {
		return true;
	}
	if (cap === "any_local") {
		return modelClass !== "cloud";
	}
	// small_only
	return modelClass === "small";
}
