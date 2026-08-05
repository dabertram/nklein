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

test.describe("drained board interactions", () => {
	test("create two tasks, pointer-drag to reorder within Backlog, and the order survives a reload", async ({
		page,
	}) => {
		await landOnBoard(page);
		// Create through the UI — the copy's runtime persists both for real. (Dragging OUT of Backlog is a
		// deliberate START gesture in this product — "backlog cards always kick off" — so the passive drag
		// journey is the within-lane REORDER.)
		const backlogColumn = page.locator('[data-column-id="backlog"]').first();
		for (const title of ["Journey reorder card A", "Journey reorder card B"]) {
			await backlogColumn.getByRole("button", { name: "Create task" }).first().click();
			const prompt = page.getByPlaceholder("Describe the task");
			await prompt.fill(title);
			await prompt.press("Control+Enter");
			await expect(
				page.locator("[data-task-id]").filter({ hasText: title }).first(),
			).toBeVisible({ timeout: 10_000 });
		}
		const idOf = async (title: string): Promise<string> => {
			const value = await page
				.locator('[data-column-id="backlog"] [data-task-id]')
				.filter({ hasText: title })
				.first()
				.getAttribute("data-task-id");
			if (!value) throw new Error(`no id for ${title}`);
			return value;
		};
		const idA = await idOf("Journey reorder card A");
		const idB = await idOf("Journey reorder card B");
		const orderedIds = async (): Promise<string[]> => {
			const ids = await page
				.locator('[data-column-id="backlog"] [data-task-id]')
				.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-task-id")));
			return ids.filter((id): id is string => id === idA || id === idB);
		};
		// New backlog cards insert NEWEST-FIRST — derive roles from the observed order, not creation order.
		const before = await orderedIds();
		expect(before).toHaveLength(2);
		const [firstId, secondId] = before as [string, string];

		// Drag the LOWER card up onto the upper one's slot (staged moves — the sensor needs event-loop turns).
		const lower = page.locator(`[data-task-id="${secondId}"]`).first();
		const upper = page.locator(`[data-task-id="${firstId}"]`).first();
		const lowerBox = await lower.boundingBox();
		const upperBox = await upper.boundingBox();
		if (!lowerBox || !upperBox) {
			throw new Error("reorder cards have no bounding boxes");
		}
		await page.mouse.move(lowerBox.x + lowerBox.width / 2, lowerBox.y + 20);
		await page.mouse.down();
		await page.mouse.move(lowerBox.x + lowerBox.width / 2 + 8, lowerBox.y + 20, { steps: 2 });
		await page.waitForTimeout(150);
		await expect(lower).toHaveCSS("position", "fixed", { timeout: 2_000 }); // lifted
		for (let step = 1; step <= 5; step += 1) {
			await page.mouse.move(
				lowerBox.x + lowerBox.width / 2,
				lowerBox.y + 20 + ((upperBox.y - 10 - (lowerBox.y + 20)) * step) / 5,
				{ steps: 2 },
			);
			await page.waitForTimeout(60);
		}
		await page.waitForTimeout(200);
		await page.mouse.up();
		// Let the drop animation land and the streamed board frame settle before reading order.
		await expect(lower).not.toHaveCSS("position", "fixed", { timeout: 5_000 });
		await expect.poll(orderedIds, { timeout: 10_000 }).toEqual([secondId, firstId]);

		// The release truth: the reorder persisted through the real runtime, not just component state.
		await page.reload();
		await landOnBoard(page);
		await expect(page.locator(`[data-task-id="${secondId}"]`).first()).toBeVisible({ timeout: 15_000 });
		expect(await orderedIds()).toEqual([secondId, firstId]);
	});
});
