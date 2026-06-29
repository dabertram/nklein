import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	trpcOk,
} from "./harness/runtime-mock";

/**
 * TIER-1 user-facing flow (gap map): start a backlog task. Clicking the card's "Start task" control must fire the
 * `runtime.startTaskSession` runtime mutation — the entry point of the whole task-execution workflow. Mocked +
 * capture-asserted (no real backend, no real model).
 */
test.describe("task start flow", () => {
	test("starting a backlog task fires runtime.startTaskSession", async ({ page }) => {
		const card = buildBoardCard({ id: "task-start-1", title: "Task to start" });
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ backlog: [card] }) }),
			mutations: { "runtime.startTaskSession": () => trpcOk({ ok: true, taskId: "task-start-1" }) },
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-start-1"]');
		await expect(cardLocator).toBeVisible();
		await cardLocator.hover(); // reveal the card's hover actions
		await cardLocator.getByRole("button", { name: "Start task" }).first().click();

		await expect.poll(() => handle.calls["runtime.startTaskSession"]?.length ?? 0).toBeGreaterThan(0);
	});
});
