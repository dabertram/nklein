import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import { buildBoardCard, buildBoardColumns, buildBoardSnapshot, installRuntimeMock } from "./harness/runtime-mock";

/**
 * F2.16 — the stream drill-down's REMAINING residue: focus/BACK behaviour, not the drill itself (which W3.4
 * shipped). What must hold: opening the dependency graph and closing it — by ×, by Escape, or by selecting a
 * node — always returns the operator to a usable board context rather than a lost state, and keyboard users can
 * complete the same journey (the DAG nodes are `role="button"` + tabIndex=0 by design, so Enter must select).
 *
 * Runs entirely against the page-level runtime mock (no live runtime is touched).
 */

const PARENT = buildBoardCard({ title: "Parent card", id: "card-parent" });
const CHILD = buildBoardCard({ title: "Child card", id: "card-child" });

async function gotoBoardWithGraph(page: Parameters<typeof gotoBoard>[0]): Promise<void> {
	await installRuntimeMock(page, {
		snapshot: buildBoardSnapshot({
			columns: buildBoardColumns({ backlog: [PARENT, CHILD] }),
			dependencies: [{ id: "dep-1", fromTaskId: "card-child", toTaskId: "card-parent" }],
		}),
	});
	await gotoBoard(page);
}

test.describe("stream drill-down focus/back (F2.16)", () => {
	test("opens the DAG and returns to the board when closed with ×", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await page.getByTestId("open-dag-view").click();
		await expect(page.getByTestId("board-dag-view")).toBeVisible();

		await page.getByTestId("board-dag-close").click();
		await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		// BACK lands on the board, not a blank/lost state: the trigger is reachable again.
		await expect(page.getByTestId("open-dag-view")).toBeVisible();
	});

	test("Escape closes the graph and restores the board context", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await page.getByTestId("open-dag-view").click();
		await expect(page.getByTestId("board-dag-view")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		await expect(page.getByTestId("open-dag-view")).toBeVisible();
	});

	test("selecting a node drills to the card AND closes the graph (no stacked overlay)", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await page.getByTestId("open-dag-view").click();
		await page.getByTestId("dag-node-card-parent").click();

		// The overlay must close as it drills — a card opened BEHIND a full-screen graph is the lost state.
		await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		// The drilled card is now the focus: assert a CARD-DETAIL marker, not the card title — the title also
		// exists on the board card behind the detail, so matching it would resolve to a hidden node.
		await expect(page.getByText("All Changes").first()).toBeVisible();
	});

	test("a keyboard user can drill with Enter (nodes are focusable by design)", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await page.getByTestId("open-dag-view").click();

		const node = page.getByTestId("dag-node-card-parent");
		await node.focus();
		await expect(node).toBeFocused();
		await page.keyboard.press("Enter");

		await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		await expect(page.getByText("All Changes").first()).toBeVisible();
	});

	test("re-opening after a close is stable (no leaked state across the round trip)", async ({ page }) => {
		await gotoBoardWithGraph(page);
		for (let round = 0; round < 2; round += 1) {
			await page.getByTestId("open-dag-view").click();
			await expect(page.getByTestId("board-dag-view")).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		}
		await expect(page.getByTestId("open-dag-view")).toBeVisible();
	});
});
