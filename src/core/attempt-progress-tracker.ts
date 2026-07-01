/**
 * The §5.AA cross-attempt PROGRESS tracker — the pure primitive that answers "did the last remedy actually improve
 * anything MEASURABLE?" by comparing two consecutive attempts' observable snapshots.
 *
 * Why this is a genuine gap (grep-confirmed against the §5.AA cores): the retry ladder can pick + fire remedies
 * (`retry-policy.ts`, `adaptive-attempt-loop.ts`) and can PARK when the budget/rungs run out — but its park decision is
 * blind to whether the attempts are getting anywhere. Two failing attempts look identical to `decideNextRetryStrategy`
 * whether the second one crept closer (0 tool calls → a malformed call, or 1/4 chain steps → 2/4) or flat-lined (the
 * exact same no-call every time). And `agent-stuckness.ts` (§5.AB) already CONSUMES a `hadProgressSinceStuck` boolean —
 * but nothing COMPUTES it; its `buildStucknessSignalsFromReport` hard-codes it to `false` because the report carries no
 * cross-attempt delta. This module is that missing computation: the anti-thrash signal that lets the loop keep going
 * while a weak model is inching forward and stop early when it's spinning in place, distinct from the ladder's
 * rung-exhaustion park.
 *
 * The measure is deliberately model-AGNOSTIC + observable (never the model's own claim, per AGENTS.md): outcome
 * severity moving toward `success`, more tool calls landing, more DISTINCT tools exercised (breadth through a chain),
 * more acceptance checks passing, and more salvageable output produced. Any one of these advancing counts as progress;
 * a slide back on any counts as regression; unchanged on all is a plateau. Fully pure + deterministic (mirrors
 * `focus-chain-diff.ts`'s progressed/regressed shape): two snapshots as injected values in, a plain verdict out — so
 * the effectful loop (chat + swarm) can feed it the last two ledger `attempt` snapshots and read the verdict without
 * duplicating any progress logic. Composes the existing §5.AA types by import only (no edits to siblings).
 */

import type { ModelOutcomeKind } from "./model-behavior-profile";
import type { RetryStrategy } from "./retry-policy";

/**
 * Ordinal "closeness to done" rank of an attempt outcome — how far the turn got toward a usable result. Used only to
 * classify an outcome CHANGE across attempts as forward (progress) vs backward (regression); it is NOT a quality score.
 *
 * Grounded in the §5.AA taxonomy semantics: `success` is the top; a `narrated`/`malformed` turn actually PRODUCED a
 * call-shaped attempt (recovery/forcing is one rung away) so it ranks above a bare `no_tool_call` (the model didn't
 * even try); a `loop` produced content but is stuck re-emitting, just above no-call; a `timeout`/`aborted` yielded no
 * usable turn at all and `other_failure` is the opaque floor. The absolute values don't matter — only the ordering,
 * so a jump from `no_tool_call`(2) to `malformed`(4) reads as forward movement toward a recoverable call.
 */
const OUTCOME_PROGRESS_RANK: Record<ModelOutcomeKind, number> = {
	other_failure: 0,
	timeout: 1,
	aborted: 1,
	no_tool_call: 2,
	loop: 3,
	narrated: 4,
	malformed: 4,
	success: 5,
};

/**
 * One attempt's OBSERVABLE snapshot — the concrete, model-agnostic facts of a finished attempt (never the model's own
 * claim of progress). Only `outcome` is required; every metric is optional so a caller with partial telemetry (e.g. a
 * turn that tracked tool calls but not acceptance checks) still gets a meaningful verdict on the fields it has.
 */
export interface AttemptProgressSnapshot {
	/** The classified §5.AA outcome of the attempt (its closeness-to-done anchor). */
	outcome: ModelOutcomeKind;
	/** The remedy rung that produced this attempt (`null` = the baseline first attempt). Echoed into the verdict. */
	strategy?: RetryStrategy | null;
	/** How many structured/recovered tool calls the attempt landed (0 = none). More = forward. */
	toolCallsEmitted?: number;
	/**
	 * How many DISTINCT tools the attempt exercised — breadth through a multi-step chain. A weak model that re-emits
	 * the SAME call every turn shows `toolCallsEmitted` rising but `distinctToolsExercised` flat: that's NOT progress
	 * (the §5.AA repeated-call / no-advance failure mode), which this field lets the tracker catch.
	 */
	distinctToolsExercised?: number;
	/** Acceptance/verification checks passing after this attempt (more green = forward). */
	checksPassed?: number;
	/** Bytes (or chars) of salvageable/usable output produced (more = forward; useful when nothing else moved). */
	usableOutputBytes?: number;
}

/** The dimensions along which an attempt can move relative to the previous one — for an inspectable, per-axis verdict. */
export type AttemptProgressDimension = "outcome" | "tool_calls" | "distinct_tools" | "checks_passed" | "usable_output";

export interface AttemptProgressVerdict {
	/**
	 * True when at least one measurable dimension advanced AND none regressed — a clean net-forward step (mirrors
	 * `focus-chain-diff`'s `progressed`). A mixed attempt (one axis up, another down) is NOT clean progress.
	 */
	progressed: boolean;
	/** True when at least one dimension moved backward (a slide) — the caller may treat this as worse than a plateau. */
	regressed: boolean;
	/**
	 * True when NO measurable dimension moved in either direction — the remedy changed nothing observable (the
	 * anti-thrash "spinning in place" signal an exhaustion decider / stuckness classifier keys on).
	 */
	plateaued: boolean;
	/** The dimensions that advanced (in a stable, canonical order). */
	improvedDimensions: AttemptProgressDimension[];
	/** The dimensions that slid back (in a stable, canonical order). */
	regressedDimensions: AttemptProgressDimension[];
	/** The remedy rung that produced the CURRENT (later) attempt (echoed from its snapshot; `null` = baseline). */
	strategy: RetryStrategy | null;
	/** A short, deterministic human reason (for the §5.AG "what was tried" surface + the §5.AF ledger). */
	reason: string;
}

/** The canonical order dimensions are reported in, so a verdict is deterministic regardless of check order. */
const DIMENSION_ORDER: readonly AttemptProgressDimension[] = [
	"outcome",
	"tool_calls",
	"distinct_tools",
	"checks_passed",
	"usable_output",
];

/**
 * Compare one metric across two snapshots and record it as improved/regressed. Only counts when BOTH snapshots supply
 * the field (an absent metric on either side is "unknown", never a phantom move). `outcome` uses the rank table; the
 * numeric metrics compare directly. Mutates the two accumulator arrays in place (kept private).
 */
function compareDimension(
	dimension: AttemptProgressDimension,
	previousValue: number | undefined,
	currentValue: number | undefined,
	improved: AttemptProgressDimension[],
	regressed: AttemptProgressDimension[],
): void {
	if (previousValue === undefined || currentValue === undefined) {
		return;
	}
	if (currentValue > previousValue) {
		improved.push(dimension);
	} else if (currentValue < previousValue) {
		regressed.push(dimension);
	}
}

/**
 * Compute the cross-attempt progress verdict for two CONSECUTIVE attempts (`previous` → `current`). Pure + deterministic.
 *
 * Semantics: each measurable dimension is compared independently; the attempt "progressed" only when something advanced
 * and nothing slid back (a mixed step is not clean progress), "regressed" when anything slid back, and "plateaued" when
 * nothing moved on any dimension both snapshots share. The outcome axis uses `OUTCOME_PROGRESS_RANK` so a
 * `no_tool_call → malformed` step reads as forward (a recoverable call is now one rung away). Missing metrics are
 * ignored (never a phantom move), so partial telemetry still yields a sound verdict on the fields present.
 */
export function assessAttemptProgress(
	previous: AttemptProgressSnapshot,
	current: AttemptProgressSnapshot,
): AttemptProgressVerdict {
	const improved: AttemptProgressDimension[] = [];
	const regressed: AttemptProgressDimension[] = [];

	compareDimension(
		"outcome",
		OUTCOME_PROGRESS_RANK[previous.outcome],
		OUTCOME_PROGRESS_RANK[current.outcome],
		improved,
		regressed,
	);
	compareDimension("tool_calls", previous.toolCallsEmitted, current.toolCallsEmitted, improved, regressed);
	compareDimension(
		"distinct_tools",
		previous.distinctToolsExercised,
		current.distinctToolsExercised,
		improved,
		regressed,
	);
	compareDimension("checks_passed", previous.checksPassed, current.checksPassed, improved, regressed);
	compareDimension("usable_output", previous.usableOutputBytes, current.usableOutputBytes, improved, regressed);

	// Re-project into the canonical dimension order so the verdict is stable regardless of comparison order above.
	const improvedDimensions = DIMENSION_ORDER.filter((dimension) => improved.includes(dimension));
	const regressedDimensions = DIMENSION_ORDER.filter((dimension) => regressed.includes(dimension));

	const progressed = improvedDimensions.length > 0 && regressedDimensions.length === 0;
	const regressedFlag = regressedDimensions.length > 0;
	const plateaued = improvedDimensions.length === 0 && regressedDimensions.length === 0;
	const strategy = current.strategy ?? null;

	return {
		progressed,
		regressed: regressedFlag,
		plateaued,
		improvedDimensions,
		regressedDimensions,
		strategy,
		reason: buildReason({ progressed, regressed: regressedFlag, plateaued, improvedDimensions, regressedDimensions }),
	};
}

/** Deterministic one-liner describing the verdict (mixed / progressed / regressed / plateau), for §5.AG + the ledger. */
function buildReason(input: {
	progressed: boolean;
	regressed: boolean;
	plateaued: boolean;
	improvedDimensions: AttemptProgressDimension[];
	regressedDimensions: AttemptProgressDimension[];
}): string {
	if (input.plateaued) {
		return "No measurable change since the last attempt (plateau).";
	}
	if (input.progressed) {
		return `Progressed since the last attempt: ${input.improvedDimensions.join(", ")} improved.`;
	}
	if (input.regressed && input.improvedDimensions.length === 0) {
		return `Regressed since the last attempt: ${input.regressedDimensions.join(", ")} slid back.`;
	}
	// Mixed: something improved AND something regressed — not clean progress, surfaced honestly.
	return `Mixed since the last attempt: ${input.improvedDimensions.join(", ")} improved but ${input.regressedDimensions.join(", ")} slid back.`;
}

/**
 * The §5.AB `hadProgressSinceStuck` signal, COMPUTED (not assumed) from an attempt-snapshot chain — the exact boolean
 * `agent-stuckness.ts` consumes but never derives (`buildStucknessSignalsFromReport` hard-codes it `false`). Returns
 * true when ANY consecutive step in the trailing episode was a clean net-forward move: the model IS getting somewhere,
 * so it is not (yet) hard-stuck regardless of the outcome kinds. Empty / single-snapshot chains ⇒ false (no evidence of
 * movement). Pure; the effectful mapper feeds it the ledger's per-attempt snapshots.
 */
export function hadProgressAcrossAttempts(snapshots: readonly AttemptProgressSnapshot[]): boolean {
	for (let index = 1; index < snapshots.length; index++) {
		const previous = snapshots[index - 1];
		const current = snapshots[index];
		// Defensive: a bad index can't occur for this range, but satisfies noUncheckedIndexedAccess if this module is
		// ever compiled under the stricter web tsconfig (like its `agent-stuckness` consumer).
		if (previous === undefined || current === undefined) {
			continue;
		}
		if (assessAttemptProgress(previous, current).progressed) {
			return true;
		}
	}
	return false;
}

/**
 * How many attempts in a row (counting back from the most recent) made NO forward progress — the "stalled streak" an
 * exhaustion / give-up decider keys on (distinct from the ladder's rung-exhaustion park: a model can have untried rungs
 * left yet be plateauing on every one). A step counts toward the streak when it did not cleanly progress
 * (`plateaued` OR `regressed`); the first clean-progress step from the tail breaks it. A chain with < 2 snapshots has
 * no comparison to make ⇒ streak 0. Pure + deterministic.
 */
export function consecutiveNoProgressAttempts(snapshots: readonly AttemptProgressSnapshot[]): number {
	let streak = 0;
	for (let index = snapshots.length - 1; index >= 1; index--) {
		const previous = snapshots[index - 1];
		const current = snapshots[index];
		if (previous === undefined || current === undefined) {
			continue;
		}
		if (assessAttemptProgress(previous, current).progressed) {
			break;
		}
		streak++;
	}
	return streak;
}
