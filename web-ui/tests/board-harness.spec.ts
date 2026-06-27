import { expect, test } from "@playwright/test";
import { gotoBoard, openSettings } from "./harness/board-actions";
import { buildBoardCard, buildBoardColumns, buildBoardSnapshot, installRuntimeMock } from "./harness/runtime-mock";

/**
 * Smoke coverage proving the reusable runtime-mock + board-action harness drives the board the same way the per-spec
 * setups did. New UI e2e specs should build on this harness instead of re-mocking the runtime by hand.
 */
test.describe("board (harness)", () => {
	test("renders the board shell from the mocked snapshot", async ({ page }) => {
		await installRuntimeMock(page);
		await gotoBoard(page);
		for (const column of ["Backlog", "In Progress", "Review", "Trash"]) {
			await expect(page.getByText(column, { exact: true })).toBeVisible();
		}
		await expect(page.getByRole("button", { name: "Create task" }).first()).toBeVisible();
	});

	test("seeds a backlog card into the board from the snapshot", async ({ page }) => {
		const card = buildBoardCard({ title: "Seeded backlog task" });
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ backlog: [card] }) }),
		});
		await gotoBoard(page);
		await expect(page.locator("[data-task-id]").filter({ hasText: "Seeded backlog task" }).first()).toBeVisible();
	});

	test("opens the settings dialog", async ({ page }) => {
		await installRuntimeMock(page);
		await gotoBoard(page);
		await openSettings(page);
	});
});
