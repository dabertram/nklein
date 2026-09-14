/**
 * F2.32 — the "Choose your agent" slide of the welcome tour: the task-start agent onboarding carousel (David
 * directive 2026-09-02: welcome and setup dialogues "smooth, covered, makes sense, user friendly, not annoying,
 * intuitive").
 *
 * Pinned on the page-level runtime mock:
 *  1. The last slide shows the agent card with its authenticated state and the !Klein setup block, including the
 *     context-window override with the reported window beside it.
 *  2. A window below the ≥32k floor is REFUSED on Done with a plain message and the tour stays open.
 *  3. A typed override is never silently dropped: with the provider fields untouched, Done still validates and
 *     saves it (the early-return this spec caught), then the tour completes.
 */
import { expect, test } from "@playwright/test";
import { buildMockRuntimeConfig, installRuntimeMock, trpcOk } from "./harness/runtime-mock";

const STUBS = {
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
			models: [{ id: "test-model", name: "Test Model", contextWindow: 40_000 }],
		},
		// The wizards must stay quiet behind the tour.
		"runtime.getGlobalSetupPlan": { kind: "global", steps: [], completedAt: 1 },
		"runtime.getProjectSetupPlan": { kind: "project", steps: [], completedAt: 1 },
	},
	mutations: {
		"runtime.saveNKleinModelContextWindowOverride": () => trpcOk({ ok: true }),
		"runtime.saveConfig": () => trpcOk(buildMockRuntimeConfig()),
	},
} as const;

async function goToAgentSlide(page: import("@playwright/test").Page) {
	await page.goto("/");
	const tour = page.getByRole("dialog").filter({ hasText: "Get started" });
	await expect(tour).toBeVisible();
	for (let index = 0; index < 3; index += 1) {
		await tour.getByRole("button", { name: "Next", exact: true }).click();
	}
	await expect(tour.getByText("Choose your agent", { exact: false }).first()).toBeVisible();
	return tour;
}

test.describe("agent onboarding carousel (F2.32)", () => {
	test("the agent slide shows the card, its state, and the setup block with the reported window", async ({ page }) => {
		await installRuntimeMock(page, { ...STUBS });
		const tour = await goToAgentSlide(page);
		await expect(tour.getByText("!Klein", { exact: true }).first()).toBeVisible();
		await expect(tour.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "true");
		// A local provider has no login to show; the setup block itself is the state (provider + model pickers).
		await expect(tour.getByText("Model ID", { exact: true })).toBeVisible();
		await expect(tour.getByText("40,000 tokens reported")).toBeVisible();
		await expect(tour.getByLabel("!Klein context window override")).toHaveAttribute("placeholder", "64000");
	});

	test("a context window below the floor is refused on Done, in words, and the tour stays open", async ({ page }) => {
		const mock = await installRuntimeMock(page, { ...STUBS });
		const tour = await goToAgentSlide(page);
		await tour.getByLabel("!Klein context window override").fill("1000");
		await tour.getByRole("button", { name: "Done", exact: true }).click();
		await expect(tour.getByText("Context window must be at least 32,000 tokens.")).toBeVisible();
		await expect(tour).toBeVisible();
		expect(mock.calls["runtime.saveNKleinModelContextWindowOverride"] ?? []).toEqual([]);
	});

	test("a typed override is saved on Done even when nothing else changed, then the tour completes", async ({
		page,
	}) => {
		const mock = await installRuntimeMock(page, { ...STUBS });
		const tour = await goToAgentSlide(page);
		await tour.getByLabel("!Klein context window override").fill("64000");
		await tour.getByRole("button", { name: "Done", exact: true }).click();
		await expect.poll(() => mock.calls["runtime.saveNKleinModelContextWindowOverride"]?.length ?? 0).toBe(1);
		const serialized = JSON.stringify(mock.calls["runtime.saveNKleinModelContextWindowOverride"]?.[0]);
		expect(serialized).toContain('"contextWindow":64000');
		expect(serialized).toContain('"modelId":"test-model"');
		await expect(tour).not.toBeVisible();
		const marker = await page.evaluate(() => window.localStorage.getItem("nklein.onboarding.dialog.shown"));
		expect(marker).toBe("true");
	});
});
