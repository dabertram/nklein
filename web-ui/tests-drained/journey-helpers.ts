import { expect, type Page } from "@playwright/test";

/**
 * A pristine copied HOME legitimately opens on the FIRST-RUN chain (Get started slides → guided Project
 * setup) — walking past it IS a release journey step, so the helper dismisses whatever the chain shows until
 * the board renders.
 */
export async function landOnBoard(page: Page): Promise<void> {
	await page.goto("/");
	for (let round = 0; round < 5; round += 1) {
		if (await page.getByText("Backlog", { exact: true }).isVisible({ timeout: 2_000 }).catch(() => false)) {
			return;
		}
		if (await settleFirstRunDialogs(page)) {
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

/**
 * Dismiss whatever the first-run chain currently shows (Get started slides / guided Project setup). The
 * chain can REOPEN after config refreshes (a workspace without local provider settings force-opens the
 * slides), so journeys call this again before interacting past a dialog. Returns true when it dismissed one.
 */
export async function settleFirstRunDialogs(page: Page): Promise<boolean> {
	const onboarding = page.getByRole("dialog", { name: "Get started" });
	if (await onboarding.isVisible({ timeout: 700 }).catch(() => false)) {
		// The header's unnamed icon button is the dismiss affordance (Escape is swallowed by the slides).
		await onboarding.getByRole("button").first().click();
		await expect(onboarding).not.toBeVisible({ timeout: 5_000 });
		return true;
	}
	const guidedSetup = page.getByRole("dialog", { name: "Project setup" });
	if (await guidedSetup.isVisible({ timeout: 700 }).catch(() => false)) {
		await guidedSetup.getByRole("button", { name: "Skip setup" }).click();
		await expect(guidedSetup).not.toBeVisible({ timeout: 5_000 });
		return true;
	}
	return false;
}

/**
 * Deterministic first-run seeds shared by every drained/live journey: slides seen, both guided-setup wizards
 * skipped for the stable "ws" workspace, and the Z3 Expert kanban as the landing zoom.
 */
export async function seedJourneyLocalStorage(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.setup-wizard-skipped.global.global", "1");
		window.localStorage.setItem("nklein.setup-wizard-skipped.project.ws", "1");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3");
	});
}

/**
 * Click through first-run noise: settle any (re)opened chain dialog, then click; retry a few rounds. The
 * slides re-arm on project-id changes and config refreshes, so a journey's clicks must be immune rather than
 * hoping the chain stays quiet.
 */
export async function clickSettled(page: Page, locator: import("@playwright/test").Locator): Promise<void> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		while (await settleFirstRunDialogs(page)) {
			// keep clearing until quiet
		}
		try {
			await locator.click({ timeout: 6_000 });
			return;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
