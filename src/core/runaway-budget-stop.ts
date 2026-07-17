/**
 * F12.40 runaway budget HARD-STOP — PURE core.
 *
 * The §5.AG attention signals WARN as a run approaches its ceilings; nothing STOPS a card that blows far past them,
 * and parallel agents multiply the burn invisibly (the F12.58 meter measured a single card at 221k tokens). This
 * core is the circuit breaker: per-card and board-level token/turn ceilings whose breach demands a STOP — park the
 * card with its evidence, never silently spend on. Deliberately far above normal operation (a hard stop that fires
 * on healthy work gets disabled); the advisory tiers below the stop remain F12.58/§5.AG territory. Pure; the
 * caller supplies spend + caps (caps default generous; 0/absent disables that ceiling — never stop on no-config).
 */

export interface RunawayBudgetSignals {
	readonly cardTokens: number;
	readonly cardTurns: number;
	/** Total tokens across the board's live cards this session (the multiplied-burn view). */
	readonly boardTokens: number;
}

export interface RunawayBudgetCaps {
	/** Per-card token ceiling; ≤0/absent disables. Default 500k — ~2× the worst healthy card observed. */
	readonly cardTokenCap?: number;
	/** Per-card turn ceiling; ≤0/absent disables. Default 120. */
	readonly cardTurnCap?: number;
	/** Board-level token ceiling; ≤0/absent disables. Default 2M. */
	readonly boardTokenCap?: number;
}

export const DEFAULT_CARD_TOKEN_CAP = 500_000;
export const DEFAULT_CARD_TURN_CAP = 120;
export const DEFAULT_BOARD_TOKEN_CAP = 2_000_000;

export interface RunawayBudgetVerdict {
	readonly stop: boolean;
	/** Which ceiling tripped first (card_tokens > card_turns > board_tokens); null when none. */
	readonly tripped: "card_tokens" | "card_turns" | "board_tokens" | null;
	readonly reason: string;
}

/** Judge the spend against the ceilings. A tripped ceiling is a STOP — park with evidence, never silently spend on. */
export function assessRunawayBudget(signals: RunawayBudgetSignals, caps: RunawayBudgetCaps = {}): RunawayBudgetVerdict {
	const cardTokenCap = caps.cardTokenCap ?? DEFAULT_CARD_TOKEN_CAP;
	const cardTurnCap = caps.cardTurnCap ?? DEFAULT_CARD_TURN_CAP;
	const boardTokenCap = caps.boardTokenCap ?? DEFAULT_BOARD_TOKEN_CAP;
	if (cardTokenCap > 0 && signals.cardTokens >= cardTokenCap) {
		return {
			stop: true,
			tripped: "card_tokens",
			reason: `card spent ${signals.cardTokens.toLocaleString()} tokens (hard cap ${cardTokenCap.toLocaleString()}) — STOP and park with evidence; a card this expensive is circling, not converging.`,
		};
	}
	if (cardTurnCap > 0 && signals.cardTurns >= cardTurnCap) {
		return {
			stop: true,
			tripped: "card_turns",
			reason: `card ran ${signals.cardTurns} turns (hard cap ${cardTurnCap}) — STOP and park with evidence.`,
		};
	}
	if (boardTokenCap > 0 && signals.boardTokens >= boardTokenCap) {
		return {
			stop: true,
			tripped: "board_tokens",
			reason: `the BOARD spent ${signals.boardTokens.toLocaleString()} tokens this session (hard cap ${boardTokenCap.toLocaleString()}) — stop admitting new work until the operator reviews the burn.`,
		};
	}
	return { stop: false, tripped: null, reason: "spend within every hard ceiling." };
}
