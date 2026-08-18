import type { RuntimeTaskSessionState } from "../core/api-contract";
import { isBusySessionState } from "../core/session-state-predicates";

/**
 * Decide whether a reviewed artifact lost a race to a newer primary worker turn.
 *
 * When a turn generation is available it is the causal authority. Summary state is asynchronous presentation state:
 * a late event from the admitted turn can project `running` during review without any newer turn existing.
 */
export function isReviewDeliverySuperseded(input: {
	admittedTurnGeneration: number | null;
	currentTurnGeneration: number | null;
	currentSummaryState: RuntimeTaskSessionState | null;
	admittedCommit: string | null;
	currentCommit: string | null;
}): boolean {
	// A MEASURED generation advance keeps its authority (that turn's capture is inbound). The busy-state
	// FALLBACK, though, is unattributable — and chronic completed-without-merge (2026-08-18) showed its
	// false-positive shape: a dead worker session admitted with a NULL generation, then a rescue restart
	// projecting `running` at delivery time. When the result-branch commit is measured byte-identical to
	// the admitted one, that fallback must not discard an approved delivery.
	const sameArtifact = input.admittedCommit !== null && input.currentCommit === input.admittedCommit;
	const newerTurn =
		input.admittedTurnGeneration !== null
			? input.currentTurnGeneration !== input.admittedTurnGeneration
			: input.currentSummaryState !== null && isBusySessionState(input.currentSummaryState) && !sameArtifact;
	const newerArtifact = input.admittedCommit !== null && input.currentCommit !== input.admittedCommit;
	return newerTurn || newerArtifact;
}
