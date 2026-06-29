import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	taskSessionSummary,
	taskSessionsUpdatedFrame,
} from "./harness/runtime-mock";

/**
 * Proves the runtime-mock STREAMING layer (pushFrame + frame builders — §5.AK/§5.AQ): a pushed
 * `task_sessions_updated` frame transitions a board card's session to running and the card reflects it LIVE.
 * This is the deterministic "UI reacts to a streamed runtime frame" coverage the harness was built for — the
 * foundation for exercising model-driven flows in e2e without a real model.
 */
test.describe("board session streaming (harness pushFrame)", () => {
	test("a streamed running-session frame lights up the card's working badge", async ({ page }) => {
		const card = buildBoardCard({ id: "task-stream-1", title: "Streamed running task" });
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-stream-1"]');
		await expect(cardLocator).toBeVisible();
		// Before the frame: no running session, so no "working" status on the card.
		await expect(cardLocator).not.toContainText("working");

		// Stream a running-session frame for this card (the §5.AQ streaming layer).
		handle.pushFrame(taskSessionsUpdatedFrame([taskSessionSummary("task-stream-1", { state: "running" })]));

		// The card reflects the streamed state live (auto-retries through the ~100ms batch flush).
		await expect(cardLocator).toContainText("working");
	});
});
