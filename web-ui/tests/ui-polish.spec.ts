import { expect, type Page, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	taskSessionSummary,
} from "./harness/runtime-mock";

/**
 * E2E regression guards for the 2026-07-10 UI-polish pass (David's notes):
 *  1. dependency edges render across NON-backlog columns when the Deps toggle is on (they were backlog-only);
 *  2. the Lean view covers the full lifecycle incl. the Queued lane (planning cards were invisible);
 *  3. the Overview clusters by plan slug (everything rendered as one "unplanned" blob) with visible directed edges;
 *  4. cards carry ONE clear model identity (short ◈ session badge; no default agent/model chip duplication).
 */

/** Force a zoom level + the edges toggle BEFORE the app boots (both are read from localStorage at mount). */
async function primeUiState(page: Page, options: { zoom: string; edges?: boolean }): Promise<void> {
	await page.addInitScript(
		({ zoom, edges }) => {
			window.localStorage.setItem("nklein.ui-zoom-level.v3", zoom);
			if (edges) {
				window.localStorage.setItem("nklein.board-dependency-edges-visible", "1");
			}
		},
		{ zoom: options.zoom, edges: options.edges ?? false },
	);
}

const planned = (title: string, id: string) =>
	buildBoardCard({
		id,
		title,
		extra: {
			generatedFromPlan: { artifactKind: "decomposition", planSlug: "auth-stream", planTaskId: `pt-${id}` },
		},
	});

test.describe("UI polish regression guards", () => {
	test("dependency edges render between planning-column cards when Deps is on", async ({ page }) => {
		await primeUiState(page, { zoom: "4", edges: true });
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					planning: [
						planned("Plan step one", "p1"),
						planned("Plan step two", "p2"),
						planned("Plan step three", "p3"),
					],
				}),
				dependencies: [
					{ id: "d1", fromTaskId: "p1", toTaskId: "p2" },
					{ id: "d2", fromTaskId: "p2", toTaskId: "p3" },
				],
			}),
		});
		await gotoBoard(page);
		await expect(page.locator("[data-task-id]").filter({ hasText: "Plan step one" }).first()).toBeVisible();
		// Both persisted edges must materialize even though NO endpoint is in backlog (the old rule hid them all).
		await expect(page.locator(".kb-dependency-path")).toHaveCount(2);
	});

	test("lean view shows the Queued lane with planning cards (full minimal lifecycle)", async ({ page }) => {
		await primeUiState(page, { zoom: "2" });
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					planning: [planned("Queued planning card", "p1")],
					// Same plan stream as p1: Clean's drill is stream-scoped since the Lean merge (2026-08-16),
					// so cross-stream cards would legitimately be filtered out of this cluster.
					in_progress: [planned("Doing card", "d1")],
				}),
			}),
		});
		await gotoBoard(page);
		// Walk the real user path: click the zoom button (the boot zoom depends on stored/migrated state).
		await page.getByRole("button", { name: "1 Clean" }).click();
		await page.locator("[data-cluster-id]").first().click();
		const queued = page.getByTestId("lean-lane-queued");
		await expect(queued).toBeVisible();
		await expect(queued).toContainText("Queued planning card");
		await expect(page.getByTestId("lean-lane-doing")).toContainText("Doing card");
		await expect(page.getByTestId("lean-lane-review")).toBeVisible();
		await expect(page.getByTestId("lean-lane-done")).toBeVisible();
	});

	test("overview clusters by plan slug with visible directed dependency edges", async ({ page }) => {
		// Boot at Advanced (gotoBoard's readiness probe needs the board), then walk into Clean like a user.
		await primeUiState(page, { zoom: "2" });
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					planning: [planned("Cluster card A", "p1"), planned("Cluster card B", "p2")],
				}),
				dependencies: [{ id: "d1", fromTaskId: "p1", toTaskId: "p2" }],
			}),
		});
		await gotoBoard(page);
		// Walk the real user path: click the zoom button (the boot zoom depends on stored/migrated state).
		await page.getByRole("button", { name: "1 Clean" }).click();
		const map = page.getByTestId("activity-map");
		await expect(map).toBeVisible();
		// The cluster is labeled by the plan slug — NOT the old all-in-one "unplanned" blob.
		await expect(map).toContainText("auth stream");
		await expect(map).not.toContainText("unplanned");
		// The dependency edge renders as a marker-tipped path inside the map SVG.
		await expect(map.locator('path[marker-end*="activity-edge-arrow"]')).toHaveCount(1);
	});

	test("a running card wears ONE short model badge and no default agent/model chip", async ({ page }) => {
		await primeUiState(page, { zoom: "4" });
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					in_progress: [buildBoardCard({ id: "w1", title: "Working card", extra: { agentId: "nklein" } })],
				}),
				sessions: {
					w1: taskSessionSummary("w1", { modelId: "mistralai/devstral-small-2-2512" }),
				},
			}),
		});
		await gotoBoard(page);
		const card = page.locator("[data-task-id]").filter({ hasText: "Working card" }).first();
		await expect(card).toBeVisible();
		const badge = card.locator("[data-model-badge]");
		// Noise suffixes stripped — a readable name, not middle-truncated gibberish; full id in the tooltip.
		await expect(badge).toContainText("devstral-small-2");
		await expect(badge).toHaveAttribute("title", /mistralai\/devstral-small-2-2512/);
		// No duplicated "agent · default model" chip alongside the actual-model badge.
		await expect(card).not.toContainText("!Klein ·");
	});

	test("Clean opens a card as the minimal sheet; Full detail expands in place (§5.BB S3)", async ({ page }) => {
		// Boot at Advanced (gotoBoard's readiness probe needs the board), then walk into Clean like a user.
		await primeUiState(page, { zoom: "2" });
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({
				columns: buildBoardColumns({
					in_progress: [buildBoardCard({ id: "s1", title: "Sheet card" })],
				}),
			}),
		});
		await gotoBoard(page);
		await page.getByRole("button", { name: "1 Clean" }).click();
		await page.locator("[data-cluster-id]").first().click();
		// Click the card in the lean grid → the MINIMAL sheet, not the full detail view.
		await page.getByTestId("lean-lane-doing").getByText("Sheet card").click();
		const sheet = page.getByTestId("card-sheet");
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText("Sheet card");
		await expect(page.getByTestId("card-detail-view")).toHaveCount(0);
		// Progressive disclosure: one tap opens the full detail view at the same level.
		await page.getByTestId("card-sheet-full-detail").click();
		await expect(page.getByTestId("card-detail-view")).toBeVisible();
	});
});
