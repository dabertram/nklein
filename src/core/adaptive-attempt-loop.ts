/**
 * The §5.AA adaptive-attempt DRIVER — the effectful loop that ties the retry-policy decision core together. The pure
 * brain (`planNextAttempt` in [retry-policy.ts](./retry-policy.ts)) decides *what to try next*; this is the generic,
 * injectable loop that actually *runs* it: call the model → classify the turn's outcome → on failure ask the brain for
 * the next un-tried rung → run that rung (carrying the "do-not-repeat" note so a weak model doesn't rediscover state) →
 * record a failure capsule (no circles) → repeat, bounded by the learned per-model retry budget, ALWAYS terminating with
 * the best partial result and an inspectable park reason. Pure over an injected `runAttempt` so it is fully unit-testable
 * with a fake and is shared by BOTH the chat path and the swarm session runtime (one seam, no duplicated ladder logic).
 */

import { buildFailureCapsule, type FailureCapsule } from "./failure-capsule";
import type { ModelBehaviorProfile, ModelOutcomeKind, RetryBudgetOptions } from "./model-behavior-profile";
import { planNextAttempt, type RetryStrategy } from "./retry-policy";

/** The observable signals of ONE finished model turn — enough to classify it into a §5.AA `ModelOutcomeKind`. */
export interface TurnOutcomeSignals {
	/** How many structured/recovered tool calls the turn produced (0 = none). */
	toolCallsEmitted: number;
	/**
	 * Whether the instruction actually CALLED FOR a tool (it named/anchored one). A no-call turn is only a FAILURE when a
	 * tool was expected; a no-call answer to a plain question is a legitimate `success`, never a `no_tool_call`.
	 */
	toolExpected: boolean;
	/** The turn's text reply ran into a detected repetition loop (§5.AA salvage). */
	looped?: boolean;
	/** A tool call was attempted but its arguments / JSON could not be parsed. */
	malformed?: boolean;
	/** The turn ended on a timeout / iteration boundary with no usable output. */
	timedOut?: boolean;
	/** The reply NARRATED a tool call in prose (a call-shaped phrase) without emitting a structured one. */
	narratedCall?: boolean;
}

/**
 * Classify a finished model turn into the §5.AA outcome taxonomy (pure). Precedence puts the unambiguous signals first:
 * a turn that actually emitted a call is a `success` regardless of any prose around it; otherwise a hard transient
 * (timeout) → a degenerate loop → a malformed call → a narrated-but-unstructured call → a plain no-call when a tool was
 * expected; with no tool expected, a no-call turn is a legitimate direct answer (`success`).
 */
export function classifyTurnOutcome(signals: TurnOutcomeSignals): ModelOutcomeKind {
	if (signals.toolCallsEmitted > 0) {
		return "success";
	}
	if (signals.timedOut) {
		return "timeout";
	}
	if (signals.looped) {
		return "loop";
	}
	if (signals.malformed) {
		return "malformed";
	}
	if (signals.narratedCall) {
		return "narrated";
	}
	if (signals.toolExpected) {
		return "no_tool_call";
	}
	return "success";
}

/** One attempt's result + its classified outcome, returned by the injected `runAttempt`. */
export interface AdaptiveAttemptResult<TResult> {
	/** The attempt's payload (the model response, a tool call, a parsed artifact — whatever the caller needs). */
	result: TResult;
	/** The classified §5.AA outcome of this attempt. */
	outcome: ModelOutcomeKind;
	/** Concrete observed evidence for the capsule (never the model's own claim). Optional — a default is derived. */
	evidence?: string;
	/** Why the attempt failed, for the capsule. Optional — a default is derived from the outcome. */
	whyFailed?: string;
}

export interface AdaptiveAttemptLoopInput<TResult> {
	/** The model's learned behaviour profile — supplies the per-model retry budget. */
	profile: ModelBehaviorProfile;
	/**
	 * Run a single attempt. `strategy` is `null` for the FIRST (baseline) attempt, then the ladder rung the brain chose;
	 * `doNotRepeatNote` is the accumulated "already tried — do not repeat" context to prepend (empty on the first attempt).
	 */
	runAttempt: (strategy: RetryStrategy | null, doNotRepeatNote: string) => Promise<AdaptiveAttemptResult<TResult>>;
	/** Tuning for the learned retry budget (passed through to `planNextAttempt`). */
	retryBudgetOptions?: RetryBudgetOptions;
	/** A hard safety cap on total attempts regardless of the learned budget (defaults to 8). */
	maxAttempts?: number;
}

export interface AdaptiveAttemptLoopOutcome<TResult> {
	/** The best/last attempt's result — ALWAYS present (the loop never returns nothing). */
	result: TResult;
	/** The final attempt's classified outcome. */
	outcome: ModelOutcomeKind;
	/** Total attempts run (≥1). */
	attempts: number;
	/** The ladder rungs tried, in order (excludes the baseline first attempt). */
	strategiesTried: RetryStrategy[];
	/** The failure capsules recorded for the un-successful attempts (the §5.AG/§5.AF "what was tried" chain). */
	capsules: FailureCapsule[];
	/** The park reason when the loop stopped WITHOUT success (budget spent / no untried rung); `null` on success. */
	parkedReason: string | null;
}

/**
 * Run the adaptive retry loop. Calls `runAttempt(null, "")` once, then — while the latest outcome is a failure and the
 * brain has an untried rung within budget — fires the next rung, recording each failed rung as a capsule so the brain
 * never repeats it. Stops on the first success, when the brain parks, or at `maxAttempts`. Returns the last result
 * either way (best partial), plus the tried-chain and a park reason when it ended unsuccessfully.
 */
export async function runAdaptiveAttemptLoop<TResult>(
	input: AdaptiveAttemptLoopInput<TResult>,
): Promise<AdaptiveAttemptLoopOutcome<TResult>> {
	const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts ?? 8));
	const capsules: FailureCapsule[] = [];
	const strategiesTried: RetryStrategy[] = [];

	let current = await input.runAttempt(null, "");
	let attemptsSoFar = 1;

	while (current.outcome !== "success") {
		const plan = planNextAttempt({
			lastOutcome: current.outcome,
			attemptsSoFar,
			profile: input.profile,
			capsules,
			...(input.retryBudgetOptions ? { retryBudgetOptions: input.retryBudgetOptions } : {}),
		});
		if (plan.parked || attemptsSoFar >= maxAttempts) {
			const parkedReason = plan.parked
				? plan.reason
				: `Hard attempt cap (${maxAttempts}) reached after ${attemptsSoFar} attempt(s) — escalate.`;
			return {
				result: current.result,
				outcome: current.outcome,
				attempts: attemptsSoFar,
				strategiesTried,
				capsules,
				parkedReason,
			};
		}
		const strategy = plan.strategy;
		const next = await input.runAttempt(strategy, plan.doNotRepeatNote);
		attemptsSoFar += 1;
		strategiesTried.push(strategy);
		if (next.outcome !== "success") {
			capsules.push(
				buildFailureCapsule({
					strategy,
					outcome: next.outcome,
					...(next.evidence ? { evidence: next.evidence } : {}),
					...(next.whyFailed ? { whyFailed: next.whyFailed } : {}),
				}),
			);
		}
		current = next;
	}

	return {
		result: current.result,
		outcome: "success",
		attempts: attemptsSoFar,
		strategiesTried,
		capsules,
		parkedReason: null,
	};
}
