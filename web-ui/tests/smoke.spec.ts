import { expect, test } from "@playwright/test";
import { createBacklogTask, gotoBoard, openCard } from "./harness/board-actions";
import { installRuntimeMock } from "./harness/runtime-mock";

/**
 * Backlog task create/edit inline-editor flow, driven through the runtime mock harness. (The board-shell render +
 * settings dialog are covered by board-harness.spec.ts; this spec covers the create→edit→escape interactions.)
 */
test.describe("backlog task create/edit", () => {
	test("creating a backlog task adds a card and opening it shows the inline editor", async ({ page }) => {
		await installRuntimeMock(page);
		await gotoBoard(page);

		const title = `smoke-${Date.now()}`;
		await createBacklogTask(page, title);

		// The created card renders on the board (client-first board state).
		await openCard(page, title);

		// Opening the card shows the inline editor pre-filled with the task prompt + its action buttons.
		await expect(page.getByPlaceholder("Describe the task")).toHaveValue(title);
		await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
	});

	test("escape closes the backlog inline editor and keeps the card", async ({ page }) => {
		await installRuntimeMock(page);
		await gotoBoard(page);

		const title = `escape-${Date.now()}`;
		await createBacklogTask(page, title);
		await openCard(page, title);
		await expect(page.getByPlaceholder("Describe the task")).toHaveValue(title);

		await page.keyboard.press("Escape");

		await expect(page.getByPlaceholder("Describe the task")).toHaveCount(0);
		await expect(page.locator("[data-task-id]").filter({ hasText: title }).first()).toBeVisible();
	});
});
