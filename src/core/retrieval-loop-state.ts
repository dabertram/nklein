/**
 * §5.AC retrieval-loop STATE MACHINE — pure decision core.
 *
 * The §5.AC retrieval loop is a multi-step driver that repeatedly queries a search backend, fetches the most
 * relevant result pages, and finally synthesises gathered evidence into a cited answer.  This module owns
 * **only the stateless transition function**: given a snapshot of the loop's current state it returns the
 * single next action to take.  All effectful work (issuing queries, firing HTTP fetches, calling the LLM for
 * synthesis) lives in the driver that wraps this core.
 *
 * Decision precedence (first match wins — ordered early-returns, never collapsed into a boolean expression):
 *  1. `sufficient === true`               → `stop_sufficient`     (sufficiency always overrides every other condition)
 *  2. `iteration >= maxIterations`        → `stop_budget_exhausted`
 *  3. `!hasQueryPlan`                     → `formulate_query`
 *  4. `hitCount <= 0`                     → `search`              (negative counts treated defensively as 0)
 *  5. `fetchedCount < hitCount`           → `fetch`
 *  6. otherwise                           → `synthesize`
 *
 * The module is pure and deterministic: no I/O, no globals, no mutation of input.
 */

/** Every action the §5.AC retrieval loop may take on a given iteration. */
export type RetrievalAction =
	| "formulate_query"
	| "search"
	| "fetch"
	| "synthesize"
	| "stop_sufficient"
	| "stop_budget_exhausted";

/**
 * Snapshot of the retrieval loop's observable state at the START of an iteration, before the next action is
 * taken.  Every field is a plain value so callers can construct or clone freely — nothing is hidden.
 */
export interface RetrievalLoopState {
	/** Zero-based iteration counter.  Increment it after each completed action (not before). */
	iteration: number;
	/** Hard upper bound on iterations; the loop stops when `iteration >= maxIterations`. */
	maxIterations: number;
	/** `true` once a query plan (keywords / sub-queries / intent decomposition) has been formulated. */
	hasQueryPlan: boolean;
	/**
	 * Number of search hits returned by the most recent search.  Treated as 0 when negative (defensive guard
	 * against callers that normalise differently).
	 */
	hitCount: number;
	/** Number of hits that have already been fetched and stored as evidence this iteration. */
	fetchedCount: number;
	/**
	 * `true` when the synthesiser (or an external sufficiency check) has determined that the gathered evidence
	 * is already sufficient to answer the question.  When `true` the loop MUST stop immediately, even if the
	 * iteration budget is also exhausted.
	 */
	sufficient: boolean;
}

/**
 * Return the single next action for the §5.AC retrieval loop given a state snapshot.
 *
 * Evaluation is a strict ordered sequence of early returns; precedence is never compressed into a clever
 * boolean expression so that the hierarchy is self-documenting and auditable.  The function never mutates
 * its argument.
 */
export function nextRetrievalAction(state: RetrievalLoopState): RetrievalAction {
	// 1. Sufficiency always wins — even when the budget is simultaneously exhausted.
	if (state.sufficient) {
		return "stop_sufficient";
	}

	// 2. Budget exhaustion: iteration has reached (or somehow exceeded) the maximum.
	if (state.iteration >= state.maxIterations) {
		return "stop_budget_exhausted";
	}

	// 3. No query plan yet — must formulate one before any search can proceed.
	if (!state.hasQueryPlan) {
		return "formulate_query";
	}

	// 4. No search has been run yet (or the last search returned nothing) — run one now.
	//    Negative hitCount is treated defensively as 0 (≤ 0 → search).
	if (state.hitCount <= 0) {
		return "search";
	}

	// 5. There are unfetched hits remaining — fetch the next one.
	if (state.fetchedCount < state.hitCount) {
		return "fetch";
	}

	// 6. All hits have been fetched; synthesise the evidence into a cited answer.
	return "synthesize";
}
