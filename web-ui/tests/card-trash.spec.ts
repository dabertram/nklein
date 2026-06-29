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
 * TIER-1 user-facing flow (gap map): move a card to trash. Opening the card and clicking "Move Card To Trash" must
 * persist via the `workspace.saveState` runtime mutation. Mocked + capture-asserted (no real backend).
 */
test.describe("card trash flow", () => {
	test("moving a card to trash fires the workspace.saveState persist mutation", async ({ page }) => {
		const card = buildBoardCard({ id: "task-trash-1", title: "Card to trash" });
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
			mutations: { "workspace.saveState": () => trpcOk({ revision: 2 }) },
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-trash-1"]');
		await expect(cardLocator).toBeVisible();
		// Open the card detail, then move it to trash.
		await cardLocator.locator("p").filter({ hasText: "Card to trash" }).first().click();
		await page.getByRole("button", { name: "Move Card To Trash" }).first().click();

		// The persist mutation fired.
		await expect.poll(() => handle.calls["workspace.saveState"]?.length ?? 0).toBeGreaterThan(0);
	});
});
