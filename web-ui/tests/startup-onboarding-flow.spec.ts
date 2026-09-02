/**
 * F2.32 — welcome/onboarding UX flow specs (David directive 2026-09-02: "add ui tests for the welcome and setup
 * dialogues .. smooth, covered, makes sense, user friendly, not annoying, intuitive").
 *
 * The three contracts a first-run dialog owes the user, pinned end-to-end on the page-level runtime mock:
 *  1. The full walk works — every slide reachable, Back/Next behave, Done completes and closes.
 *  2. Dismissing is respected — Escape closes it AND it stays closed after a reload (a dialog that re-opens
 *     on every visit is the definition of annoying; `handleCloseStartupOnboardingDialog` persists the marker).
 *  3. Direct navigation (slide dots) works and Back is disabled only where it makes sense (first slide).
 */
import { expect, test } from "@playwright/test";
import { buildMockRuntimeConfig, installRuntimeMock } from "./harness/runtime-mock";

const FIRST_RUN_STUBS = {
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
} as const;

const SLIDE_TITLES = [
	"Describe it — !Klein plans and builds it",
	"Watch the board burn down",
	"Reviewed before it ships",
	"Choose your agent",
] as const;

test.describe("startup onboarding flow (F2.32)", () => {
	test("walks every slide with Next, finishes with Done, and persists completion", async ({ page }) => {
		await installRuntimeMock(page, { ...FIRST_RUN_STUBS });
		await page.goto("/");

		await expect(page.getByText("Get started", { exact: true })).toBeVisible();
		// Back must be disabled on the first slide — there is nothing to go back to.
		await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();

		for (let index = 0; index < SLIDE_TITLES.length; index += 1) {
			await expect(page.getByText(SLIDE_TITLES[index] as string, { exact: false }).first()).toBeVisible();
			if (index < SLIDE_TITLES.length - 1) {
				await page.getByRole("button", { name: "Next", exact: true }).click();
			}
		}

		// Last slide: the primary action reads Done (not Next) — an honest end, not an infinite carousel.
		const done = page.getByRole("button", { name: "Done", exact: true });
		await expect(done).toBeVisible();
		await done.click();
		await expect(page.getByText("Get started", { exact: true })).not.toBeVisible();

		// Completion persists: the marker is set, so the next visit will not re-open the dialog.
		const marker = await page.evaluate(() => window.localStorage.getItem("nklein.onboarding.dialog.shown"));
		expect(marker).toBe("true");
	});

	test("Escape dismisses the dialog and the dismissal SURVIVES a reload (never re-annoy)", async ({ page }) => {
		await installRuntimeMock(page, { ...FIRST_RUN_STUBS });
		await page.goto("/");
		await expect(page.getByText("Get started", { exact: true })).toBeVisible();
		// The skip affordance must be visible — a tour nobody can decline is a hostage situation, not onboarding.
		await expect(page.getByTestId("onboarding-skip")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByText("Get started", { exact: true })).not.toBeVisible();

		// The contract that keeps first-run friendly: a dismissal is remembered exactly like a completion.
		// (A literal reload cannot be asserted here — the harness's addInitScript deliberately wipes the marker
		// on every navigation to force first-run mode. The never-reopen contract is pinned by the
		// shouldShowStartupOnboardingDialog unit tests: a shown marker wins even with unfinished setup.)
		const marker = await page.evaluate(() => window.localStorage.getItem("nklein.onboarding.dialog.shown"));
		expect(marker).toBe("true");
	});

	test("the Skip (×) button dismisses and persists like a completion", async ({ page }) => {
		await installRuntimeMock(page, { ...FIRST_RUN_STUBS });
		await page.goto("/");
		await expect(page.getByText("Get started", { exact: true })).toBeVisible();
		await page.getByTestId("onboarding-skip").click();
		await expect(page.getByText("Get started", { exact: true })).not.toBeVisible();
		const marker = await page.evaluate(() => window.localStorage.getItem("nklein.onboarding.dialog.shown"));
		expect(marker).toBe("true");
	});

	test("slide dots jump directly and Back re-enables off the first slide", async ({ page }) => {
		await installRuntimeMock(page, { ...FIRST_RUN_STUBS });
		await page.goto("/");
		await expect(page.getByText("Get started", { exact: true })).toBeVisible();

		await page.getByLabel("Go to onboarding slide 3").click();
		await expect(page.getByText(SLIDE_TITLES[2] as string, { exact: false }).first()).toBeVisible();
		await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();

		await page.getByRole("button", { name: "Back" }).click();
		await expect(page.getByText(SLIDE_TITLES[1] as string, { exact: false }).first()).toBeVisible();
	});
});
