import { expect, test } from "@playwright/test";
import { buildMockRuntimeConfig, installRuntimeMock } from "./harness/runtime-mock";

test.describe("first-run startup onboarding", () => {
	test("opens without a React render loop or browser errors", async ({ page }) => {
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => pageErrors.push(error.message));

		await installRuntimeMock(page, {
			suppressOnboarding: false,
			queryStubs: {
				"runtime.getConfig": buildMockRuntimeConfig(),
				"runtime.getNKleinProviderCatalog": {
					providers: [
						{
							id: "lm-studio",
							name: "LM Studio",
							baseUrl: "http://localhost:1234",
							defaultModelId: "test-model",
							capabilities: ["text"],
						},
					],
				},
				"runtime.getNKleinProviderModels": {
					models: [{ id: "test-model", name: "Test Model", contextLength: 40_000 }],
				},
			},
		});

		await page.goto("/");
		await expect(page.getByText("Get started", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();

		expect(consoleErrors).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
