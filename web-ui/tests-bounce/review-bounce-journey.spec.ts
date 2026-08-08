import { expect, test } from "@playwright/test";
import { clickSettled, landOnBoard, seedJourneyLocalStorage, settleFirstRunDialogs } from "../tests-drained/journey-helpers";

/**
 * N14 — the review BOUNCE journey. Auto-review ON, the sim reviewer requests changes on round 1, the worker
 * re-drives, round 2 approves.
 *
 * The operator-visible fact under test is that a bounce and its FEEDBACK actually reach the card. A bounce that
 * happens silently is the N20/N10 failure class — work loops while the board looks fine — so the assertion is
 * on what a human would SEE, not on a log line.
 */

test.beforeEach(async ({ page }) => {
	await seedJourneyLocalStorage(page);
});

test("a review bounce and its feedback are visible on the card, and the re-work then completes", async ({ page }) => {
	await landOnBoard(page);
	await page.waitForTimeout(1_500);
	while (await settleFirstRunDialogs(page)) {
		// clear the first-run chain before layering a dialog on top
	}

	// Auto-review ON (the dialog's default) — the reviewer must run for a bounce to exist at all.
	await page.keyboard.press("c");
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByPlaceholder("Describe the task")).toBeVisible({ timeout: 5_000 });
	const autoReview = dialog.getByRole("checkbox", { name: /Automatically/ });
	if (!(await autoReview.isChecked())) {
		await autoReview.click();
	}
	await dialog.getByPlaceholder("Describe the task").fill("Bounce journey: write the soak note.");
	await dialog.getByRole("button", { name: "Create", exact: true }).click();

	const card = page.locator("[data-task-id]").filter({ hasText: "Bounce journey" }).first();
	await expect(card).toBeVisible({ timeout: 10_000 });
	while (await settleFirstRunDialogs(page)) {
		// the chain re-arms on config refreshes for a provider-less workspace
	}
	await card.hover();
	await clickSettled(page, card.getByRole("button", { name: "Start task" }).first());

	// THE POINT: the operator can see the bounce and read WHY. Open the card and look for the reviewer's own
	// words — polled, because round 1 lands whenever the model gets there.
	await clickSettled(page, card);
	await expect(page.getByText(/missing its covering test|Add a covering test/i).first()).toBeVisible({
		timeout: 120_000,
	});

	// …and the bounce is not terminal: round 2 approves and the card reaches a settled lane.
	await clickSettled(page, page.getByRole("button", { name: "Back to board" }));
	await expect(
		page
			.locator('[data-column-id="completed"] [data-task-id], [data-column-id="review"] [data-task-id]')
			.filter({ hasText: "Bounce journey" })
			.first(),
	).toBeVisible({ timeout: 120_000 });
});
