import { expect, test } from "@playwright/test";

/**
 * N14 — UI release journeys over a REAL drained board (no runtime mock anywhere): the workspace under test is
 * a copy of a retained soak/nightly HOME whose board a real drain produced. These journeys prove the shipped
 * UI renders and navigates genuinely drained state — the backend-drain-centric nightly plus this lane covers
 * what a release actually ships.
 *
 * Journeys are READ-ONLY by design (the drained board is evidence; a journey must not manufacture state to
 * assert on). Interaction depth grows in later slices (drag/drop, review actions) on purpose-built boards.
 */

/**
 * A pristine copied HOME legitimately opens on the FIRST-RUN chain (Get started slides → guided Project
 * setup) — walking past it IS a release journey step, so the helper dismisses whatever the chain shows until
 * the board renders.
 */
async function landOnBoard(page: import("@playwright/test").Page): Promise<void> {
	await page.goto("/");
	for (let round = 0; round < 5; round += 1) {
		if (await page.getByText("Backlog", { exact: true }).isVisible({ timeout: 2_000 }).catch(() => false)) {
			return;
		}
		const onboarding = page.getByRole("dialog", { name: "Get started" });
		if (await onboarding.isVisible({ timeout: 700 }).catch(() => false)) {
			// The header's unnamed icon button is the dismiss affordance (Escape is swallowed by the slides).
			await onboarding.getByRole("button").first().click();
			await expect(onboarding).not.toBeVisible({ timeout: 5_000 });
			continue;
		}
		const guidedSetup = page.getByRole("dialog", { name: "Project setup" });
		if (await guidedSetup.isVisible({ timeout: 700 }).catch(() => false)) {
			await guidedSetup.getByRole("button", { name: "Skip setup" }).click();
			await expect(guidedSetup).not.toBeVisible({ timeout: 5_000 });
			continue;
		}
		// A fresh context lands on the Overview zoom (activity map); the kanban lives at Z3 — zooming in is a
		// real user step of the journey, not test scaffolding.
		const expertZoom = page.getByRole("button", { name: "Z3 Expert" });
		if (await expertZoom.isVisible({ timeout: 700 }).catch(() => false)) {
			await expertZoom.click();
		}
	}
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
	// Mark the slides as seen BEFORE app scripts run — the first-run dialog also force-opens when the copied
	// workspace has no local provider settings (condition 2 in shouldShowStartupOnboardingDialog), so the
	// walker below stays as the journey-shaped backstop.
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		// The drained workspace keeps its stable id ("ws") once the launcher writes realpaths — pre-mark both
		// guided-setup wizards as skipped for it (scoped key: <key>.<kind>.<workspaceId|global>).
		window.localStorage.setItem("nklein.setup-wizard-skipped.global.global", "1");
		window.localStorage.setItem("nklein.setup-wizard-skipped.project.ws", "1");
		// Land on the Z3 Expert kanban (zoom is a persisted preference; 3 = Expert in UiZoomLevelV2).
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3");
	});
});

test.describe("drained board journeys", () => {
	test("the board renders the drained workspace's real lanes and cards", async ({ page }) => {
		await landOnBoard(page);
		// The drained soak board holds ONLY completed cards — the drained truth the UI must show.
		const soakCard = page.locator("[data-task-id]").filter({ hasText: "Soak round" }).first();
		await expect(soakCard).toBeVisible({ timeout: 15_000 });
	});

	test("a completed card opens its detail and returns to the board (focus/back essential)", async ({ page }) => {
		await landOnBoard(page);
		const soakCard = page.locator("[data-task-id]").filter({ hasText: "Soak round" }).first();
		await expect(soakCard).toBeVisible({ timeout: 15_000 });
		await soakCard.click();
		// The card opens as a full task view — "Back to board" is its navigation marker.
		await expect(page.getByRole("button", { name: "Back to board" })).toBeVisible({ timeout: 10_000 });
		await page.getByRole("button", { name: "Back to board" }).click();
		// Back lands on the board surface (the Overview zoom today); the drained truth stays visible either
		// way as the workspace chip's completed count.
		await expect(page.getByRole("button", { name: /C \| 240/ }).first()).toBeVisible({ timeout: 10_000 });
	});

	test("settings opens against the real runtime and closes clean", async ({ page }) => {
		await landOnBoard(page);
		await page.getByTestId("open-settings-button").click();
		await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible({ timeout: 10_000 });
		await page.keyboard.press("Escape");
	});
});
