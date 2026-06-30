import { expect, test } from "@playwright/test";
import { gotoBoard, openSettings } from "./harness/board-actions";
import { buildMockRuntimeConfig, installRuntimeMock, trpcOk } from "./harness/runtime-mock";

/**
 * TIER-2 settings flow (gap map): the §5.L agent-rulesets panel (capability/delivery tiers). Changing a global preset
 * and saving must fire `runtime.saveConfig`. Mocked + capture-asserted via the shared buildMockRuntimeConfig.
 */
test.describe("agent rulesets settings", () => {
	test("changing a ruleset global preset and saving fires runtime.saveConfig", async ({ page }) => {
		const handle = await installRuntimeMock(page, {
			queryStubs: { "runtime.getConfig": buildMockRuntimeConfig() },
			mutations: { "runtime.saveConfig": () => trpcOk(buildMockRuntimeConfig()) },
		});
		await gotoBoard(page);
		await openSettings(page);

		// Change a ruleset dial's global preset (config seeds "fully_open"; pick a different tier).
		const preset = page.getByLabel(/global preset/i).first();
		await expect(preset).toBeVisible();
		const values = await preset
			.locator("option")
			.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
		const current = await preset.inputValue();
		const next = values.find((v) => v && v !== current);
		expect(next, "rulesets select should offer a second tier").toBeTruthy();
		await preset.selectOption(next as string);

		await page.getByRole("button", { name: "Save", exact: true }).first().click();
		await expect.poll(() => handle.calls["runtime.saveConfig"]?.length ?? 0).toBeGreaterThan(0);
	});
});
