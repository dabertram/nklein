/**
 * §5.AC "knows-today" temporal-context INJECTION decision (user guidance 2026-07-01). The temporal-awareness core
 * already builds the date block ({@link buildTemporalAwarenessPrompt}) and judges relevance
 * ({@link isTemporalContextRelevant}); this composes them into the exact exposure policy the user asked for:
 *
 *   1. OFF BY DEFAULT — the feature is opt-in (`enabled`); an unset/false setting NEVER injects (zero prompt cost).
 *   2. ONLY WHERE IT HELPS — relevance-gated, so the date lands on temporal/freshness turns and is skipped on plain
 *      coding turns (avoids the prompt-processing bloat the user flagged).
 *   3. APPENDED AT THE END — the volatile date is kept OUT of the cacheable prompt PREFIX (§5.AQ: a high-in-prompt date
 *      churns the prefix and forces a re-prefill every day; at the tail it never breaks prefix cache reuse).
 *
 * Pure + deterministic: composes the two temporal-awareness helpers, takes an injected `now`, does no I/O.
 */

import {
	buildTemporalAwarenessPrompt,
	isTemporalContextRelevant,
	type TemporalGranularity,
} from "./temporal-awareness";

/** Where the knows-today block is placed. Always the END — see the module header (§5.AQ cache-prefix stability). */
export type TemporalPlacement = "append_end";

export interface TemporalContextInjectionInput {
	/**
	 * The user setting for the "knows-today" feature. OFF BY DEFAULT (user 2026-07-01): injection requires an explicit
	 * `true`; an undefined/false setting never injects, so there is no prompt bloat when the feature is off.
	 */
	enabled?: boolean;
	/** The task/prompt text the model will act on — gated for temporal relevance so the date only lands where it helps. */
	text?: string | null;
	/** Optional role hint (e.g. "researcher"/"retriever") — intrinsically temporal even without a text cue. */
	role?: string | null;
	/** Injected clock (the authoritative "now"). */
	now: Date;
	/** Date-only (default; cache-stable to the day) vs full datetime — pass "datetime" only for a wall-clock turn. */
	granularity?: TemporalGranularity;
	/** Force injection past the relevance gate for a turn explicitly flagged time-sensitive. STILL requires `enabled`. */
	force?: boolean;
}

export interface TemporalContextInjectionDecision {
	/** Whether to inject the knows-today block for this turn. */
	inject: boolean;
	/** Where (always the END). */
	placement: TemporalPlacement;
	/** The block to append when `inject` is true; empty string otherwise. */
	block: string;
	/** Why — for operator visibility / telemetry. */
	reason: string;
}

/**
 * Decide whether to inject the §5.AC "knows-today" temporal block for a turn (and produce it), per the user's policy:
 * OFF BY DEFAULT, relevance-gated, appended at the END. Pure; injected clock; no I/O.
 */
export function decideTemporalContextInjection(input: TemporalContextInjectionInput): TemporalContextInjectionDecision {
	const placement: TemporalPlacement = "append_end";
	if (input.enabled !== true) {
		return { inject: false, placement, block: "", reason: "knows-today disabled (off by default)" };
	}
	const relevant =
		input.force === true || isTemporalContextRelevant({ text: input.text ?? null, role: input.role ?? null });
	if (!relevant) {
		return { inject: false, placement, block: "", reason: "not temporally relevant — skipped to avoid prompt bloat" };
	}
	const block = buildTemporalAwarenessPrompt(
		input.now,
		input.granularity !== undefined ? { granularity: input.granularity } : {},
	);
	return {
		inject: true,
		placement,
		block,
		reason: input.force === true ? "forced (turn flagged time-sensitive)" : "temporally relevant",
	};
}

/**
 * Apply the decision to a base prompt: append the block at the END (blank-line separated) when the decision says inject,
 * else return the base prompt UNCHANGED (byte-identical — so an off / irrelevant turn keeps a fully cacheable prefix).
 */
export function appendTemporalContext(basePrompt: string, decision: TemporalContextInjectionDecision): string {
	if (!decision.inject || decision.block.length === 0) {
		return basePrompt;
	}
	return basePrompt.length > 0 ? `${basePrompt}\n\n${decision.block}` : decision.block;
}
