/**
 * F4.39 — prompt INTENT modes. A pure selector that chooses which prompt components to include for a turn's intent —
 * `minimize` (smallest correct prompt), `balance` (the default), or `max_task_info` (everything that could help) —
 * WITHOUT ever dropping an invariant (safety / format / containment fragments are always retained regardless of mode).
 *
 * Generic over any component carrying an inclusion `tier` + an `invariant` flag, so the prompt builders tag their
 * fragments and call this once; it never reorders (cache-prefix stability is the caller's concern) and never fabricates.
 * PURE + deterministic: input order preserved in the output.
 */

export type PromptIntentMode = "minimize" | "balance" | "max_task_info";

/** Inclusion tier for a prompt component (ignored when `invariant` is set — invariants always ship). */
export type PromptComponentTier = "essential" | "standard" | "enriching";

export interface IntentSelectableComponent {
	/** Always included in EVERY mode (a safety / format / containment invariant). */
	invariant?: boolean;
	/** `essential` ships in every mode; `standard` from `balance` up; `enriching` only in `max_task_info`. */
	tier: PromptComponentTier;
}

/** Which non-invariant tiers each mode admits. */
const ADMITTED_TIERS: Record<PromptIntentMode, ReadonlySet<PromptComponentTier>> = {
	minimize: new Set<PromptComponentTier>(["essential"]),
	balance: new Set<PromptComponentTier>(["essential", "standard"]),
	max_task_info: new Set<PromptComponentTier>(["essential", "standard", "enriching"]),
};

/** True when a component is included for the given intent mode (invariant ⇒ always; else by tier). */
export function isComponentIncludedForIntent(component: IntentSelectableComponent, mode: PromptIntentMode): boolean {
	return component.invariant === true || ADMITTED_TIERS[mode].has(component.tier);
}

/** Select the components to include for the intent mode, preserving input order. Invariants are never dropped. */
export function selectPromptComponentsForIntent<T extends IntentSelectableComponent>(
	components: readonly T[],
	mode: PromptIntentMode,
): T[] {
	return components.filter((component) => isComponentIncludedForIntent(component, mode));
}
