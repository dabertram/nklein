/**
 * Enforced-reasoning ROUND stop policy (todo §5.AD) — the per-round CONTINUE|STOP decider for an IN-FLIGHT reasoning
 * loop (cross-model debate / self-bounce / self-consistency). Distinct from `enforced-reasoning-gate.ts`, which decides
 * UP-FRONT whether to enforce, which KIND, and a static round BUDGET before any model call. This module runs AFTER each
 * round has produced a result and reads the OBSERVED inter-round progress to decide whether one more round is worth its
 * cost — so the loop stops early the moment reasoning has done its job (or clearly isn't helping), instead of always
 * burning the whole budget.
 *
 * Research (background, see todo.md §5.AD): bound the rounds (§5.K round-limit + stall / identical-loop detection; §5.S
 * no-progress detector) AND recognise that **intrinsic self-correction plateaus** — extra rounds stop buying quality and
 * can HURT (Huang et al. 2023). A debate / cross-model bounce robustly lifts a weak model in ~1 round, so the FIRST
 * improving round is often enough. Concretely the loop should STOP when it has:
 *   - CONVERGED — the last round's quality already clears the target bar (no need to keep bouncing);
 *   - SETTLED — the panel/self agrees strongly enough (self-consistency: high agreement ⇒ more samples won't move it);
 *   - PLATEAUED — the last round improved by less than a meaningful epsilon (diminishing returns);
 *   - REGRESSED — the last round scored WORSE than the running best (self-correction is now hurting; keep the best);
 *   - EXHAUSTED — the round budget from the gate is spent (the hard §5.K terminating bound).
 * Otherwise CONTINUE (the last round made real progress and budget remains) — always terminating because `roundsUsed`
 * strictly increases toward the finite budget.
 *
 * Pure + deterministic — no I/O, no model call, no tokenizer: the per-round quality SCORES, the optional agreement
 * ratio, and the round counters are injected as plain numbers. It reads a scalar trajectory; the effectful loop (running
 * the chosen kind at the model-call seam, reusing the §5.K reviewer seam / §5.AA prompt-variation / the
 * `self-consistency` majority-vote) calls this between rounds and honours the verdict.
 *
 * **Boundary (no duplication):**
 * - §5.AD `enforced-reasoning-gate.ts` `decideEnforcedReasoning` decides BEFORE the loop: enforce? which kind? a static
 *   round budget from difficulty. This decides DURING the loop from live per-round scores; it is the runtime companion
 *   that CONSUMES that budget as its `roundBudget` and can stop well short of it.
 * - §5.AD `context-budget-knee.ts` fits a quality-vs-TOKENS curve (context sizing); this reads a quality-vs-ROUND
 *   trajectory (reasoning-loop control). Different axis, no shared computation.
 * - §5.AD `self-consistency.ts` `majorityVote` produces the `agreement` ratio this may read to stop a settled panel; it
 *   counts votes within ONE round, it does not decide whether to run ANOTHER round.
 */

/** Why the enforced-reasoning loop stopped or continued — inspectable for the §5.AG "what was tried" surface + §5.AF ledger. */
export type ReasoningRoundVerdict =
	/** Run another round — the last round made real progress and budget remains. */
	| "continue"
	/** Stop: the last round's quality already clears the target bar (converged; no need to keep bouncing). */
	| "converged"
	/** Stop: the panel/self agrees strongly enough (self-consistency high agreement ⇒ more samples won't move it). */
	| "settled"
	/** Stop: the last round improved by less than the epsilon (diminishing returns — self-correction has plateaued). */
	| "plateaued"
	/** Stop: the last round scored WORSE than the running best (self-correction is now hurting; keep the best). */
	| "regressed"
	/** Stop: the round budget is spent (the hard, always-terminating §5.K bound). */
	| "exhausted";

export interface ReasoningRoundStopInput {
	/**
	 * How many rounds have COMPLETED so far (≥1 — this is called after a round produced a result). Non-finite / <1 reads
	 * as 1. When it reaches `roundBudget` the loop is `exhausted`.
	 */
	roundsUsed: number;
	/**
	 * The total round budget the gate allotted (`enforced-reasoning-gate.ts`'s `rounds`). Clamped to ≥1; `roundsUsed` at
	 * or beyond it ⇒ `exhausted`. The always-terminating bound.
	 */
	roundBudget: number;
	/** The quality score the MOST-RECENT round produced (any real scale; the unit is the caller's — only comparisons matter). */
	lastQuality: number;
	/**
	 * The best quality any PRIOR round produced (before `lastQuality`), or `null` on the first completed round (nothing to
	 * compare against yet). Non-finite reads as `null`. Used to detect plateau (small gain) and regression (a drop).
	 */
	bestPriorQuality?: number | null;
	/**
	 * The target quality bar (same unit as `lastQuality`): once a round reaches it the loop has CONVERGED and stops. When
	 * omitted (or non-finite) no convergence bar applies and the loop stops only on plateau / regression / settle / budget.
	 */
	targetQuality?: number | null;
	/**
	 * Self-consistency agreement ratio in [0, 1] for the last round (from `self-consistency.ts` `majorityVote`), when the
	 * kind is `self_consistency`. At/above `agreementStopThreshold` the panel is SETTLED and more samples won't move it.
	 * Omitted for the non-voting kinds.
	 */
	lastAgreement?: number | null;
	/**
	 * The minimum quality GAIN over `bestPriorQuality` that counts as "still improving" (same unit as `lastQuality`).
	 * A round that gains less than this has PLATEAUED. Default 0.01. Clamped to ≥0.
	 */
	plateauEpsilon?: number;
	/**
	 * A drop below `bestPriorQuality` deeper than this counts as a REGRESSION (self-correction is hurting). Kept separate
	 * from `plateauEpsilon` so a caller can tolerate small noise-level dips before declaring regression. Default 0
	 * (any drop past the epsilon band regresses). Clamped to ≥0.
	 */
	regressEpsilon?: number;
	/**
	 * Agreement at/above which a `self_consistency` panel is SETTLED (stop). Default 0.75. Clamped to (0, 1]. Only
	 * consulted when `lastAgreement` is provided.
	 */
	agreementStopThreshold?: number;
}

export interface ReasoningRoundStopDecision {
	/** Whether to run another round. `false` for every stop verdict. */
	continueLoop: boolean;
	/** The verdict — `continue` or one of the stop reasons. */
	verdict: ReasoningRoundVerdict;
	/** How many rounds have been used (echoed, clamped) — for the ledger. */
	roundsUsed: number;
	/** Remaining rounds in the budget after this decision (0 when exhausted / stopping on budget). */
	roundsRemaining: number;
	/** The best quality seen SO FAR (max of `bestPriorQuality` and `lastQuality`) — the score the caller should keep. */
	bestQuality: number;
	/** Whether the MOST-RECENT round is the best so far (so the caller knows whether to adopt the last round's output). */
	lastRoundIsBest: boolean;
	/** Human-readable rationale (why this verdict). */
	reason: string;
}

const DEFAULT_PLATEAU_EPSILON = 0.01;
const DEFAULT_REGRESS_EPSILON = 0;
const DEFAULT_AGREEMENT_STOP = 0.75;

/** A finite number, or `fallback` when non-finite. */
function finiteOr(value: number | null | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A finite number, or `null` when non-finite / absent (distinguishes "no prior round" from a real 0 score). */
function finiteOrNull(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

/**
 * Decide whether an in-flight enforced-reasoning loop should run ANOTHER round (pure). Called after each round produces
 * a result, reading the round's quality against the running best + the budget.
 *
 * Precedence (first match wins), chosen so the loop keeps the best output and never wastes rounds:
 *  1. `exhausted` — the budget is spent (the hard terminating bound), regardless of the last score.
 *  2. `converged` — the last round already clears the target bar (its whole purpose is met).
 *  3. `regressed` — the last round dropped below the best by more than the regression epsilon (self-correction is
 *     hurting; stop and keep the best — do NOT let further rounds erode it).
 *  4. `settled` — a self-consistency panel agrees at/above the stop threshold (more samples won't change the vote).
 *  5. `plateaued` — the last round gained less than the plateau epsilon over the best (diminishing returns).
 *  6. `continue` — real progress and budget remains.
 *
 * Always terminating: `roundsUsed` strictly increases toward the finite `roundBudget`, so `exhausted` is guaranteed to
 * fire if nothing stops the loop sooner. Never mutates the input.
 */
export function decideReasoningRoundStop(input: ReasoningRoundStopInput): ReasoningRoundStopDecision {
	const roundBudget = Math.max(1, Math.trunc(finiteOr(input.roundBudget, 1)));
	const roundsUsed = Math.max(1, Math.trunc(finiteOr(input.roundsUsed, 1)));
	const lastQuality = finiteOr(input.lastQuality, 0);
	const bestPrior = finiteOrNull(input.bestPriorQuality);
	const target = finiteOrNull(input.targetQuality);
	const agreement = input.lastAgreement == null ? null : clamp01(input.lastAgreement);
	const plateauEpsilon = Math.max(0, finiteOr(input.plateauEpsilon, DEFAULT_PLATEAU_EPSILON));
	const regressEpsilon = Math.max(0, finiteOr(input.regressEpsilon, DEFAULT_REGRESS_EPSILON));
	const agreementStop = clampFractionOpen(input.agreementStopThreshold, DEFAULT_AGREEMENT_STOP);

	const bestQuality = bestPrior === null ? lastQuality : Math.max(bestPrior, lastQuality);
	// Ties count as "best": a round that matches the prior best is still an acceptable output to adopt.
	const lastRoundIsBest = bestPrior === null || lastQuality >= bestPrior;
	const roundsRemainingRaw = Math.max(0, roundBudget - roundsUsed);

	const stop = (verdict: ReasoningRoundVerdict, reason: string): ReasoningRoundStopDecision => ({
		continueLoop: false,
		verdict,
		roundsUsed,
		roundsRemaining: 0,
		bestQuality,
		lastRoundIsBest,
		reason,
	});

	// 1. Budget spent — the hard terminating bound (checked first so it wins even if the last round also converged).
	if (roundsUsed >= roundBudget) {
		return stop(
			"exhausted",
			`round budget spent (${roundsUsed}/${roundBudget}) — stopping; keeping best quality ${bestQuality}.`,
		);
	}

	// 2. Converged — the last round clears the target bar; the loop's purpose is met.
	if (target !== null && lastQuality >= target) {
		return stop(
			"converged",
			`last round quality ${lastQuality} >= target ${target} after ${roundsUsed} round(s) — converged.`,
		);
	}

	// 3. Regressed — the last round dropped below the running best by more than the regression tolerance; further rounds
	// are hurting (Huang et al.). Stop and keep the best. Only when there IS a prior best to fall from.
	if (bestPrior !== null && lastQuality < bestPrior - regressEpsilon) {
		return stop(
			"regressed",
			`last round quality ${lastQuality} fell below best ${bestPrior} (> ${regressEpsilon}) — self-correction hurting; keeping best.`,
		);
	}

	// 4. Settled — a self-consistency panel agrees strongly enough that more samples won't move the vote.
	if (agreement !== null && agreement >= agreementStop) {
		return stop(
			"settled",
			`agreement ${agreement.toFixed(2)} >= stop threshold ${agreementStop.toFixed(2)} — panel settled after ${roundsUsed} round(s).`,
		);
	}

	// 5. Plateaued — the last round gained less than the epsilon over the best (diminishing returns). Only meaningful once
	// a prior best exists (the first round always has "infinite" gain from nothing).
	if (bestPrior !== null && lastQuality - bestPrior < plateauEpsilon) {
		return stop(
			"plateaued",
			`last round gain ${(lastQuality - bestPrior).toFixed(4)} < epsilon ${plateauEpsilon} — diminishing returns; stopping.`,
		);
	}

	// 6. Real progress (or the first round, with no plateau/regression possible yet) and budget remains → continue.
	return {
		continueLoop: true,
		verdict: "continue",
		roundsUsed,
		roundsRemaining: roundsRemainingRaw,
		bestQuality,
		lastRoundIsBest,
		reason:
			bestPrior === null
				? `first round complete (quality ${lastQuality}); ${roundsRemainingRaw} round(s) left — continuing.`
				: `last round improved (${bestPrior} → ${lastQuality}); ${roundsRemainingRaw} round(s) left — continuing.`,
	};
}

/** Clamp a fraction into (0, 1]; a non-finite / non-positive input falls back to `fallback`, and >1 clamps to 1. */
function clampFractionOpen(value: number | undefined, fallback: number): number {
	const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	if (raw <= 0) {
		return fallback;
	}
	return raw > 1 ? 1 : raw;
}
