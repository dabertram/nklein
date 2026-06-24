import { mutateWorkspaceState } from "../state/workspace-state";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "./api-contract";
import { isHomeAgentSessionId } from "./home-agent-session";
import { moveTaskToColumn } from "./task-board-mutations";

/**
 * Move a *running* task's card out of Backlog into its working lane so the board never shows agent activity behind a
 * card that still sits in Backlog (a real bug the user hit: a started dev-test decompose card "doing work in Backlog").
 *
 * The card's target lane is decided by `startInPlanMode` (planning vs in_progress). This is the single source of truth
 * for that reconciliation; it is called both synchronously when a task is started **and** on the summary's transition
 * to `running` (a freshly-started task — e.g. a dev-test seed whose Docker sandbox is still provisioning — is usually
 * still `queued`/`starting` when start returns, so the synchronous reconcile is a no-op and only the running-transition
 * one actually moves the card). Idempotent: a no-op when the task is the home agent, not running, already in its target
 * lane, terminal (completed/trash), or missing. Returns whether the board changed (so the caller can broadcast it).
 */
export async function reconcileStartedTaskBoardLane(input: {
	workspacePath: string;
	summary: RuntimeTaskSessionSummary;
}): Promise<boolean> {
	if (isHomeAgentSessionId(input.summary.taskId) || input.summary.state !== "running") {
		return false;
	}
	try {
		const response = await mutateWorkspaceState<boolean>(input.workspacePath, (state) => {
			const record = findBoardCardById(state.board.columns, input.summary.taskId);
			if (!record || record.columnId === "completed" || record.columnId === "trash") {
				return { board: state.board, save: false, value: false };
			}
			const targetColumnId = record.card.startInPlanMode ? "planning" : "in_progress";
			if (record.columnId === targetColumnId) {
				return { board: state.board, save: false, value: false };
			}
			const movement = moveTaskToColumn(state.board, input.summary.taskId, targetColumnId);
			return { board: movement.board, save: movement.moved, value: movement.moved };
		});
		return response.value;
	} catch {
		// Lane reconciliation is best-effort for real persisted boards; never let it surface or block a start/run.
		return false;
	}
}

function findBoardCardById(
	columns: readonly { id: string; cards: readonly RuntimeBoardCard[] }[],
	taskId: string,
): { card: RuntimeBoardCard; columnId: string } | null {
	for (const column of columns) {
		for (const card of column.cards) {
			if (card.id === taskId) {
				return { card, columnId: column.id };
			}
		}
	}
	return null;
}
