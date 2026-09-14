/**
 * F2.32 — guided-setup wizard flow specs (David directive 2026-09-02: "add ui tests for the welcome and setup
 * dialogues .. smooth, covered, makes sense, user friendly, not annoying, intuitive").
 *
 * The §5.BA wizard auto-fires once a global setup plan with open steps arrives. Pinned on the page-level runtime mock:
 *  1. The full walk — every plan step reachable, the §5.BB zoom chooser rides as the last step, Finish persists the
 *     completion stamp through `runtime.saveConfig` and closes.
 *  2. Skip is respected — "Skip setup" (and Escape) close it AND it stays closed after a reload; nothing was saved.
 *  3. It is re-runnable on purpose — Settings → "Run setup wizard" brings it back after a skip.
 */
import { expect, test } from "@playwright/test";
import { openSettings } from "./harness/board-actions";
import { buildMockRuntimeConfig, installRuntimeMock, trpcOk } from "./harness/runtime-mock";

const PLAN_STEPS = [
	{
		stepId: "provider",
		title: "Local model provider",
		recommendation: "Use LM Studio on this machine",
		detail: "A loaded model was detected at http://localhost:1234.",
	},
	{
		stepId: "concurrency",
		title: "Concurrent tasks",
		recommendation: "Start with 3 tasks at once",
		detail: "Raise it later from Settings when the fleet has headroom.",
	},
] as const;

function wizardStubs() {
	return {
		queryStubs: {
			"runtime.getConfig": buildMockRuntimeConfig(),
			"runtime.getGlobalSetupPlan": { kind: "global", steps: PLAN_STEPS, completedAt: null },
			// The project wizard must stay quiet: it would auto-fire the moment the global one closes.
			"runtime.getProjectSetupPlan": { kind: "project", steps: [], completedAt: 1 },
			// The Settings dialog (the re-run test) reads these on open; an unstubbed null crashes its panels.
			"runtime.listCommunitySkillImports": {
				inboxPath: "/tmp/community-skills/inbox",
				truncated: false,
				candidates: [],
			},
			"runtime.getMemoryAudit": {
				generatedAt: 1_700_000_000_000,
				enabled: true,
				paused: false,
				lastAuditAt: 1_700_000_000_000,
				nextAuditAt: 1_700_604_800_000,
				state: "findings",
				available: true,
				notesAudited: 0,
				summary: { stale: 0, orphaned: 0, broken_link: 0, duplicate_title: 0 },
				topFindings: [],
			},
		},
		mutations: {
			"runtime.saveConfig": () => trpcOk(buildMockRuntimeConfig()),
		},
	};
}

/**
 * The negative half of "never re-annoy": after a reload the plan STILL says not completed, so only the remembered
 * skip keeps the wizard closed. Wait for hydration (the board and its settings button), give the plan fetch — which
 * is what auto-fires the wizard — a moment to land, then insist nothing opened.
 */
async function expectWizardStaysClosedAfterReload(page: import("@playwright/test").Page): Promise<void> {
	await page.reload();
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	await expect(page.getByTestId("open-settings-button")).toBeVisible();
	await page.waitForTimeout(750);
	await expect(page.getByRole("dialog").filter({ hasText: "Guided setup" })).toHaveCount(0);
}

test.describe("guided setup wizard flow (F2.32)", () => {
	test("walks every step, picks a starting view, and Finish persists the completion stamp", async ({ page }) => {
		const mock = await installRuntimeMock(page, wizardStubs());
		await page.goto("/");

		const dialog = page.getByRole("dialog").filter({ hasText: "Guided setup" });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("Step 1 of 3")).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
		await expect(dialog.getByText(PLAN_STEPS[0].title)).toBeVisible();
		await expect(dialog.getByText(PLAN_STEPS[0].recommendation)).toBeVisible();

		await dialog.getByRole("button", { name: "Next", exact: true }).click();
		await expect(dialog.getByText("Step 2 of 3")).toBeVisible();
		await expect(dialog.getByText(PLAN_STEPS[1].title)).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();

		// The §5.BB zoom chooser is the last step: a real choice, remembered before Finish.
		await dialog.getByRole("button", { name: "Next", exact: true }).click();
		await expect(dialog.getByText("How much do you want to see?")).toBeVisible();
		await dialog.getByTestId("setup-wizard-zoom-2").click();
		await expect(dialog.getByTestId("setup-wizard-zoom-2")).toHaveAttribute("aria-checked", "true");

		const finish = dialog.getByRole("button", { name: "Finish", exact: true });
		await expect(finish).toBeVisible();
		await finish.click();
		await expect(dialog).not.toBeVisible();

		// Completion is persisted through the runtime, not a browser flag: the stamp travels in saveConfig.
		await expect.poll(() => mock.calls["runtime.saveConfig"]?.length ?? 0).toBeGreaterThan(0);
		expect(JSON.stringify(mock.calls["runtime.saveConfig"])).toContain("setupWizardCompletedAt");
	});

	test("Skip setup closes it, saves nothing, and the skip SURVIVES a reload (never re-annoy)", async ({ page }) => {
		const mock = await installRuntimeMock(page, wizardStubs());
		await page.goto("/");
		const dialog = page.getByRole("dialog").filter({ hasText: "Guided setup" });
		await expect(dialog).toBeVisible();

		await dialog.getByRole("button", { name: "Skip setup" }).click();
		await expect(dialog).not.toBeVisible();
		expect(mock.calls["runtime.saveConfig"] ?? []).toEqual([]);

		// The plan still says "not completed" on reload — only the remembered skip keeps the wizard quiet.
		await expectWizardStaysClosedAfterReload(page);
	});

	test("Escape dismisses like Skip", async ({ page }) => {
		await installRuntimeMock(page, wizardStubs());
		await page.goto("/");
		const dialog = page.getByRole("dialog").filter({ hasText: "Guided setup" });
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Next", exact: true }).focus();
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
		await expectWizardStaysClosedAfterReload(page);
	});

	test("after a skip, Settings → Run setup wizard brings it back on purpose", async ({ page }) => {
		await installRuntimeMock(page, wizardStubs());
		await page.goto("/");
		const dialog = page.getByRole("dialog").filter({ hasText: "Guided setup" });
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Skip setup" }).click();
		await expect(dialog).not.toBeVisible();

		await openSettings(page);
		// The GLOBAL block comes first; the per-project wizard has its own "Run setup wizard" further down.
		await page.getByRole("button", { name: "Run setup wizard" }).first().click();
		await expect(page.getByRole("dialog").filter({ hasText: "Guided setup" })).toBeVisible();
		await expect(page.getByText("Step 1 of 3")).toBeVisible();
	});
});
