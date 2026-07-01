/**
 * Adaptive (ADaPT-style) decomposition-granularity decision (todo §5.AB-(E) — the model-landscape-aware
 * decomposition-vs-run-direct primitive; user 2026-07-01, "RESEARCH + evaluate carefully, do NOT rush").
 *
 * THE QUESTION this answers, per card: **decompose the card, or run it DIRECTLY on the model?** — i.e. adapt the
 * task-graph granularity to BOTH the card's difficulty AND the executor model's capability, rather than always
 * decomposing to the max. The grounding is **ADaPT (As-Needed Decomposition and Planning)**: decompose a task ONLY
 * WHEN the executor model CAN'T handle it directly (+33% on compositional tasks by adapting granularity to task
 * complexity × model capability). The user's sharpening: **if a big/capable model is available, run a complex card
 * DIRECTLY on it (don't over-decompose); only weak models → decompose finer** so each sub-card fits a small model's
 * chaining/synthesis ceiling.
 *
 * REACTIVE (as-needed) is the strongest rule here: !Klein ALREADY emits a "can't-handle" signal at runtime — the
 * §5.AB force-advance stall / the evidence-gate incompleteness / a truncation. When a prior DIRECT attempt raised
 * that signal, this primitive decomposes (the executor demonstrably couldn't handle it directly). Absent that signal,
 * it estimates difficulty-vs-capability up front (difficulty-aware routing / DAAO) and, being ADaPT-faithful, prefers
 * to TRY direct when the model plausibly clears the card — ready to decompose on the can't-handle signal next turn.
 *
 * PURE / TOTAL / DETERMINISTIC: no I/O, no clock, no registry/SDK — same input ⇒ same {@link CardDecompositionDecision}.
 * That makes the granularity policy unit-testable and independently tunable before it drives anything.
 *
 * ⚠️ UNWIRED PRIMITIVE — a carefully-reasoned decision core, NOT a runtime commitment (the user tunes the thresholds +
 * wires it AFTER measurement; do NOT wire/tune blindly). **OWED (do carefully, keyed on real signals):**
 *  - wire into the decomposition path (the CLI/runtime decompose-apply) so a card routes to `run_direct` vs `decompose`
 *    keyed on the ACTUAL §5.AB can't-handle signal (force-advance stall / evidence-gate incompleteness / truncation)
 *    for `priorCantHandleSignal`, and on the §5.AL catalog's fine-grained fields (`chaining`/`synthesis`) for the model;
 *  - TUNE {@link DecompositionDecisionOptions} (esp. `directCapabilityMargin`) VIA MEASUREMENT — over-decomposing wastes
 *    a capable model + adds coordination-failure surface; under-decomposing overloads a weak model into the exact
 *    chaining/synthesis failures the §5.Z sweep measured. Neither default is validated against outcomes yet.
 *
 * Sources (research spine, todo §5.AB-(E)/(F)): ADaPT (As-Needed Decomposition and Planning); TDAG (dynamic decompose
 * + per-subtask agents); DAAO / RouteLLM / confidence-aware routing (difficulty-estimate the card, match to model
 * capability/scale). See also §5.AB-(F) self-scaffolding models (an extreme "capable ⇒ decompose less" case).
 */

import type { ChainingStrength, SynthesisQuality } from "./model-capability-catalog";

/** The two decision outcomes: attempt the card DIRECTLY on the model, or DECOMPOSE it into finer sub-cards. */
export type DecompositionAction = "run_direct" | "decompose";

/**
 * The executor model's relevant capability facts for the granularity decision. `capability` is the §5.AB *effective*
 * score (0–100, e.g. from the MCSR / observed fitness); `chaining`/`synthesis` are the §5.AL fine-grained fields
 * (type-only import from the catalog) — when omitted they're treated as `"unknown"` and the decision stays conservative.
 */
export interface DecompositionModelFacts {
	/** §5.AB effective capability score, 0–100 (higher = more capable). Compared against the card's difficulty. */
	capability: number;
	/**
	 * OPTIONAL multi-step tool-CHAINING strength ({@link ChainingStrength}). A model that can't sustain a chain
	 * (`single_only`/`fails`) must have the card broken into single-tool steps regardless of raw capability; a
	 * chain-capable model (`native`/`via_force`) can be trusted to hold a direct multi-step run.
	 */
	chaining?: ChainingStrength;
	/**
	 * OPTIONAL final-answer SYNTHESIS quality ({@link SynthesisQuality}). Not gated on directly here (chaining is the
	 * dominant predictor of an unattended direct run), but carried so tuning/wiring can weigh it later.
	 */
	synthesis?: SynthesisQuality;
}

/** Input to {@link decideCardDecomposition}. */
export interface CardDecompositionInput {
	/** Estimated card difficulty, 0–100 (higher = harder). Same scale as {@link DecompositionModelFacts.capability}. */
	cardDifficulty: number;
	/** The executor model's capability facts. */
	model: DecompositionModelFacts;
	/**
	 * REACTIVE signal: a PRIOR direct attempt on this card stalled (force-advance), came back evidence-gate incomplete,
	 * or was truncated — the §5.AB "can't-handle" signal. When `true`, decomposition is forced (ADaPT as-needed).
	 */
	priorCantHandleSignal?: boolean;
}

/**
 * TUNABLE thresholds — DOCUMENTED defaults, NOT measurement-validated (see the UNWIRED note in the module header).
 * The user tunes these against §5.Z/§5.AB outcomes before this drives anything.
 */
export interface DecompositionDecisionOptions {
	/**
	 * Capability headroom (in the shared 0–100 scale) required OVER the card's difficulty to run DIRECT with
	 * confidence. `run_direct` (confident) fires only when `capability >= cardDifficulty + directCapabilityMargin`
	 * AND chaining is chain-capable. A capability that clears difficulty but falls WITHIN this margin is "marginal" ⇒
	 * try direct but `confident:false` (ADaPT: ready to decompose on the next can't-handle signal). Default `15` — a
	 * conservative buffer so a barely-sufficient model isn't confidently handed a whole complex card; TUNE via measurement.
	 */
	directCapabilityMargin?: number;
}

/** The default tunables (documented on {@link DecompositionDecisionOptions}; NOT measurement-validated yet). */
export const DEFAULT_DECOMPOSITION_DECISION_OPTIONS: Required<DecompositionDecisionOptions> = {
	directCapabilityMargin: 15,
};

/** The decision: run the card directly or decompose it, with a human-readable reason and a confidence flag. */
export interface CardDecompositionDecision {
	/** `run_direct` = attempt the whole card on the model; `decompose` = break it into finer sub-cards. */
	action: DecompositionAction;
	/** Which rule fired + why — for logs / operator visibility / tuning. */
	reason: string;
	/**
	 * `true` when the rule is a firm verdict (reactive signal, chaining floor, capability below difficulty, or clear
	 * capability margin). `false` for the ADaPT "marginal" case — try direct, but be READY to decompose on the next
	 * can't-handle signal (the caller may pre-arm decomposition / tighten monitoring when `confident` is `false`).
	 */
	confident: boolean;
}

/** Chaining verdicts that CANNOT sustain a multi-step direct run ⇒ force finer, single-tool-step decomposition. */
const CHAINING_CANNOT_SUSTAIN: ReadonlySet<ChainingStrength> = new Set<ChainingStrength>(["single_only", "fails"]);
/** Chaining verdicts strong enough to trust with a direct multi-step run. */
const CHAINING_CAN_SUSTAIN: ReadonlySet<ChainingStrength> = new Set<ChainingStrength>(["native", "via_force"]);

/**
 * Decide, for ONE card, whether to run it DIRECTLY on the model or DECOMPOSE it — the ADaPT-style, capability-aware
 * granularity primitive (todo §5.AB-(E)). Pure / total / deterministic.
 *
 * Rules, in priority order (first match wins; each reason names the rule that fired):
 *  1. `priorCantHandleSignal === true` ⇒ **decompose** (confident) — REACTIVE: the executor already couldn't handle it
 *     directly (force-advance stall / evidence-gate incompleteness / truncation), so break it down. This dominates:
 *     an empirical failure outranks any up-front capability estimate.
 *  2. chaining ∈ {`single_only`,`fails`} ⇒ **decompose** (confident) — the model can't sustain a tool chain, so the
 *     card must become single-tool steps regardless of raw capability.
 *  3. `capability < cardDifficulty` ⇒ **decompose** (confident) — the model is below the card's difficulty; decompose
 *     so each sub-card lands within its ceiling (the "only weak models loaded → decompose finer" case).
 *  4. `capability >= cardDifficulty + directCapabilityMargin` AND chaining ∈ {`native`,`via_force`} ⇒ **run_direct**
 *     (confident) — a clearly-capable, chain-holding model handles the whole card directly; over-decomposing would
 *     waste it + add coordination-failure surface (the "big/capable model → run direct" case).
 *  5. MARGINAL — capability clears difficulty but within the margin, OR chaining is unknown (capability sufficient) ⇒
 *     **run_direct** with `confident:false` (ADaPT: try direct, ready to decompose on the next can't-handle signal).
 *
 * CONSERVATISM ON UNKNOWNS: chaining is only trusted to run direct when it's explicitly chain-capable — an `unknown`
 * (or omitted) chaining NEVER earns a confident `run_direct` (rule 4 requires an explicit `native`/`via_force`); with
 * sufficient capability but unknown chaining the decision is the un-confident marginal `run_direct` (rule 5, ADaPT:
 * probe direct, decompose reactively if it stalls). Capability is always known (it's a plain number on the input).
 */
export function decideCardDecomposition(
	input: CardDecompositionInput,
	options?: DecompositionDecisionOptions,
): CardDecompositionDecision {
	const directCapabilityMargin =
		options?.directCapabilityMargin ?? DEFAULT_DECOMPOSITION_DECISION_OPTIONS.directCapabilityMargin;

	const { cardDifficulty, model, priorCantHandleSignal } = input;
	const chaining: ChainingStrength = model.chaining ?? "unknown";

	// Rule 1 — REACTIVE override: a prior direct attempt raised the §5.AB can't-handle signal ⇒ decompose (confident).
	if (priorCantHandleSignal === true) {
		return {
			action: "decompose",
			reason:
				"Rule 1 (reactive): a prior direct attempt raised the §5.AB can't-handle signal (stall / evidence-gate " +
				"incompleteness / truncation) — decompose as-needed (ADaPT).",
			confident: true,
		};
	}

	// Rule 2 — chaining floor: the model can't sustain a tool chain ⇒ break into single-tool steps (confident).
	if (CHAINING_CANNOT_SUSTAIN.has(chaining)) {
		return {
			action: "decompose",
			reason: `Rule 2 (chaining floor): model chaining="${chaining}" cannot sustain a multi-step chain — decompose into single-tool steps.`,
			confident: true,
		};
	}

	// Rule 3 — below difficulty: the model is under the card's difficulty ⇒ decompose finer (confident).
	if (model.capability < cardDifficulty) {
		return {
			action: "decompose",
			reason: `Rule 3 (below difficulty): capability=${model.capability} < cardDifficulty=${cardDifficulty} — decompose so each sub-card fits the model's ceiling.`,
			confident: true,
		};
	}

	// Rule 4 — clear capable + chain-capable ⇒ run the whole card directly (confident); don't over-decompose.
	const clearsMargin = model.capability >= cardDifficulty + directCapabilityMargin;
	if (clearsMargin && CHAINING_CAN_SUSTAIN.has(chaining)) {
		return {
			action: "run_direct",
			reason:
				`Rule 4 (capable): capability=${model.capability} >= cardDifficulty=${cardDifficulty} + margin=${directCapabilityMargin} ` +
				`and chaining="${chaining}" holds a chain — run the whole card directly (don't over-decompose a capable model).`,
			confident: true,
		};
	}

	// Rule 5 — MARGINAL (ADaPT): capability clears difficulty but within the margin, or chaining is unknown ⇒ try
	// direct un-confidently, ready to decompose on the next can't-handle signal. Reason spells out WHY it's marginal.
	const marginalCause = !clearsMargin
		? `capability=${model.capability} clears cardDifficulty=${cardDifficulty} but is within margin=${directCapabilityMargin}`
		: `chaining="${chaining}" is not confirmed chain-capable`;
	return {
		action: "run_direct",
		reason:
			`Rule 5 (marginal, ADaPT): ${marginalCause} — try direct but stay ready to decompose on the next §5.AB ` +
			"can't-handle signal (unknown fields default conservatively to un-confident).",
		confident: false,
	};
}
