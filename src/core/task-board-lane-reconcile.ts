import { mutateWorkspaceState } from "../state/workspace-state";
import type { RuntimeBoardColumnId, RuntimeTaskSessionSummary } from "./api-contract";
import { isHomeAgentSessionId } from "./home-agent-session";
import { findBoardCardWithColumn, moveTaskToColumn, STARTED_CARD_ENTRY_LANE } from "./task-board-mutations";

/**
 * Where a *running* card should be, keyed by the lane it is in now. Only Backlog, Ready, and Review are remapped:
 *  • Backlog → Planning/Refinement (§5.B — every started card refines against current project state first, work
 *    and decompose cards alike; work cards then call `begin_implementation` to advance).
 *  • Ready   → Planning/Refinement (todo 11116 §5.B): a dep-free card parked in `ready` (its auto-start was deferred
 *    on a busy slot / busy endpoint / file-lock) whose queued session LATER transitions to running has no synchronous
 *    start-flow move to carry it out of `ready` — so `ready`, whose whole meaning is "waiting for a slot, no live
 *    session", would otherwise render an actively-working session. Send it to the same refinement entry-lane every
 *    other started card uses; it then promotes to In Progress via `begin_implementation`, identically to a card that
 *    started straight from the synchronous path (which already moves it `ready → planning`).
 *  • Review → In Progress (a recovered review card resumed with new input is active work again).
 * Every other source (Planning, In Progress, completed/trash) maps to nothing → the card is left untouched, so we
 * never pull a card backward (resume) or re-route a decompose child already refining in Planning.
 */
const RUNNING_CARD_ENTRY_LANE_BY_SOURCE: Partial<Record<RuntimeBoardColumnId, RuntimeBoardColumnId>> = {
	backlog: STARTED_CARD_ENTRY_LANE,
	ready: STARTED_CARD_ENTRY_LANE,
	review: "in_progress",
};

/**
 * Move a *running* task's card out of a WAITING lane (Backlog or Ready) into its working lane so the board never shows
 * agent activity behind a card that still sits in a not-yet-working lane — two real bugs the user hit: a started
 * dev-test decompose card "doing work in Backlog", and (todo 11116) a dep-free card parked in **Ready** that renders
 * "Worker working" while Ready's whole meaning is "waiting for a slot, no live session".
 *
 * Every started card enters the same Planning/Refinement entry lane (`STARTED_CARD_ENTRY_LANE`, todo §5.B) — work and
 * decompose cards alike — so it always gets a refinement pass before implementation. This reconcile only moves a card
 * still sitting in a **waiting lane (Backlog or Ready)**; it never pulls a card backward from a later lane (a resumed
 * in_progress/review card stays put, a decompose child already in Planning stays put) and never disturbs a terminal
 * card. It is called both synchronously when a task is started **and** on the summary's transition to `running` (a
 * freshly-started task — e.g. a dev-test seed whose Docker sandbox is still provisioning, or a Ready card whose queued
 * session was waiting behind a busy endpoint — is usually still `queued`/`starting` when start returns, so the
 * synchronous reconcile is a no-op and only the running-transition one actually moves the card). Idempotent: a no-op
 * when the task is the home agent, not running, already out of the waiting lane, or missing. Returns whether the board
 * changed (so the caller can broadcast it).
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
			const record = findBoardCardWithColumn(state.board, input.summary.taskId);
			const targetColumnId = record ? RUNNING_CARD_ENTRY_LANE_BY_SOURCE[record.columnId] : undefined;
			if (!targetColumnId) {
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
