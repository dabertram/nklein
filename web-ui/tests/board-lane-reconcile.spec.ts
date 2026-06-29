import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	workspaceStateUpdatedFrame,
} from "./harness/runtime-mock";

/**
 * Board lane reconcile via streaming (§5.AK/§5.V): a streamed `workspace_state_updated` board frame moves a card to a
 * new column and the board reflects it LIVE — the "card moves columns" coverage (e.g. the backlog→in_progress reconcile)
 * the static-snapshot harness couldn't do. Deterministic, model-free.
 */
test.describe("board lane-reconcile streaming", () => {
	test("a streamed board update moves a card from backlog to in_progress", async ({ page }) => {
		const card = buildBoardCard({ id: "task-move-1", title: "Moving card" });
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ backlog: [card] }) }),
		});
		await gotoBoard(page);

		// Initially under Backlog.
		await expect(page.locator("[data-column-id='backlog'] [data-task-id='task-move-1']")).toBeVisible();

		// Stream a board mutation moving the card into In Progress.
		handle.pushFrame(workspaceStateUpdatedFrame(buildBoardColumns({ in_progress: [card] })));

		// The card is now under In Progress (and no longer Backlog).
		await expect(page.locator("[data-column-id='in_progress'] [data-task-id='task-move-1']")).toBeVisible();
		await expect(page.locator("[data-column-id='backlog'] [data-task-id='task-move-1']")).toHaveCount(0);
	});
});
