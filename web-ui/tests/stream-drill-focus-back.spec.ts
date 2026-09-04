import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import { buildBoardCard, buildBoardColumns, buildBoardSnapshot, installRuntimeMock } from "./harness/runtime-mock";

/**
 * F2.16 — the stream drill-down's REMAINING residue: focus/BACK behaviour, not the drill itself (which W3.4
 * shipped). 2026-09-04 (David: "make the dag view look and behave like the other modes"): the dependency graph
 * is a MODE TAB in the zoom bar, not a full-screen overlay — so "back" is simply picking another mode, there is
 * no × to hunt for, and selecting a node opens the card the same way a board card does. What must hold: the
 * Graph tab renders the graph inline, any other tab restores its own view, node selection drills to the card,
 * and keyboard users can complete the journey (nodes are `role="button"` + tabIndex=0 by design).
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

const graphTab = (page: Parameters<typeof gotoBoard>[0]) => page.getByRole("button", { name: "G Graph" });

test.describe("stream drill-down focus/back (F2.16)", () => {
	test("the Graph tab shows the graph inline and another tab restores the board", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await graphTab(page).click();
		await expect(page.getByTestId("board-dag-view")).toBeVisible();
		// No overlay chrome: nothing to close, the zoom bar stays reachable with the graph showing.
		await expect(page.getByTestId("board-dag-close")).toHaveCount(0);
		await expect(graphTab(page)).toBeVisible();

		await page.getByRole("button", { name: "2 Advanced" }).click();
		await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		await expect(page.getByText("Parent card").first()).toBeVisible();
	});

	test("the Graph tab is available from every mode, including Minimalistic", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await page.getByRole("button", { name: "0 Minimalistic" }).click();
		await expect(graphTab(page)).toBeVisible();
		await graphTab(page).click();
		await expect(page.getByTestId("board-dag-view")).toBeVisible();
	});

	test("selecting a node drills to the card", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await graphTab(page).click();
		await page.getByTestId("dag-node-card-parent").click();

		// The drilled card is now the focus: assert a CARD-DETAIL marker, not the card title — the title also
		// exists on the graph node behind the detail, so matching it would resolve to a hidden node.
		await expect(page.getByText("All Changes").first()).toBeVisible();
	});

	test("a keyboard user can drill with Enter (nodes are focusable by design)", async ({ page }) => {
		await gotoBoardWithGraph(page);
		await graphTab(page).click();

		const node = page.getByTestId("dag-node-card-parent");
		await node.focus();
		await expect(node).toBeFocused();
		await page.keyboard.press("Enter");

		await expect(page.getByText("All Changes").first()).toBeVisible();
	});

	test("switching modes back and forth is stable (no leaked state across the round trip)", async ({ page }) => {
		await gotoBoardWithGraph(page);
		for (let round = 0; round < 2; round += 1) {
			await graphTab(page).click();
			await expect(page.getByTestId("board-dag-view")).toBeVisible();
			await page.getByRole("button", { name: "1 Clean" }).click();
			await expect(page.getByTestId("board-dag-view")).toHaveCount(0);
		}
		await expect(graphTab(page)).toBeVisible();
	});
});
