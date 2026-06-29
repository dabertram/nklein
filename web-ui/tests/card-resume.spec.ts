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
 * TIER-1 lifecycle flow (gap map): resume a paused task. Streaming a paused session reveals the "Resume task" control;
 * clicking it must fire `runtime.resumeTask`. Mocked + capture-asserted.
 */
test.describe("task resume flow", () => {
	test("resuming a paused task fires runtime.resumeTask", async ({ page }) => {
		const card = buildBoardCard({ id: "task-resume-1", title: "Paused task to resume" });
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
			mutations: { "runtime.resumeTask": () => trpcOk({ ok: true }) },
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-resume-1"]');
		await expect(cardLocator).toBeVisible();
		// Stream a paused session so the Resume control appears.
		handle.pushFrame(
			taskSessionsUpdatedFrame([taskSessionSummary("task-resume-1", { state: "paused", paused: true })]),
		);
		await cardLocator.hover();
		await cardLocator.getByRole("button", { name: "Resume task" }).first().click();

		await expect.poll(() => handle.calls["runtime.resumeTask"]?.length ?? 0).toBeGreaterThan(0);
	});
});
