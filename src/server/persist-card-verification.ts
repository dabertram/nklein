import type { RuntimeCardVerification } from "../core/board-api-contract";
import { mutateWorkspaceState } from "../state/workspace-state";
import { retryWorkspaceStateLock } from "./workspace-state-lock-retry";

/**
 * F12.53: persist the verification snapshot onto its board card (additive optional field, whole-object LWW). Called
 * from every seam that actually RUNS the acceptance check — the on-demand verify procedure and the auto-delivery
 * gate — so the card badge always reflects the newest real run. Best-effort by design: verification display must
 * never break the check that produced it; callers `void`-catch.
 */
export async function persistCardVerification(
	workspacePath: string,
	taskId: string,
	verification: RuntimeCardVerification,
): Promise<void> {
	await retryWorkspaceStateLock(() =>
		mutateWorkspaceState(workspacePath, (state) => ({
			board: {
				...state.board,
				columns: state.board.columns.map((column) => ({
					...column,
					cards: column.cards.map((card) => (card.id === taskId ? { ...card, verification } : card)),
				})),
			},
			save: true,
			value: null,
		})),
	);
}
