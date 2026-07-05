/**
 * §5.reasoning-loop — the learned ROUNDS BUDGET (pure core). An enforced-reasoning loop (self-consistency / cross-model
 * debate / stronger-model carry) helps up to a point, then plateaus — burning tokens for no gain. This decides WHEN TO
 * STOP iterating: stop once a satisfactory result is reached, the per-round cap is hit, or the marginal improvement
 * falls below the worth-it floor (diminishing returns). {@link learnRoundsBudget} derives that cap from a history of
 * observed per-round improvements (the round after which gains plateau). Pure + total + deterministic.
 */

export interface RoundState {
	/** Rounds already run. */
	roundsDone: number;
	/** The per-node cap on rounds (the learned budget, or a hard ceiling). */
	maxRounds: number;
	/** Marginal improvement from the MOST RECENT round (e.g. Δ pass-rate / Δ quality). */
	lastImprovement: number;
	/** The minimum marginal improvement worth another round — below this it's diminishing returns. */
	minImprovement: number;
	/** A satisfactory result is already reached (e.g. the repro + regression tests pass) — stop regardless of budget. */
	converged?: boolean;
}

export interface StopDecision {
	stop: boolean;
	reason: string;
}

/** Decide whether to STOP the reasoning loop (pure). Converged → cap-hit → diminishing-returns, else keep iterating. */
export function decideStopIterating(state: RoundState): StopDecision {
	if (state.converged === true) {
		return { stop: true, reason: "A satisfactory result was reached — stop." };
	}
	if (state.roundsDone >= Math.max(0, state.maxRounds)) {
		return { stop: true, reason: `Rounds budget reached (${state.roundsDone}/${state.maxRounds}).` };
	}
	if (state.lastImprovement < state.minImprovement) {
		return {
			stop: true,
			reason: `Diminishing returns: last round improved ${state.lastImprovement} < ${state.minImprovement}.`,
		};
	}
	return { stop: false, reason: "Improving and under budget — keep iterating." };
}

/**
 * Learn the rounds budget from a history of per-round marginal improvements (pure): the number of leading rounds whose
 * gain clears `minImprovement` (i.e. stop once gains plateau), clamped to `[1, cap]`. An empty history ⇒ 1 (try once).
 */
export function learnRoundsBudget(improvements: readonly number[], minImprovement: number, cap: number): number {
	const ceiling = Math.max(1, Math.trunc(cap));
	let worthwhile = 0;
	for (const improvement of improvements) {
		if (improvement >= minImprovement) {
			worthwhile += 1;
		} else {
			break; // gains plateaued — later rounds aren't worth budgeting for
		}
	}
	return Math.min(ceiling, Math.max(1, worthwhile));
}
