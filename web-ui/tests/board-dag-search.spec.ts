/**
 * F2.31b — DAG node search. Matches title, id or prompt (every term must match), DIMS non-matches instead of hiding
 * them (the edges are the point of the view), and Enter walks the matches. Pinned on the page-level runtime mock
 * at the Graph zoom level.
 */
import { expect, test } from "@playwright/test";
import { buildBoardCard, buildBoardColumns, buildBoardSnapshot, installRuntimeMock } from "./harness/runtime-mock";

async function openGraph(page: import("@playwright/test").Page) {
	const snapshot = buildBoardSnapshot({
		columns: buildBoardColumns({
			backlog: [
				buildBoardCard({ id: "auth-login", title: "Add the login form" }),
				buildBoardCard({ id: "auth-ledger", title: "Ledger schema" }),
				buildBoardCard({
					id: "ui-nav",
					title: "Navigation",
					prompt: "Wire the LOGIN link into the navigation bar",
				}),
			],
		}),
		dependencies: [{ id: "e1", fromTaskId: "auth-login", toTaskId: "auth-ledger", createdAt: 1 }],
	});
	await installRuntimeMock(page, { snapshot });
	await page.goto("/");
	await expect(page.getByText("Backlog", { exact: true })).toBeVisible();
	// The Graph is a tab of the zoom bar (2026-09-04: "make the dag view look and behave like the other modes").
	await page.getByRole("button", { name: "G Graph", exact: true }).click();
	await expect(page.getByTestId("board-dag-view")).toBeVisible();
	await expect(page.getByTestId("board-dag-search")).toBeVisible();
}

test.describe("DAG node search (F2.31b)", () => {
	test("matches title, id and prompt; non-matches dim, Enter walks the matches, Escape clears", async ({ page }) => {
		await openGraph(page);
		const search = page.getByTestId("board-dag-search");
		await search.fill("login");
		await expect(page.getByTestId("board-dag-search-count")).toHaveText("1 of 2");
		await expect(page.getByTestId("dag-node-auth-login")).toHaveAttribute("data-dag-match", "true");
		await expect(page.getByTestId("dag-node-ui-nav")).toHaveAttribute("data-dag-match", "true"); // prompt match
		await expect(page.getByTestId("dag-node-auth-ledger")).toHaveAttribute("data-dag-match", "false");
		await expect(page.getByTestId("dag-node-auth-ledger")).toHaveAttribute("opacity", "0.22");
		await expect(page.getByTestId("dag-node-auth-login")).toHaveAttribute("data-dag-search-current", "true");

		await search.press("Enter");
		await expect(page.getByTestId("board-dag-search-count")).toHaveText("2 of 2");
		await expect(page.getByTestId("dag-node-ui-nav")).toHaveAttribute("data-dag-search-current", "true");
		await search.press("Enter");
		await expect(page.getByTestId("board-dag-search-count")).toHaveText("1 of 2");

		await search.fill("login nowhere");
		await expect(page.getByTestId("board-dag-search-count")).toHaveText("no match");

		await search.press("Escape");
		await expect(search).toHaveValue("");
		await expect(page.getByTestId("board-dag-search-count")).toHaveCount(0);
		// Nothing dimmed once the query is gone.
		await expect(page.getByTestId("dag-node-auth-ledger")).not.toHaveAttribute("data-dag-match", /.+/);
	});
});
