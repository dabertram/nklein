import { expect, test } from "@playwright/test";
import { clickSettled, landOnBoard, seedJourneyLocalStorage, settleFirstRunDialogs } from "../tests-drained/journey-helpers";

/**
 * N14 — the OPERATOR review journey, end-to-end through the shipped UI with a live sim-backed runtime:
 * create a card with auto-review OFF (the create dialog's own checkbox), start it, let the sim worker do the
 * work, watch it park in Review for the HUMAN, open it, and MERGE via the Review-actions panel. The launcher
 * then proves the merge reached git for real (`git show main:soak-note.md`).
 */

test.beforeEach(async ({ page }) => {
	await seedJourneyLocalStorage(page);
});

test("create → start → sim works → Review parks for the operator → Merge completes the card", async ({ page }) => {
	await landOnBoard(page);
	// The first-run chain reopens once the provider-less workspace's config loads — clear it BEFORE layering
	// the New-task dialog on top (an animating dialog underneath keeps the Create button "unstable" forever).
	await page.waitForTimeout(1_500);
	while (await settleFirstRunDialogs(page)) {
		// keep clearing until quiet
	}

	// Create via the FULL dialog (the inline editor has no auto-review control): 'c' is the New-task shortcut.
	await page.keyboard.press("c");
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByPlaceholder("Describe the task")).toBeVisible({ timeout: 5_000 });
	const autoReview = dialog.getByRole("checkbox", { name: /Automatically/ });
	if (await autoReview.isChecked()) {
		await autoReview.click();
	}
	await dialog.getByPlaceholder("Describe the task").fill("Operator review journey: write the soak note.");
	await dialog.getByRole("button", { name: "Create", exact: true }).click();
	const card = page.locator("[data-task-id]").filter({ hasText: "Operator review journey" }).first();
	await expect(card).toBeVisible({ timeout: 10_000 });
	while (await settleFirstRunDialogs(page)) {
		// The first-run chain reopens on config refreshes for a provider-less workspace — clear it before clicking on.
	}

	// Start it — the sim model does the work (worker writes soak-note.md + its test). The Start button sits
	// in the card's hover toolbar, so hover first.
	await card.hover();
	await clickSettled(page, card.getByRole("button", { name: "Start task" }).first());

	// With auto-review OFF the finished card parks in Review awaiting the human.
	const reviewCard = page
		.locator('[data-column-id="review"] [data-task-id]')
		.filter({ hasText: "Operator review journey" })
		.first();
	await expect(reviewCard).toBeVisible({ timeout: 90_000 });

	// Open it and merge through the Review-actions panel.
	await clickSettled(page, reviewCard);
	await expect(page.getByText("Review actions", { exact: true })).toBeVisible({ timeout: 15_000 });
	await clickSettled(page, page.getByRole("button", { name: "Merge", exact: true }));

	// Merge ≠ close by design: the card STAYS in Review with the merged state; the panel reports the result.
	// (The launcher separately proves the ground truth: git main now contains the worker's file.)
	await expect(page.getByText(/Merged \d+ task results/).first()).toBeVisible({ timeout: 20_000 });
	await clickSettled(page, page.getByRole("button", { name: "Back to board" }));
	await expect(
		page.locator('[data-column-id="review"] [data-task-id]').filter({ hasText: "Operator review journey" }),
	).toBeVisible({ timeout: 15_000 });
});
