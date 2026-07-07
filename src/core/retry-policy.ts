/**
 * The §5.AA retry-policy decision core — a typed controller strategy table that, given the failure that just happened
 * and what's already been tried, picks the next rung of the adaptive ladder (or parks). Pure + deterministic so the
 * "what to try next" brain is fully testable; the runtime wiring (firing the chosen strategy at the shared model-call
 * seam, in both the chat + swarm paths) is layered on top later.
 *
 * Grounded in the §5.AA fold-in: small models become capable by the HARNESS trying everything that plausibly helps for
 * THIS failure mode — reduce the ask, force the shape, iterate the endpoint, vary the prompt, shrink/rearrange context,
 * sample more, bounce to a different model — bounded by a learned per-model retry budget, skipping rungs already tried
 * (no circles), and always terminating (park) so a stuck task surfaces instead of looping.
 */

import { type FailureCapsule, summarizeFailureCapsules } from "./failure-capsule";
import {
	learnedRetryBudget,
	type ModelBehaviorProfile,
	type ModelOutcomeKind,
	type RetryBudgetOptions,
} from "./model-behavior-profile";

/** One rung of the adaptive retry ladder (§5.AA). `park` = give up + surface for review/escalation. */
export type RetryStrategy =
	| "same_model_retry"
	| "raise_token_budget"
	| "reduced_tool_set"
	| "constrained_schema"
	| "alternate_endpoint"
	| "prompt_variant"
	| "context_shrink"
	| "best_of_n"
	| "cross_model_carry"
	| "decompose"
	| "park";

/**
 * The rungs that plausibly help PER failure mode, in priority order (cheapest/most-targeted first). We only try a rung
 * relevant to the actual failure, so e.g. a `malformed` output doesn't waste a turn on `cross_model_carry` before
 * `constrained_schema`. `success` has no rungs (nothing to retry).
 */
const RELEVANT_STRATEGIES_BY_OUTCOME: Record<ModelOutcomeKind, readonly RetryStrategy[]> = {
	success: [],
	// The model didn't emit a tool call: shrink the menu, force the shape, try a more-structured endpoint, reword.
	no_tool_call: [
		"reduced_tool_set",
		"constrained_schema",
		"alternate_endpoint",
		"prompt_variant",
		"cross_model_carry",
	],
	// It narrated the call as prose: recovery usually catches it; otherwise force the shape / try the native endpoint.
	narrated: ["constrained_schema", "alternate_endpoint", "same_model_retry", "cross_model_carry"],
	// It looped: salvage + retry once, shrink/rearrange context, then carry to a different model.
	loop: ["same_model_retry", "context_shrink", "cross_model_carry"],
	// It timed out: the ask is too big — shrink context, cut tools, or split the task.
	timeout: ["context_shrink", "reduced_tool_set", "decompose", "cross_model_carry"],
	// A no-output `aborted` turn has two causes the classifier can't yet tell apart: a token-budget TRUNCATION (a
	// reasoning model burned `maxTokens` on `reasoning_content` before the call — deterministic at temp 0, so a plain
	// re-run RE-truncates) or a transient stall (SDK/endpoint timeout/iteration boundary — a re-run often completes). So
	// try `raise_token_budget` FIRST (the root-cause fix for truncation via `raisedTokenBudget`; a harmless larger retry
	// for a stall), then a plain re-run, a different endpoint, a shrink, and finally carry to another model.
	aborted: ["raise_token_budget", "same_model_retry", "alternate_endpoint", "context_shrink", "cross_model_carry"],
	// Malformed args/JSON: force a valid shape, then reword, then sample.
	malformed: ["constrained_schema", "prompt_variant", "best_of_n"],
	// Generic failure: a plain retry, sample more, then carry to a better model, then split.
	other_failure: ["same_model_retry", "best_of_n", "cross_model_carry", "decompose"],
};

export interface RetryDecisionInput {
	/** The classified outcome of the attempt that just finished (§5.AA). */
	lastOutcome: ModelOutcomeKind;
	/** How many attempts have run so far for this task (0 = the just-finished first attempt). */
	attemptsSoFar: number;
	/** The learned per-model retry budget (from the §5.AA `ModelBehaviorProfile`); clamped to ≥1. */
	retryBudget: number;
	/** Strategies already tried this task (so we never repeat a rung — no circles). */
	triedStrategies: readonly RetryStrategy[];
}

export interface RetryDecision {
	strategy: RetryStrategy;
	/** Inspectable reason (for the §5.AG "what was tried" surface + the §5.AF ledger). */
	reason: string;
}

/**
 * Decide the next rung. Parks when: the outcome was a success (nothing to retry), the learned retry budget is spent, or
 * every relevant un-tried rung is exhausted. Otherwise returns the first relevant rung not already tried.
 */
export function decideNextRetryStrategy(input: RetryDecisionInput): RetryDecision {
	if (input.lastOutcome === "success") {
		return { strategy: "park", reason: "Last attempt succeeded — no retry needed." };
	}
	const budget = Math.max(1, Math.trunc(input.retryBudget));
	if (input.attemptsSoFar >= budget) {
		return {
			strategy: "park",
			reason: `Learned retry budget (${budget}) exhausted after ${input.attemptsSoFar} attempt(s) — escalate.`,
		};
	}
	const tried = new Set<RetryStrategy>(input.triedStrategies);
	for (const strategy of RELEVANT_STRATEGIES_BY_OUTCOME[input.lastOutcome]) {
		if (!tried.has(strategy)) {
			return {
				strategy,
				reason: `Next ladder rung for a "${input.lastOutcome}" outcome (attempt ${input.attemptsSoFar + 1}/${budget}).`,
			};
		}
	}
	return {
		strategy: "park",
		reason: `No untried ladder rung remains for a "${input.lastOutcome}" outcome — escalate.`,
	};
}

/** The full ladder for a failure mode (priority order) — for the §5.AG "what could be tried" surface + tests. */
export function retryLadderForOutcome(outcome: ModelOutcomeKind): readonly RetryStrategy[] {
	return RELEVANT_STRATEGIES_BY_OUTCOME[outcome];
}

export interface NextAttemptPlan {
	/** The rung to try next (`park` = stop + surface for review/escalation). */
	strategy: RetryStrategy;
	/** True when `strategy === "park"` — the loop should stop retrying. */
	parked: boolean;
	/** The learned per-model retry budget in force. */
	retryBudget: number;
	/** Attempts run so far (echoed for the caller's bookkeeping). */
	attemptsSoFar: number;
	/** The "already tried — do not repeat" note to prepend to the next attempt's context (empty when no prior capsules). */
	doNotRepeatNote: string;
	/** Inspectable reason (for §5.AG + the §5.AF ledger). */
	reason: string;
}

/**
 * The unified §5.AA retry brain — composes the three decision cores into ONE call the model-call seam makes: the learned
 * per-model retry budget (`ModelBehaviorProfile`), the next un-tried ladder rung for the failure mode (`retry-policy`,
 * skipping rungs already in the capsules — no circles), and the "what was tried" note (`failure-capsule`) to carry
 * forward so a weak model doesn't rediscover state. Pure — the effectful loop fires `plan.strategy` and records the new
 * outcome back as a capsule + a ledger event.
 */
export function planNextAttempt(input: {
	lastOutcome: ModelOutcomeKind;
	attemptsSoFar: number;
	profile: ModelBehaviorProfile;
	capsules: readonly FailureCapsule[];
	retryBudgetOptions?: RetryBudgetOptions;
}): NextAttemptPlan {
	const retryBudget = learnedRetryBudget(input.profile, input.retryBudgetOptions);
	const decision = decideNextRetryStrategy({
		lastOutcome: input.lastOutcome,
		attemptsSoFar: input.attemptsSoFar,
		retryBudget,
		triedStrategies: input.capsules.map((capsule) => capsule.strategy),
	});
	return {
		strategy: decision.strategy,
		parked: decision.strategy === "park",
		retryBudget,
		attemptsSoFar: input.attemptsSoFar,
		doNotRepeatNote: summarizeFailureCapsules(input.capsules),
		reason: decision.reason,
	};
}

/**
 * The §5.AA truncation-recovery ESCALATION POLICY: how many output tokens to grant on retry after a `finish:"length"`
 * truncation (a reasoning model that exhausted its budget on `reasoning_content` before the tool call — live-grounded
 * with qwen3.5/qwopus, 2026-07-01). Doubles the budget per retry attempt (attempt 1 → ×2, attempt 2 → ×4, …), clamped to
 * a `ceiling` (derive from the model's context window minus the prompt) and never below the current budget. This is the
 * root-cause fix for the models where thinking-control can't help — every `ALWAYS_REASONING_EXCLUDE` reasoner (qwen3.5,
 * phi-4-mini, R1 distills) ignores `/no_think`, so a bigger budget is their ONLY recovery.
 *
 * Pure. WIRED (2026-07-07 verify): `raise_token_budget` already heads the `aborted` ladder in
 * `RELEVANT_STRATEGIES_BY_OUTCOME`, and the chat model-call seam already applies this to the truncation-retry
 * `maxTokens` (see `raisedTokenBudget` usage in chat-local-llm-adapter). The remaining engine-adoption gap is that the
 * chat seam runs its own live-tuned INLINE ladder rather than routing rung choice through `decideNextRetryStrategy` —
 * a behavior-changing rewire that needs cross-model live validation (see docs/dev/backlog-audit-2026-07-07.md §retry).
 */
export function raisedTokenBudget(input: { current: number; attempt: number; ceiling?: number }): number {
	const base = Math.max(1, Math.trunc(input.current));
	const attempt = Math.max(1, Math.trunc(input.attempt));
	// 2**attempt can grow fast; cap the exponent so a high attempt count can't overflow to a nonsensical number.
	const factor = 2 ** Math.min(attempt, 10);
	const raised = base * factor;
	const ceiling = input.ceiling === undefined ? Number.POSITIVE_INFINITY : Math.max(base, Math.trunc(input.ceiling));
	return Math.min(raised, ceiling);
}
