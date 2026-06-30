import type { RuntimeBoardCard } from "../core/api-contract";

/**
 * Pure board-card lookups extracted from runtime-api. They read a board's card list with no
 * router/state coupling, so they are behavior-preserving relative to their inline definitions.
 */

/** Find a card by its task id, or null when absent. */
export function findBoardCardById(cards: readonly RuntimeBoardCard[], taskId: string): RuntimeBoardCard | null {
	return cards.find((card) => card.id === taskId) ?? null;
}

/** Resolve a source task's base ref from the board, or null when the id is empty or the card is absent. */
export function findSourceCardBaseRef(cards: readonly RuntimeBoardCard[], sourceTaskId: string | null): string | null {
	if (!sourceTaskId) {
		return null;
	}
	return findBoardCardById(cards, sourceTaskId)?.baseRef ?? null;
}
