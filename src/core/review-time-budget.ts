/**
 * P1.REVIEWBUDGET — the reviewer's time budget, DERIVED from observed turn latency instead of guessed. PURE core.
 *
 * ── THE FAILURE THIS COMES FROM (2026-09-09, measured) ──
 * The budget was a flat 10 minutes with a verdict RESERVE carved out of it. The drain sets the reserve to 6, which
 * leaves FOUR minutes of exploration — and a reviewer must read the source, run the acceptance command, and then
 * call `submit_review`: three or four model turns. On a seat answering at ~1.5 minutes a turn that cannot fit, and
 * the runtime log said so 38 times ("exploration turn cut at the verdict reserve"). Each cut produced a nudge or a
 * fresh review session with no memory of the verification already done; 18 stalled-review rescues fired and one
 * shift spent 4 of its 25 requests re-approving the same two cards. **The verdicts were not being dropped — they
 * were never being reached.** Raising the reserve makes it worse: the reserve comes OUT of the budget.
 *
 * ── WHY THIS CAN ONLY LENGTHEN ──
 * `floorMs` is the currently-configured budget, so a derivation can never SHORTEN a review. That asymmetry is
 * deliberate: too much budget costs one seat some idle minutes on a review that stalls (and the nudge ladder and
 * the stalled-review rescue still bound it), while too little costs the verdict itself and re-runs the whole
 * review. The ceiling keeps a pathological latency observation from parking a seat indefinitely.
 *
 * ── WHY THE SLOWEST OBSERVATION, NOT THE REVIEWER'S OWN ──
 * The session bracket's deadline is fixed BEFORE the reviewer model is resolved (the pick happens inside the
 * bracket), so the exact reviewer's latency is not knowable at budget time without restructuring that path. The
 * slowest observed turn among models that have observations is the conservative stand-in: it is never shorter than
 * the reviewer's own latency, and being generous is the safe direction here.
 *
 * Pure + total: no clock, no I/O; absent or malformed evidence yields the floor unchanged.
 */

/** Turns a review needs before it can submit: read the diff/source, run the acceptance check, then submit. */
export const DEFAULT_EXPECTED_REVIEW_TURNS = 4;

/** Never park a seat longer than this on one review, however slow the fleet looks. */
export const REVIEW_BUDGET_CEILING_MS = 60 * 60_000;

export interface ReviewTimeBudgetInput {
	/**
	 * Observed wall-clock turn latencies (ms) from the model registry's speed evidence. Any non-finite or
	 * non-positive entry is ignored — an unobserved model must not read as an instant one.
	 */
	readonly observedTurnMs: readonly (number | null | undefined)[];
	/** The verdict reserve carved out of the budget; the derivation adds it ON TOP of the exploration turns. */
	readonly reserveMs: number;
	/** The currently-configured budget. The result is never below it — this mechanism only ever lengthens. */
	readonly floorMs: number;
	readonly expectedTurns?: number;
	readonly ceilingMs?: number;
	/**
	 * An EXPLICIT operator budget (`NKLEIN_REVIEW_TIMEOUT_MS`). When set it wins outright: a human who named a
	 * number is not overridden by evidence. Null/absent ⇒ derive.
	 */
	readonly configuredMs?: number | null;
}

export interface ReviewTimeBudget {
	readonly budgetMs: number;
	/** Why this number — carried into the log/observation so a long review can be explained rather than guessed at. */
	readonly reason: string;
	/** True when observed latency actually moved the budget above the floor. */
	readonly derived: boolean;
}

function positiveFinite(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function resolveReviewTimeBudgetMs(input: ReviewTimeBudgetInput): ReviewTimeBudget {
	const floorMs = positiveFinite(input.floorMs) ? input.floorMs : 0;
	if (positiveFinite(input.configuredMs)) {
		return {
			budgetMs: input.configuredMs,
			reason: `operator-configured review budget (${Math.round(input.configuredMs / 60_000)} min)`,
			derived: false,
		};
	}
	const observations = (input.observedTurnMs ?? []).filter(positiveFinite);
	if (observations.length === 0) {
		return {
			budgetMs: floorMs,
			reason: "no observed turn latency yet — keeping the configured budget",
			derived: false,
		};
	}
	const slowestTurnMs = Math.max(...observations);
	const expectedTurns = positiveFinite(input.expectedTurns) ? input.expectedTurns : DEFAULT_EXPECTED_REVIEW_TURNS;
	const reserveMs = positiveFinite(input.reserveMs) ? input.reserveMs : 0;
	const ceilingMs = positiveFinite(input.ceilingMs) ? input.ceilingMs : REVIEW_BUDGET_CEILING_MS;
	const wanted = expectedTurns * slowestTurnMs + reserveMs;
	const budgetMs = Math.min(Math.max(wanted, floorMs), Math.max(ceilingMs, floorMs));
	const derived = budgetMs > floorMs;
	return {
		budgetMs,
		reason: derived
			? `derived from observed turn latency: ${expectedTurns} turns x ${Math.round(slowestTurnMs / 1000)}s + ` +
				`${Math.round(reserveMs / 60_000)} min verdict reserve = ${Math.round(budgetMs / 60_000)} min` +
				(wanted > ceilingMs ? " (capped at the ceiling)" : "")
			: `observed turn latency (${Math.round(slowestTurnMs / 1000)}s) fits inside the configured budget`,
		derived,
	};
}
