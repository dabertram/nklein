/**
 * Context-overflow TERMINAL recovery policy (P0.CTX500) — PURE decision core.
 *
 * ── THE SEAM THIS DECIDES FOR ──
 * A mid-turn context overflow does not reject the SDK send: the vendored `AgentRuntime.run` catches the model-stream
 * error, returns `status: "failed"` and emits `run-failed`, so the only place the failure is visible is the terminal
 * `awaiting_review / reason=error` summary. The dispatch-time reactive compaction (`recoverAfterOverflow`) never sees
 * it, and until this policy existed the terminal seam knew only one rung — the model-failover leg — which refused the
 * engine wording as "not model-side" and parked the card (live 2026-09-03, `s42-invariant-battery`).
 *
 * ── THE LADDER (cheapest, most-targeted rung first) ──
 * 1. `compact_and_redrive` — compact the persisted history and re-drive on the SAME model. The model was the
 *    fitness-ranked choice and the error names its own remedy; a failover hop is the scarcer resource (capped at 2).
 * 2. `defer_to_model_failover` — when the history cannot shrink any further, or the consecutive re-drive budget is
 *    spent (each re-drive halves the retained history; a card that overflows again immediately after two halvings is
 *    not going to fit this model), hand the SAME terminal to the model-failover leg. Its fresh-model carry restarts on
 *    the next untried candidate with a bounded brief, which fits regardless of the new model's window.
 * 3. Park — the failover leg's own cap/no-candidate verdict, unchanged.
 * Human attention stays the final rung, not the next one (§4A, live-found 2026-07-21).
 */

import { isContextOverflowMessage } from "./context-overflow-signature";

/** Consecutive same-model compaction re-drives allowed before the terminal defers to model failover. */
export const DEFAULT_MAX_CONTEXT_OVERFLOW_REDRIVES = 2;

export interface ContextOverflowTerminalRecoveryInput {
	/** The terminal summary's state — only `awaiting_review` is an error terminal this policy acts on. */
	readonly state: string;
	/** The terminal summary's review reason — only `error` qualifies. */
	readonly reviewReason: string | null | undefined;
	/** The error text that ended the attempt (summary warning / hook final message). */
	readonly errorMessage: string | null | undefined;
	/** Whether the persisted history can still be compacted (the compactor would return a smaller transcript). */
	readonly historyCompactable: boolean;
	/** Same-model compaction re-drives already spent CONSECUTIVELY on this card (reset by any healthy terminal). */
	readonly compactionRedrivesUsed: number;
	/** Cap on consecutive compaction re-drives (default {@link DEFAULT_MAX_CONTEXT_OVERFLOW_REDRIVES}). */
	readonly maxCompactionRedrives?: number;
}

export type ContextOverflowTerminalRecoveryAction = "none" | "compact_and_redrive" | "defer_to_model_failover";

export interface ContextOverflowTerminalRecoveryDecision {
	readonly action: ContextOverflowTerminalRecoveryAction;
	/** Inspectable reason for the observation stream and the operator surface. */
	readonly reason: string;
}

/**
 * True when the summary is an error terminal whose error text is a context overflow — the trigger condition shared by
 * the effectful controller's claim check and the decision below.
 */
export function isContextOverflowErrorTerminal(input: {
	readonly state: string;
	readonly reviewReason: string | null | undefined;
	readonly errorMessage: string | null | undefined;
}): boolean {
	return (
		input.state === "awaiting_review" &&
		input.reviewReason === "error" &&
		isContextOverflowMessage(input.errorMessage)
	);
}

/**
 * Decide the next rung for a terminal summary. Non-overflow terminals (healthy ends, attention parks, other errors)
 * are `none` — the caller's ordinary terminal handling (model failover for model-side errors) proceeds unchanged.
 */
export function decideContextOverflowTerminalRecovery(
	input: ContextOverflowTerminalRecoveryInput,
): ContextOverflowTerminalRecoveryDecision {
	if (!isContextOverflowErrorTerminal(input)) {
		return {
			action: "none",
			reason: "not a context-overflow error terminal — ordinary terminal handling applies.",
		};
	}
	const maxRedrives = Math.max(0, Math.trunc(input.maxCompactionRedrives ?? DEFAULT_MAX_CONTEXT_OVERFLOW_REDRIVES));
	const used = Math.max(0, Math.trunc(input.compactionRedrivesUsed));
	if (used >= maxRedrives) {
		return {
			action: "defer_to_model_failover",
			reason: `consecutive compaction re-drive budget spent (${used}/${maxRedrives}) — the history no longer fits this model; deferring to model failover.`,
		};
	}
	if (!input.historyCompactable) {
		return {
			action: "defer_to_model_failover",
			reason: "the persisted history cannot be compacted any further — deferring to model failover.",
		};
	}
	return {
		action: "compact_and_redrive",
		reason: `context overflow — compacting the persisted history and re-driving on the same model (re-drive ${used + 1}/${maxRedrives}).`,
	};
}
