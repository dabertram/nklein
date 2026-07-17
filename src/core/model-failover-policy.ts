/**
 * Model-failover policy (F3.2 failover leg) — PURE decision core.
 *
 * Live-found twice (2026-07-11 m4mini crash; 2026-07-17 ministral engine 500, since fixed at the message layer): a
 * MODEL-side terminal error on an attempt leaves the card `awaiting_review reason=error` and the run stagnates — no
 * retry on another model, even when the fitness-blended ranking has a healthy next candidate loaded. This core decides
 * whether a failed attempt should FAIL OVER to the next feasible model, so unattended drains survive a single bad
 * model×request pairing.
 *
 * Deliberately narrow: failover only on errors that implicate the MODEL/ENGINE pairing (engine 5xx, crash, template
 * rejection, endpoint unreachable, empty/malformed output) — never on sandbox/tool/user-cancel errors (those would fail
 * the same way on any model). Capped, and never revisits a model already tried for this task. The caller supplies the
 * ranked feasible candidates (the router's fitness-blended order) and re-dispatches; this core only decides.
 */

/** Error classes that implicate the model/engine pairing — the ONLY classes worth failing over. */
const MODEL_SIDE_ERROR_PATTERNS: readonly RegExp[] = [
	/engine protocol .*returned 5\d\d/i,
	/model has crashed/i,
	/jinja/i, // template rejection — model-family-specific wire incompatibility
	/raise_exception/i,
	/returned 5\d\d/i,
	/econnrefused|socket hang up|fetch failed|network/i,
	/no scorable|empty (completion|content|response)/i,
	/is not currently loaded/i,
	// !Klein's own curated wrap of a mid-run model loss ("Local model … became unavailable mid-run (crashed or
	// unloaded …)") — the service rewrites raw provider errors, so the wrapped TEXT is what reaches the summary
	// (live-found 2026-07-17 during failover validation: the induced mid-run unload didn't match the raw patterns).
	/became unavailable mid-run|crashed or unloaded/i,
];

/** True when the error text implicates the model/engine pairing rather than the task, sandbox, or user. */
export function isModelSideError(errorMessage: string | null | undefined): boolean {
	const text = (errorMessage ?? "").trim();
	if (text.length === 0) {
		return false;
	}
	return MODEL_SIDE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export interface ModelFailoverInput {
	/** The error that terminated the attempt (the task-run warning / agent error message). */
	readonly errorMessage: string | null;
	/** The model the failed attempt ran on (any key shape; compared exactly against candidates + history). */
	readonly failedModelKey: string;
	/** Models ALREADY tried for this task (including the failed one is harmless; it is excluded either way). */
	readonly triedModelKeys: readonly string[];
	/** Feasible candidates in the router's preference order (fitness-blended best first). */
	readonly rankedCandidateKeys: readonly string[];
	/** Maximum distinct failover hops per task (default 2 — third strike parks for review). */
	readonly maxFailovers?: number;
}

export interface ModelFailoverDecision {
	readonly failover: boolean;
	/** The model to re-dispatch on (present iff `failover`). */
	readonly nextModelKey: string | null;
	readonly reason: string;
}

/**
 * Decide whether a failed attempt should fail over to another model. Fails over ONLY when (a) the error is model-side,
 * (b) the per-task failover cap is not exhausted, and (c) a ranked candidate exists that has not been tried yet. The
 * first untried candidate in ranking order wins — the router already encoded quality/feasibility in that order.
 */
export function decideModelFailover(input: ModelFailoverInput): ModelFailoverDecision {
	const maxFailovers = input.maxFailovers ?? 2;
	if (!isModelSideError(input.errorMessage)) {
		return {
			failover: false,
			nextModelKey: null,
			reason: "error is not model-side (task/sandbox/user-scoped) — failover would repeat it.",
		};
	}
	const tried = new Set([...input.triedModelKeys, input.failedModelKey]);
	// Hops already consumed = distinct tried models beyond the original one.
	const failoversUsed = Math.max(0, tried.size - 1);
	if (failoversUsed >= maxFailovers) {
		return {
			failover: false,
			nextModelKey: null,
			reason: `failover cap reached (${failoversUsed}/${maxFailovers} hops) — parking for review.`,
		};
	}
	const nextModelKey = input.rankedCandidateKeys.find((key) => !tried.has(key)) ?? null;
	if (!nextModelKey) {
		return {
			failover: false,
			nextModelKey: null,
			reason: "no untried feasible candidate remains — parking for review.",
		};
	}
	return {
		failover: true,
		nextModelKey,
		reason: `model-side error on ${input.failedModelKey} — failing over to ${nextModelKey} (hop ${failoversUsed + 1}/${maxFailovers}).`,
	};
}
