/**
 * F12.105 honest hybrid capability-ceiling advisory — the CARD-LEVEL, honesty-first counterpart to F3.35's
 * role/operator-level ceiling assessment.
 *
 * When a specific card's difficulty exceeds what the best AVAILABLE (loaded) model does well for the executing
 * role, !Klein should ADVISE honestly rather than silently deliver a weak result: name the gap, say it is
 * proceeding with the best available model, and surface the informed escape hatch (a stronger local model — or a
 * cloud model once that is enabled — would resolve it more reliably). This is the trust play: local-first stays
 * the default, the user is told the truth and chooses. NOT a dark pattern — it never blocks, never upsells; it
 * informs and proceeds.
 *
 * Pure + total: all inputs normalized to 0..1 by the caller; the module decides whether the gap is material and
 * composes the message. Distinct from F3.35 (which answers "does the FLEET have a good enough model for a ROLE"
 * for capacity planning) — this fires per card, at routing time, about THIS card's fit.
 */

/** Below this capability-below-difficulty gap the card is treated as within fleet reach (no advisory). */
export const DEFAULT_CEILING_ADVISORY_MARGIN = 0.15;

export interface CeilingAdvisoryInput {
	/** The card's difficulty, 0..1 (harder = higher). */
	readonly cardDifficulty: number;
	/** The executing role (worker/architect/reviewer) — named in the honest message. */
	readonly role: string;
	/** The best AVAILABLE (loaded) model's capability for the role, 0..1; null when unmeasured/none loaded. */
	readonly bestAvailableCapability: number | null;
	/** The model the card will actually run on (best available), named in the message. Null ⇒ generic wording. */
	readonly routedModelKey: string | null;
	/**
	 * Minimum (difficulty − capability) gap before an advisory fires (default {@link DEFAULT_CEILING_ADVISORY_MARGIN}).
	 * A small gap is normal fleet stretch; only a material shortfall warrants telling the user.
	 */
	readonly margin?: number;
	/** Whether cloud models are enabled (Phase 14). Default false — the message stays honest about current reality. */
	readonly cloudEnabled?: boolean;
}

export interface CeilingAdvisoryVerdict {
	/** True when the card's difficulty materially exceeds the best available capability. */
	readonly exceedsFleet: boolean;
	/** The material gap (difficulty − capability, clamped ≥ 0); 0 when within reach or unmeasured. */
	readonly gap: number;
	/** The honest, proceed-anyway advisory message, or null when within reach / no evidence. */
	readonly advisory: string | null;
}

/**
 * Decide whether to advise honestly about a card exceeding the fleet, and compose the message. Never blocks —
 * `exceedsFleet` is a signal the caller records/surfaces; execution proceeds on the best available model either
 * way. Unmeasured capability ⇒ no advisory (silence beats a false alarm on thin data).
 */
export function assessCeilingAdvisory(input: CeilingAdvisoryInput): CeilingAdvisoryVerdict {
	const margin = input.margin ?? DEFAULT_CEILING_ADVISORY_MARGIN;
	if (input.bestAvailableCapability === null) {
		return { exceedsFleet: false, gap: 0, advisory: null };
	}
	const gap = input.cardDifficulty - input.bestAvailableCapability;
	if (gap < margin) {
		return { exceedsFleet: false, gap: Math.max(0, gap), advisory: null };
	}
	const model = input.routedModelKey
		? `the best available model (${input.routedModelKey})`
		: "the best available model";
	const escapeHatch = input.cloudEnabled
		? "a stronger local model or a cloud model would resolve it more reliably"
		: "a stronger local model — or a cloud model, once you enable that — would resolve it more reliably";
	return {
		exceedsFleet: true,
		gap,
		advisory:
			`Heads up: this card's difficulty (${input.cardDifficulty.toFixed(2)}) exceeds what your loaded fleet does well ` +
			`for the ${input.role} role (best available capability ${input.bestAvailableCapability.toFixed(2)}, a ${gap.toFixed(2)} gap). ` +
			`Proceeding with ${model}, but the result may be weak — ${escapeHatch}. Your call.`,
	};
}
