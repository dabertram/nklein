/**
 * §5.AW best-of-N arbitration — the PURE decision for WHICH result branch a reviewed task delivers, lifted out of
 * runtime-server's headless-auto-review finalize. When the reviewer compared candidates A/B and preferred the
 * SPECULATIVE one, every delivery step (acceptance evidence, protected-path scan, the merge) targets the `::spec`
 * result branch while board bookkeeping stays on the card id. Precedence: the in-process `reviewPreferred` is
 * authoritative; the persisted `persistedPreferred` is the DURABLE fallback (so a restart between the verdict and the
 * delivery still ships the winner). Only a `delivered` outcome can pick the speculative branch. Total + pure.
 */

/** The INITIAL delivery target (the finalize flow may later fall back to primary if the speculative acceptance fails). */
export function resolveSpeculativeDeliveryTarget(input: {
	/** The review outcome was `delivered` (only then can a speculative candidate win). */
	reviewDelivered: boolean;
	/** The in-process reviewer's preferred candidate (authoritative). */
	reviewPreferred: string | null | undefined;
	/** The DURABLE persisted preferred candidate (fallback across a restart). */
	persistedPreferred: string | null | undefined;
	/** The card / task id — the speculative branch is `${taskId}::spec`. */
	taskId: string;
}): { preferredSpeculative: boolean; deliveredBranchTaskId: string } {
	const preferredSpeculative =
		input.reviewDelivered && (input.reviewPreferred ?? input.persistedPreferred ?? null) === "speculative";
	return {
		preferredSpeculative,
		deliveredBranchTaskId: preferredSpeculative ? `${input.taskId}::spec` : input.taskId,
	};
}
