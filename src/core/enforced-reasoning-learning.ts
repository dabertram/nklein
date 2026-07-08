/**
 * §5.AD "learn whether a model NEEDS enforced reasoning" — the per-model learning that turns the §5.AD enforced-reasoning
 * gate from a static heuristic into an adaptive one. Three signals, learned online from real outcomes:
 *   - **native reasoning quality** (6795): how often the model reasons correctly ALONE (no enforcement) — a model that
 *     is reliably right on its own shouldn't pay the enforced-reasoning tax;
 *   - **does enforcement help?** (6796): an A/B tally per reasoning KIND (self-consistency / cross-model debate /
 *     stronger-model carry) of runs where the enforced loop HELPED vs HURT the outcome;
 *   - **which kind wins** (6797): the kind with the best net help for this model.
 * and one decider (6799): {@link shouldApplyEnforcedReasoning} — apply the loop only where the evidence says it pays
 * (low native quality AND a net-positive kind), skip it for models that are reliably right alone.
 *
 * Pure + total + deterministic online folds (no I/O, no clock) — the model-behavior store persists the record and the
 * §5.AB selector consumes the decider. Kept a focused module (not another ModelBehaviorProfile field) so the reasoning
 * learning has one clear home.
 */

/** The enforced-reasoning strategies the loop can apply (matches the §5.AD enforced-reasoning kinds). */
export type EnforcedReasoningKind = "self_consistency" | "cross_model" | "carry";

export const ENFORCED_REASONING_KINDS: readonly EnforcedReasoningKind[] = ["self_consistency", "cross_model", "carry"];

export interface EnforcedReasoningLearning {
	/** Attempts observed with NO enforcement (the model reasoning on its own). */
	nativeSamples: number;
	/** Of those, how many produced a CORRECT/quality-cleared result on the model's own reasoning. */
	nativeCorrect: number;
	/** Per-kind A/B tally: runs where the enforced loop HELPED (flipped a would-be failure) vs HURT (added cost/noise). */
	byKind: Record<EnforcedReasoningKind, { helped: number; hurt: number }>;
}

export function emptyEnforcedReasoningLearning(): EnforcedReasoningLearning {
	return {
		nativeSamples: 0,
		nativeCorrect: 0,
		byKind: {
			self_consistency: { helped: 0, hurt: 0 },
			cross_model: { helped: 0, hurt: 0 },
			carry: { helped: 0, hurt: 0 },
		},
	};
}

/** Fold one NATIVE (un-enforced) attempt: was the model right on its own? Pure — returns a new record. */
export function recordNativeReasoning(
	learning: EnforcedReasoningLearning,
	correct: boolean,
): EnforcedReasoningLearning {
	return {
		...learning,
		nativeSamples: learning.nativeSamples + 1,
		nativeCorrect: learning.nativeCorrect + (correct ? 1 : 0),
	};
}

/** Fold one ENFORCED attempt: did the given enforcement kind HELP the outcome? Pure — returns a new record. */
export function recordEnforcedReasoning(
	learning: EnforcedReasoningLearning,
	kind: EnforcedReasoningKind,
	helped: boolean,
): EnforcedReasoningLearning {
	const current = learning.byKind[kind];
	return {
		...learning,
		byKind: {
			...learning.byKind,
			[kind]: { helped: current.helped + (helped ? 1 : 0), hurt: current.hurt + (helped ? 0 : 1) },
		},
	};
}

/** The model's native-reasoning quality in [0,1] (correct / samples), or null when never observed un-enforced. */
export function nativeReasoningQuality(learning: EnforcedReasoningLearning): number | null {
	return learning.nativeSamples === 0 ? null : learning.nativeCorrect / learning.nativeSamples;
}

/** Net help for a kind (helped − hurt) as a fraction of its samples in [-1,1], or null when the kind is unsampled. */
function netHelp(tally: { helped: number; hurt: number }): number | null {
	const samples = tally.helped + tally.hurt;
	return samples === 0 ? null : (tally.helped - tally.hurt) / samples;
}

/**
 * The enforced-reasoning kind with the best NET help for this model (helped-minus-hurt fraction), or null when no kind
 * has a positive net or none is sampled. Ties break by the canonical kind order.
 */
export function bestEnforcedReasoningKind(learning: EnforcedReasoningLearning): EnforcedReasoningKind | null {
	let best: EnforcedReasoningKind | null = null;
	let bestNet = 0; // strictly-positive net required to win
	for (const kind of ENFORCED_REASONING_KINDS) {
		const net = netHelp(learning.byKind[kind]);
		if (net !== null && net > bestNet) {
			best = kind;
			bestNet = net;
		}
	}
	return best;
}

export interface ApplyEnforcedReasoningOptions {
	/** Native-quality at/above which the model is trusted to reason alone (default 0.8). */
	nativeQualityFloor?: number;
	/** Minimum native samples before native quality is trusted to SUPPRESS enforcement (default 3). */
	minNativeSamples?: number;
}

/**
 * The §5.AB decider (6799): should the enforced-reasoning loop be applied for this model? Apply it when there is a
 * net-positive enforcement kind AND the model is NOT already reliably right on its own (native quality below the floor,
 * or too few native samples to trust). Skip it for models proven reliable alone — no compute tax where it doesn't pay.
 * Returns the winning `kind` to apply when it recommends enforcement.
 */
export function shouldApplyEnforcedReasoning(
	learning: EnforcedReasoningLearning,
	options: ApplyEnforcedReasoningOptions = {},
): { apply: boolean; kind: EnforcedReasoningKind | null; reason: string } {
	const floor = options.nativeQualityFloor ?? 0.8;
	const minNativeSamples = options.minNativeSamples ?? 3;
	const quality = nativeReasoningQuality(learning);
	if (quality !== null && learning.nativeSamples >= minNativeSamples && quality >= floor) {
		return {
			apply: false,
			kind: null,
			reason: `Model reasons reliably on its own (native quality ${(quality * 100).toFixed(0)}% ≥ ${(floor * 100).toFixed(0)}% over ${learning.nativeSamples} samples) — skip the enforced-reasoning tax.`,
		};
	}
	const kind = bestEnforcedReasoningKind(learning);
	if (!kind) {
		return {
			apply: false,
			kind: null,
			reason: "No enforced-reasoning kind has shown a net benefit for this model yet.",
		};
	}
	return { apply: true, kind, reason: `Enforced reasoning via ${kind} has a net benefit for this model.` };
}
