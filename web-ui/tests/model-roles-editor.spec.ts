import { expect, test } from "@playwright/test";
import { gotoBoard, openSettings } from "./harness/board-actions";
import { buildMockRuntimeConfig, installRuntimeMock, trpcOk } from "./harness/runtime-mock";

/**
 * TIER-2 settings flow (gap map): the §5.AB/§5.AE per-role model-roles editor (architect/worker/reviewer). Changing a
 * role's reasoning-effort and saving must fire `runtime.saveConfig`. Mocked + capture-asserted via buildMockRuntimeConfig.
 * The editor lives under the "!Klein Provider & Models" settings-nav section; its reasoning select has static options (no provider data).
 */
test.describe("model-roles editor settings", () => {
	test("changing a role's reasoning effort and saving fires runtime.saveConfig", async ({ page }) => {
		const handle = await installRuntimeMock(page, {
			queryStubs: { "runtime.getConfig": buildMockRuntimeConfig() },
			mutations: { "runtime.saveConfig": () => trpcOk(buildMockRuntimeConfig()) },
		});
		await gotoBoard(page);
		await openSettings(page);

		// Navigate to the !Klein section (the model-roles editor lives there).
		await page.getByRole("dialog").getByRole("button", { name: "!Klein Provider & Models", exact: true }).click();

		// Change the architect role's reasoning effort (static options: inherit/low/medium/high/xhigh — no provider data).
		const reasoning = page.locator("#runtime-settings-model-role-architect-reasoning");
		await expect(reasoning).toBeVisible();
		const values = await reasoning
			.locator("option")
			.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
		const current = await reasoning.inputValue();
		const next = values.find((v) => v && v !== current);
		expect(next, "reasoning select should offer a second option").toBeTruthy();
		await reasoning.selectOption(next as string);

		await page.getByRole("button", { name: "Save", exact: true }).first().click();
		await expect.poll(() => handle.calls["runtime.saveConfig"]?.length ?? 0).toBeGreaterThan(0);
	});
});
