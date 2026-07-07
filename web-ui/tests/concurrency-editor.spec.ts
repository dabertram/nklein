import { expect, test } from "@playwright/test";
import { gotoBoard, openSettings } from "./harness/board-actions";
import { buildMockRuntimeConfig, installRuntimeMock, trpcOk } from "./harness/runtime-mock";

/**
 * TIER-2 settings flow (gap map): the per-machine (pool) concurrency editor — the §5 per-machine pools UI. Adding a
 * machine cap and saving must fire `runtime.saveConfig`. Mocked + capture-asserted via the shared buildMockRuntimeConfig.
 */
test.describe("concurrency editor (per-machine pool)", () => {
	test("adding a per-machine concurrency cap and saving fires runtime.saveConfig", async ({ page }) => {
		const handle = await installRuntimeMock(page, {
			queryStubs: { "runtime.getConfig": buildMockRuntimeConfig() },
			mutations: { "runtime.saveConfig": () => trpcOk(buildMockRuntimeConfig()) },
		});
		await gotoBoard(page);
		await openSettings(page);

		// Add a per-machine (endpoint) concurrency cap.
		await page.getByLabel("New machine key").fill("http://localhost:1234/v1");
		await page.getByLabel("New machine cap").fill("2");
		await page.getByRole("button", { name: "Add machine cap" }).click();

		// Save the dialog.
		await page.getByRole("button", { name: "Save", exact: true }).first().click();
		await expect.poll(() => handle.calls["runtime.saveConfig"]?.length ?? 0).toBeGreaterThan(0);
	});
});
