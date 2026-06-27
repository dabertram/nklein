import { expect, type Page } from "@playwright/test";

/**
 * Shared board-driving helpers for UI e2e specs — the common interactions (navigate, create/open a card, open
 * settings) factored out of the per-spec copies so flows read consistently. Pair with `installRuntimeMock`.
 */

/** Navigate to the board and wait for the column shell to render. */
export async function gotoBoard(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
}

/** Create a backlog task via the column's "Create task" button + the inline prompt editor (Ctrl+Enter submits). */
export async function createBacklogTask(page: Page, title: string): Promise<void> {
	const backlogColumn = page.locator('[data-column-id="backlog"]').first();
	await backlogColumn.getByRole("button", { name: "Create task" }).click();
	const prompt = page.getByPlaceholder("Describe the task");
	await prompt.fill(title);
	await prompt.press("Control+Enter");
}

/** Open a board card by its title text. */
export async function openCard(page: Page, title: string): Promise<void> {
	const card = page.locator("[data-task-id]").filter({ hasText: title }).first();
	await expect(card).toBeVisible();
	await card.click();
}

/** Open the runtime settings dialog. */
export async function openSettings(page: Page): Promise<void> {
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
}
