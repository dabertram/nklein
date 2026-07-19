/**
 * F12.26 — capability-gated CodeAct (executable code actions). PURE core.
 *
 * CodeAct lets a model express control flow over several tool calls in ONE turn (a loop, a conditional, a
 * pipeline) instead of emitting one structured call per turn. For capable models that is worth roughly +20%
 * success and ~30% fewer steps. For weak models it is a net LOSS: the "structure tax" — having to author correct
 * code as the action format — costs more than the composition saves, and it hurts below ~7B outright.
 *
 * So this is an offer that must be EARNED, and the whole difficulty is deciding who has earned it.
 *
 * ── WHY THIS DOES NOT GATE ON PARAMETER COUNT (the item originally said "30B+") ──
 * Phase 22 recorded two measurements that break parameter count as a capability proxy at agent depth:
 *  - A 30B-A3B model collapsed 32× in prefill from 0→100k context while a 120B degraded 3.9× and ended up 6×
 *    FASTER at depth — attention geometry dominates size.
 *  - BFCL multi-turn is NON-MONOTONIC within one family: Qwen3-8B scores 41.75 where Qwen3-14B scores 34.75.
 * A "30B+" gate would therefore admit models that are bad at exactly the multi-step composition CodeAct demands,
 * and exclude smaller models that are good at it. So the gate prefers MEASURED fitness for this model×role, and
 * falls back to size only when there is no measurement — reporting that fallback as the weak signal it is.
 *
 * Honesty stance: CodeAct HURTS models that cannot carry it, so an unknown capability must NOT buy the offer.
 * Absent evidence resolves to "do not offer" — the direction where being wrong is cheap.
 */

import { parseModelAttributes } from "./model-attributes";
import type { SwarmRole } from "./role-model-class";

/** Below this size the structure tax is documented to hurt outright, whatever else we know. */
export const CODEACT_HARD_FLOOR_B = 7;
/** Measured capability (0..1) at or above which CodeAct is worth offering. */
export const CODEACT_FITNESS_BAR = 0.62;
/** Size fallback, used ONLY when no measurement exists — deliberately conservative. */
export const CODEACT_FALLBACK_SIZE_B = 30;

export type CodeActDecisionKind = "offer" | "withhold";

export interface CodeActDecision {
	readonly kind: CodeActDecisionKind;
	/** True when the decision rests on parameter count rather than a measurement — a WEAK basis, see the docblock. */
	readonly weakBasis: boolean;
	readonly reason: string;
}

export interface CodeActGateInput {
	readonly modelId: string;
	readonly role: SwarmRole;
	/**
	 * Measured capability for THIS model×role from the fitness store, 0..1. `null` when this pairing has never
	 * been measured — which is common on a fresh fleet and must not be read as competence.
	 */
	readonly measuredFitness: number | null;
	/**
	 * How many observations back the measurement. A fitness score drawn from one or two runs is not evidence;
	 * the gate requires a minimum before trusting it over the size fallback.
	 */
	readonly observationCount?: number;
	/** Cards with a single mechanical step gain nothing from composition — the tax is paid for no benefit. */
	readonly multiStep: boolean;
}

/** Below this many observations a fitness score is treated as unmeasured rather than as weak evidence. */
const MIN_OBSERVATIONS = 5;

/**
 * Decide whether to offer CodeAct for this card. Deterministic and explainable — the reason names the signal that
 * drove it, and `weakBasis` tells the caller whether the decision deserves any confidence at all.
 */
export function decideCodeActOffer(input: CodeActGateInput): CodeActDecision {
	const paramB = parseModelAttributes(input.modelId).paramB ?? null;

	// The hard floor is not negotiable by fitness: below ~7B the structure tax is documented to hurt, and a high
	// measured score on a tiny model is more likely to be a small sample than a refutation.
	if (paramB !== null && paramB < CODEACT_HARD_FLOOR_B) {
		return {
			kind: "withhold",
			weakBasis: false,
			reason: `${input.modelId} is ~${paramB}B, below the ${CODEACT_HARD_FLOOR_B}B floor where the structure tax is documented to hurt`,
		};
	}

	if (!input.multiStep) {
		return {
			kind: "withhold",
			weakBasis: false,
			reason: "single-step card — composition has nothing to compose, so the structure tax buys nothing",
		};
	}

	const observations = input.observationCount ?? 0;
	const measured = input.measuredFitness;
	const hasMeasurement = measured !== null && Number.isFinite(measured) && observations >= MIN_OBSERVATIONS;

	if (hasMeasurement) {
		// The strong path: this model×role has actually been observed doing this work.
		return measured >= CODEACT_FITNESS_BAR
			? {
					kind: "offer",
					weakBasis: false,
					reason: `measured fitness ${measured.toFixed(2)} over ${observations} observation(s) clears the ${CODEACT_FITNESS_BAR} bar for ${input.role}`,
				}
			: {
					kind: "withhold",
					weakBasis: false,
					reason: `measured fitness ${measured.toFixed(2)} over ${observations} observation(s) is below the ${CODEACT_FITNESS_BAR} bar — CodeAct costs this pairing more than it returns`,
				};
	}

	// The weak path: no usable measurement, so fall back to size and SAY that the basis is weak. Parameter count
	// is a poor proxy at agent depth (see the docblock), so this is a holding position until observations exist,
	// not a judgement about the model.
	if (paramB === null) {
		return {
			kind: "withhold",
			weakBasis: true,
			reason: `no measured fitness for ${input.modelId} as ${input.role}, and its size cannot be read from the id — CodeAct hurts models that cannot carry it, so an unknown capability does not earn the offer`,
		};
	}
	return paramB >= CODEACT_FALLBACK_SIZE_B
		? {
				kind: "offer",
				weakBasis: true,
				reason: `no measurement yet (${observations} observation(s), need ${MIN_OBSERVATIONS}) — falling back to size ~${paramB}B ≥ ${CODEACT_FALLBACK_SIZE_B}B. WEAK BASIS: parameter count predicts agent-depth composition poorly; replace with measured fitness once observations accrue`,
			}
		: {
				kind: "withhold",
				weakBasis: true,
				reason: `no measurement yet and size ~${paramB}B is below the ${CODEACT_FALLBACK_SIZE_B}B fallback — withholding, since being wrong in this direction only costs some composition, while the other direction taxes a model that cannot pay`,
			};
}
