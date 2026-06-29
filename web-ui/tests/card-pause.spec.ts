import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	taskSessionSummary,
	taskSessionsUpdatedFrame,
	trpcOk,
} from "./harness/runtime-mock";

/**
 * TIER-1 lifecycle flow (gap map): pause a running task. Streaming a running session reveals the "Pause task" control;
 * clicking it must fire `runtime.pauseTask`. Mocked + capture-asserted.
 */
test.describe("task pause flow", () => {
	test("pausing a running task fires runtime.pauseTask", async ({ page }) => {
		const card = buildBoardCard({ id: "task-pause-1", title: "Running task to pause" });
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
			mutations: { "runtime.pauseTask": () => trpcOk({ ok: true }) },
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-pause-1"]');
		await expect(cardLocator).toBeVisible();
		// Stream a running session so the Pause control appears.
		handle.pushFrame(taskSessionsUpdatedFrame([taskSessionSummary("task-pause-1", { state: "running" })]));
		await cardLocator.hover();
		await cardLocator.getByRole("button", { name: "Pause task" }).first().click();

		await expect.poll(() => handle.calls["runtime.pauseTask"]?.length ?? 0).toBeGreaterThan(0);
	});
});
