/**
 * Failure capsules — PURE core for todo §5.AA(b). Each retry attempt writes a capsule recording **what was tried, the
 * observed evidence, and why it failed**, so the next rung never re-asks a weak model to rediscover state it already
 * explored (the small-LLM failure mode: a model that "starts over" each attempt, losing the prior evidence). The
 * capsules accumulate across an attempt chain; `summarizeFailureCapsules` turns them into a compact context note the
 * controller prepends to the next attempt, and `untriedStrategies` lets the retry loop pick a rung that hasn't been
 * tried (complements `retry-policy`'s per-outcome ladder — no circles).
 *
 * Pure + deterministic; the persisted form is a `controller`/`attempt` event on the §5.AF ledger. Built core-first,
 * mirroring `retry-policy` / `run-state-machine`.
 */

import type { ModelOutcomeKind } from "./model-behavior-profile";
import type { RetryStrategy } from "./retry-policy";

export interface FailureCapsule {
	/** The ladder rung that was tried this attempt. */
	strategy: RetryStrategy;
	/** The classified outcome (why, in taxonomy terms). */
	outcome: ModelOutcomeKind;
	/** Concrete observed evidence (e.g. "no tool_call; narrated create_card in prose"). Trimmed; never the model's claim. */
	evidence: string;
	/** A short human reason the rung failed (for the next attempt + the §5.AG surface). */
	whyFailed: string;
}

export interface BuildFailureCapsuleInput {
	strategy: RetryStrategy;
	outcome: ModelOutcomeKind;
	evidence?: string;
	whyFailed?: string;
}

/** Normalize a capsule, deriving a sensible `whyFailed`/`evidence` default from the outcome when absent. */
export function buildFailureCapsule(input: BuildFailureCapsuleInput): FailureCapsule {
	const evidence = input.evidence?.trim() || "(no evidence captured)";
	const whyFailed = input.whyFailed?.trim() || defaultWhyFailed(input.outcome);
	return { strategy: input.strategy, outcome: input.outcome, evidence, whyFailed };
}

function defaultWhyFailed(outcome: ModelOutcomeKind): string {
	switch (outcome) {
		case "no_tool_call":
			return "the model emitted no tool call";
		case "narrated":
			return "the model narrated the call as prose instead of emitting it";
		case "loop":
			return "the model looped without progressing";
		case "timeout":
			return "the attempt exceeded its time/horizon budget";
		case "aborted":
			return "the attempt was aborted before producing output";
		case "malformed":
			return "the model produced malformed tool arguments/output";
		case "success":
			return "succeeded";
		default:
			return "the attempt did not produce the intended effect";
	}
}

/**
 * A compact "already tried — do not repeat" note for the next attempt's context. Empty string when there are no
 * capsules (so the caller can prepend unconditionally). Deterministic, oldest-first, one line per capsule.
 */
export function summarizeFailureCapsules(capsules: readonly FailureCapsule[]): string {
	if (capsules.length === 0) {
		return "";
	}
	const lines = capsules.map(
		(capsule, index) =>
			`${index + 1}. tried ${capsule.strategy} → ${capsule.outcome} (${capsule.whyFailed}); evidence: ${capsule.evidence}`,
	);
	return `Already attempted this task (do NOT repeat these — try something different):\n${lines.join("\n")}`;
}

/** The rungs from `ladder` that have NOT yet been tried in `capsules` (preserves ladder order — no circles). */
export function untriedStrategies(
	capsules: readonly FailureCapsule[],
	ladder: readonly RetryStrategy[],
): RetryStrategy[] {
	const tried = new Set(capsules.map((capsule) => capsule.strategy));
	return ladder.filter((strategy) => !tried.has(strategy));
}
