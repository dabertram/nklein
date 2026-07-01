/**
 * The §5.AA adaptive strategy-effectiveness ledger — !Klein learns, per model, WHICH remedy rung actually recovers it,
 * and reorders the retry ladder so the historically-most-effective rung is tried FIRST.
 *
 * The user's §5.AA directive: try everything to get a model to deliver, then **learn per-model what works well / less
 * well and persist it globally so failures + retries shrink over time** — adapt, don't run in circles. The existing
 * `retry-policy.ts` picks the next rung from a STATIC, hand-curated per-failure-mode table (`RELEVANT_STRATEGIES_BY_
 * OUTCOME`); it never learns. And `model-behavior-profile.ts` learns a model's OVERALL success rate + retry budget, but
 * NOT which specific strategy pulled it through. This module closes that loop: it estimates, per `(failure-mode ×
 * strategy)`, how often a rung RECOVERED this model (a Beta-posterior / Laplace-smoothed success rate over observed
 * attempts), then reorders the static ladder by that learned effectiveness — so a rung that has repeatedly rescued THIS
 * model climbs to the front, while a rung that has repeatedly flopped sinks, without ever dropping a curated rung
 * entirely (an untried rung keeps its hand-authored priority — cold-start = the proven order).
 *
 * Deliberately PURE + deterministic (an online fold + a stable ordering over plain observations), persistence-free like
 * its `model-behavior-profile` sibling: a thin JSON store in the runtime home wraps it, and the §5.AF ledger's terminal
 * `attempt` events are the observation stream (rung tried → whether it succeeded). Composes with the existing
 * `RetryStrategy` + `ModelOutcomeKind` types (no edits to those files).
 */

import type { ModelOutcomeKind } from "./model-behavior-profile";
import { type RetryStrategy, retryLadderForOutcome } from "./retry-policy";

/**
 * One `(failure-mode → strategy)` cell's evidence: how many times this rung was tried after `outcome` and how many of
 * those recovered the model (produced a success on that attempt). `successes ≤ attempts`, both ≥ 0.
 */
export interface StrategyEffectivenessCell {
	/** The failure mode the rung was applied to remedy. */
	outcome: ModelOutcomeKind;
	/** The remedy rung that was tried. */
	strategy: RetryStrategy;
	/** Total times this rung was tried for this failure mode on this model. */
	attempts: number;
	/** How many of those attempts recovered the model (a subsequent success). */
	successes: number;
}

/** A per-model, per-`(outcome, strategy)` effectiveness ledger. Keyed `"<outcome>::<strategy>"` for O(1) lookup. */
export interface StrategyEffectivenessLedger {
	modelId: string;
	/** Sparse cells — only `(outcome, strategy)` pairs actually observed appear. */
	cells: Record<string, StrategyEffectivenessCell>;
	updatedAt: number;
}

/** One observed attempt to fold in: rung `strategy` was tried after failure `outcome` and did/didn't recover the model. */
export interface StrategyAttemptObservation {
	outcome: ModelOutcomeKind;
	strategy: RetryStrategy;
	/** Whether the rung recovered the model (the attempt it drove ended in a success). */
	recovered: boolean;
}

/** `park` is a terminal give-up, never a remedy we could "learn works" — it is excluded from effectiveness learning. */
function isLearnableStrategy(strategy: RetryStrategy): boolean {
	return strategy !== "park";
}

function cellKey(outcome: ModelOutcomeKind, strategy: RetryStrategy): string {
	return `${outcome}::${strategy}`;
}

export function emptyStrategyEffectivenessLedger(modelId: string, now = 0): StrategyEffectivenessLedger {
	return { modelId, cells: {}, updatedAt: now };
}

export interface StrategyEffectivenessUpdateOptions {
	now?: () => number;
}

/**
 * Fold ONE observed remedy attempt into the ledger (pure — returns a new ledger, never mutates the input). Increments
 * the `(outcome, strategy)` cell's `attempts`, and its `successes` when the rung recovered the model. A `park`
 * observation (or a `success` "failure mode", which has no remedy) is a no-op — those aren't remedy rungs to learn.
 */
export function recordStrategyOutcome(
	ledger: StrategyEffectivenessLedger,
	observation: StrategyAttemptObservation,
	options: StrategyEffectivenessUpdateOptions = {},
): StrategyEffectivenessLedger {
	const now = options.now?.() ?? ledger.updatedAt;
	if (!isLearnableStrategy(observation.strategy) || observation.outcome === "success") {
		return { modelId: ledger.modelId, cells: ledger.cells, updatedAt: now };
	}
	const key = cellKey(observation.outcome, observation.strategy);
	const prior = ledger.cells[key] ?? {
		outcome: observation.outcome,
		strategy: observation.strategy,
		attempts: 0,
		successes: 0,
	};
	const nextCell: StrategyEffectivenessCell = {
		outcome: observation.outcome,
		strategy: observation.strategy,
		attempts: prior.attempts + 1,
		successes: prior.successes + (observation.recovered ? 1 : 0),
	};
	return {
		modelId: ledger.modelId,
		cells: { ...ledger.cells, [key]: nextCell },
		updatedAt: now,
	};
}

export interface StrategyEffectivenessEstimateOptions {
	/**
	 * Beta-prior pseudo-counts (Laplace smoothing). `priorSuccesses`/`priorAttempts` seed the posterior so a cell with no
	 * evidence returns the neutral prior mean (default 1/2 = 0.5) and a single lucky/unlucky observation can't swing the
	 * estimate to 0 or 1. Defaults: `priorSuccesses: 1`, `priorFailures: 1` (a uniform Beta(1,1)).
	 */
	priorSuccesses?: number;
	priorFailures?: number;
}

/**
 * The learned effectiveness of a rung for a failure mode: its Beta-posterior mean recovery rate,
 * `(successes + priorSuccesses) / (attempts + priorSuccesses + priorFailures)` — Laplace-smoothed so it degrades
 * gracefully from the neutral prior (no evidence) toward the empirical rate as observations accumulate. Always in
 * `[0, 1]`. A `park`/unlearnable rung (or an unobserved cell) returns the prior mean.
 */
export function strategyEffectiveness(
	ledger: StrategyEffectivenessLedger,
	outcome: ModelOutcomeKind,
	strategy: RetryStrategy,
	options: StrategyEffectivenessEstimateOptions = {},
): number {
	const priorSuccesses = Math.max(0, options.priorSuccesses ?? 1);
	const priorFailures = Math.max(0, options.priorFailures ?? 1);
	const cell = ledger.cells[cellKey(outcome, strategy)];
	const successes = cell?.successes ?? 0;
	const attempts = cell?.attempts ?? 0;
	const numerator = successes + priorSuccesses;
	const denominator = attempts + priorSuccesses + priorFailures;
	if (denominator <= 0) {
		return 0.5;
	}
	return numerator / denominator;
}

/** How much evidence backs a cell (its attempt count) — the confidence weight behind `strategyEffectiveness`. */
export function strategyObservationCount(
	ledger: StrategyEffectivenessLedger,
	outcome: ModelOutcomeKind,
	strategy: RetryStrategy,
): number {
	return ledger.cells[cellKey(outcome, strategy)]?.attempts ?? 0;
}

export interface OrderLadderOptions extends StrategyEffectivenessEstimateOptions {
	/**
	 * The minimum posterior-mean effectiveness advantage a rung must have over another to jump ahead of it. Below this
	 * margin the curated hand-order wins (a tiny, noise-level learned edge shouldn't reshuffle the proven ladder). Default
	 * 0.05.
	 */
	reorderMargin?: number;
	/**
	 * Minimum observations a rung needs before its learned rate is trusted enough to reorder. A rung with fewer attempts
	 * keeps its curated priority (cold-start safety — one observation shouldn't leapfrog a proven rung). Default 1.
	 */
	minObservations?: number;
}

/**
 * Reorder the static per-outcome retry ladder by learned effectiveness for this model (pure). Starts from the curated
 * `retryLadderForOutcome(outcome)` order and STABLE-sorts it so a rung with a meaningfully higher posterior recovery
 * rate (by at least `reorderMargin`, and backed by at least `minObservations`) climbs ahead of a lower one; ties and
 * sub-margin differences preserve the hand-authored priority. Never adds or drops a rung — cold-start returns the proven
 * order verbatim; as evidence accrues the ladder adapts to what actually rescues THIS model. This is the learned
 * counterpart to `retry-policy`'s static table: feed the result into the retry loop so the best-for-this-model rung is
 * tried first.
 */
export function orderLadderByEffectiveness(
	ledger: StrategyEffectivenessLedger,
	outcome: ModelOutcomeKind,
	options: OrderLadderOptions = {},
): RetryStrategy[] {
	const reorderMargin = Math.max(0, options.reorderMargin ?? 0.05);
	const minObservations = Math.max(0, Math.trunc(options.minObservations ?? 1));
	const ladder = retryLadderForOutcome(outcome);

	// Precompute each rung's curated index (the tie-break) + its trusted effectiveness (only if enough evidence backs it;
	// otherwise it keeps the neutral prior so an unproven rung neither rises nor sinks relative to other unproven ones).
	const curatedIndex = new Map<RetryStrategy, number>();
	const effectiveness = new Map<RetryStrategy, number>();
	ladder.forEach((strategy, index) => {
		curatedIndex.set(strategy, index);
		const observed = strategyObservationCount(ledger, outcome, strategy) >= minObservations;
		effectiveness.set(strategy, observed ? strategyEffectiveness(ledger, outcome, strategy, options) : 0.5);
	});

	return [...ladder].sort((a, b) => {
		const effA = effectiveness.get(a) ?? 0.5;
		const effB = effectiveness.get(b) ?? 0.5;
		// Only let learned effectiveness reorder when the gap clears the noise margin; otherwise defer to curated order.
		if (Math.abs(effA - effB) >= reorderMargin) {
			return effB - effA; // higher effectiveness first
		}
		return (curatedIndex.get(a) ?? 0) - (curatedIndex.get(b) ?? 0); // stable: preserve hand-authored priority
	});
}

/**
 * The single best rung to try FIRST for a failure mode on this model — the head of the effectiveness-ordered ladder, or
 * `null` when the failure mode has no remedy rungs (e.g. `success`). A convenience over `orderLadderByEffectiveness` for
 * the retry seam's "what should I try first?" question.
 */
export function bestStrategyForOutcome(
	ledger: StrategyEffectivenessLedger,
	outcome: ModelOutcomeKind,
	options: OrderLadderOptions = {},
): RetryStrategy | null {
	const ordered = orderLadderByEffectiveness(ledger, outcome, options);
	return ordered[0] ?? null;
}
