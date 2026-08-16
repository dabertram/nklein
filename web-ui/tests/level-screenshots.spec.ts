/**
 * §5.BB S3–S5 ARTIFACT GENERATOR (not a regression guard): captures one screenshot per detail level —
 * Minimalistic / Clean / Clean-drill / Advanced / Professional / Full + the minimal card sheet — against a
 * seeded mock board, so the redesign can be reviewed visually without booting a live runtime. Run with:
 *   npx playwright test tests/level-screenshots.spec.ts
 * Output: test-results/ui-levels/<name>.png
 */

import { mkdirSync } from "node:fs";
import { type Page, test } from "@playwright/test";

import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	taskSessionSummary,
} from "./harness/runtime-mock";

const OUT_DIR = "test-results/ui-levels";

const planned = (title: string, id: string, planSlug = "auth-stream") =>
	buildBoardCard({
		id,
		title,
		extra: {
			generatedFromPlan: { artifactKind: "decomposition", planSlug, planTaskId: `pt-${id}` },
		},
	});

async function seed(page: Page): Promise<void> {
	await installRuntimeMock(page, {
		snapshot: buildBoardSnapshot({
			columns: buildBoardColumns({
				backlog: [planned("Design the token store", "b1")],
				planning: [planned("Wire refresh-token rotation", "p1")],
				in_progress: [planned("Implement the login form", "w1"), planned("Session middleware", "w2", "api-stream")],
				review: [planned("Password reset flow", "r1")],
				completed: [planned("Auth schema migration", "c1")],
			}),
			dependencies: [
				{ id: "d1", fromTaskId: "p1", toTaskId: "b1" },
				{ id: "d2", fromTaskId: "w1", toTaskId: "p1" },
			],
			sessions: {
				w1: taskSessionSummary("w1", { state: "running", modelId: "qwen3.8-27b-mlx" }),
				r1: taskSessionSummary("r1", { state: "awaiting_review" }),
			},
		}),
	});
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/");
	await page.waitForTimeout(600);
}

async function shoot(page: Page, name: string): Promise<void> {
	await page.waitForTimeout(350);
	await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: false });
}

test("capture all detail levels", async ({ page }) => {
	mkdirSync(OUT_DIR, { recursive: true });
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.ui-zoom-level.v3", "2");
	});
	await seed(page);

	await page.getByRole("button", { name: "0 Minimalistic" }).click();
	await shoot(page, "0-minimalistic");

	await page.getByRole("button", { name: "1 Clean" }).click();
	await shoot(page, "1-clean-map");

	const cluster = page.locator("[data-cluster-id]").first();
	if (await cluster.isVisible().catch(() => false)) {
		await cluster.click();
		await shoot(page, "1-clean-stream-drill");
		const doing = page.getByTestId("lean-lane-doing").getByText("Implement the login form");
		if (await doing.isVisible().catch(() => false)) {
			await doing.click();
			await shoot(page, "1-clean-card-sheet");
			const full = page.getByTestId("card-sheet-full-detail");
			if (await full.isVisible().catch(() => false)) {
				await full.click();
				await shoot(page, "1-clean-card-full-detail");
			}
			// The detail overlay covers the zoom bar — leave through the top-bar back affordance.
			await page.getByRole("button", { name: /back/i }).first().click();
		}
	}

	await page.getByRole("button", { name: "2 Advanced" }).click();
	await shoot(page, "2-advanced");

	await page.getByRole("button", { name: "3 Professional" }).click();
	await shoot(page, "3-professional");

	await page.getByRole("button", { name: "4 Full" }).click();
	await shoot(page, "4-full");
});
