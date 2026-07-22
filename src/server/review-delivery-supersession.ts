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
	const newerTurn =
		input.admittedTurnGeneration !== null
			? input.currentTurnGeneration !== input.admittedTurnGeneration
			: input.currentSummaryState !== null && isBusySessionState(input.currentSummaryState);
	const newerArtifact = input.admittedCommit !== null && input.currentCommit !== input.admittedCommit;
	return newerTurn || newerArtifact;
}
