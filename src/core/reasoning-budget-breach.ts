/**
 * Streaming reasoning-budget breach policy — adopted from little-coder's `thinking-budget` extension
 * (https://github.com/itayinbarr/little-coder, Apache-2.0 by Itay Inbar; see docs/attributions.md).
 *
 * !Klein's §5.AA ladder already reacts AFTER a failed turn (`raise_token_budget`, `thinking_disable` rungs); what
 * little-coder adds is the MID-TURN cut: watch the reasoning channel WHILE it streams, and the moment the
 * reasoning spend breaches the per-turn budget, stop the turn, disable thinking, and nudge the model to commit to
 * an implementation — instead of letting it burn the whole completion budget on `reasoning_content` and only
 * classifying the corpse. Their state rule is kept too: once thinking is forced off it STAYS off across the
 * recovery chain and is restored only on genuine user input (or a fresh session), so an immediate retry cannot
 * re-burn while the next real task is not stuck with a degraded setting it never asked for.
 *
 * Pure + total: deltas and events in, decisions out. The stream/wire seams (chat loop today; the swarm path when
 * the vendored `wrapModel` hook lands) consume this.
 */

/** little-coder's chars→tokens approximation (`Math.ceil(chars / 3.5)`), kept identical for comparability. */
export function estimateReasoningTokensFromChars(chars: number): number {
	return Math.ceil(Math.max(0, chars) / 3.5);
}

/** The default per-turn reasoning budget when nothing is configured (little-coder's shipped default). */
export const DEFAULT_REASONING_BUDGET_TOKENS = 4096;

export interface ReasoningBudgetTracker {
	/** Feed one streamed reasoning delta; returns true exactly once, on the update that breaches the budget. */
	addReasoningDelta(deltaChars: number): boolean;
	breached(): boolean;
	spentTokens(): number;
}

export function createReasoningBudgetTracker(
	budgetTokens: number = DEFAULT_REASONING_BUDGET_TOKENS,
): ReasoningBudgetTracker {
	let chars = 0;
	let breachedFlag = false;
	return {
		addReasoningDelta(deltaChars: number): boolean {
			if (breachedFlag || deltaChars <= 0) {
				return false;
			}
			chars += deltaChars;
			if (estimateReasoningTokensFromChars(chars) > budgetTokens) {
				breachedFlag = true;
				return true;
			}
			return false;
		},
		breached(): boolean {
			return breachedFlag;
		},
		spentTokens(): number {
			return estimateReasoningTokensFromChars(chars);
		},
	};
}

/**
 * The agent-readable nudge that rides the thinking-off retry. Deliberately an instruction to COMMIT, not to think
 * harder — the model has already demonstrated that more budget goes to more reasoning, not to the tool call.
 */
export const REASONING_BUDGET_BREACH_NUDGE =
	"[reasoning budget exceeded] You have thought long enough for this step. Commit to an implementation NOW: emit the concrete tool call or answer directly, without further deliberation.";

export interface ReasoningBudgetRecovery {
	/** Stop consuming the current turn's stream — the rest of the budget would go to more reasoning. */
	abortTurn: true;
	/** Retry with the thinking channel disabled (only meaningful when the model has a verified soft switch). */
	disableThinking: true;
	nudge: typeof REASONING_BUDGET_BREACH_NUDGE;
}

export function reasoningBudgetRecovery(): ReasoningBudgetRecovery {
	return { abortTurn: true, disableThinking: true, nudge: REASONING_BUDGET_BREACH_NUDGE };
}

/** Forced-off state carried ACROSS turns: breach forces thinking off until genuine user input or a new session. */
export interface ReasoningForcedOffState {
	forcedOff: boolean;
	/** The thinking level active before the force, restored on release; null = none captured. */
	priorLevel: string | null;
}

export const REASONING_FORCED_OFF_CLEAR: ReasoningForcedOffState = { forcedOff: false, priorLevel: null };

export type ReasoningForcedOffEvent =
	| { kind: "breach"; activeLevel: string | null }
	| { kind: "genuine_user_input" }
	| { kind: "session_start" };

/**
 * Advance the forced-off state machine. A breach latches forced-off (capturing the prior level once — a repeat
 * breach in the same forced-off window must not overwrite it with "off"); genuine user input and a fresh session
 * both release it, so the degradation never outlives the stuck step that earned it.
 */
export function applyReasoningForcedOffEvent(
	state: ReasoningForcedOffState,
	event: ReasoningForcedOffEvent,
): ReasoningForcedOffState {
	switch (event.kind) {
		case "breach":
			return state.forcedOff ? state : { forcedOff: true, priorLevel: event.activeLevel };
		case "genuine_user_input":
		case "session_start":
			return REASONING_FORCED_OFF_CLEAR;
	}
}
