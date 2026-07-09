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
			window.localStorage.setItem("nklein.ui-zoom-level.v2", zoom);
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
					in_progress: [buildBoardCard({ id: "d1", title: "Doing card" })],
				}),
			}),
		});
		await gotoBoard(page);
		// Walk the real user path: click the zoom button (the boot zoom depends on stored/migrated state).
		await page.getByRole("button", { name: "Z2 Lean" }).click();
		const queued = page.getByTestId("lean-lane-queued");
		await expect(queued).toBeVisible();
		await expect(queued).toContainText("Queued planning card");
		await expect(page.getByTestId("lean-lane-doing")).toContainText("Doing card");
		await expect(page.getByTestId("lean-lane-review")).toBeVisible();
		await expect(page.getByTestId("lean-lane-done")).toBeVisible();
	});

	test("overview clusters by plan slug with visible directed dependency edges", async ({ page }) => {
		await primeUiState(page, { zoom: "1" });
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
		await page.getByRole("button", { name: "Z1 Overview" }).click();
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
});
