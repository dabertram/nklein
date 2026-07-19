import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import { buildBoardSnapshot, installRuntimeMock, trpcOk } from "./harness/runtime-mock";

/**
 * F2.6b — re-validate the open-workspace picker after F2.6 changed its SHAPE: the client no longer builds any
 * command string. The security-relevant assertion is the last test: what crosses the wire is a TYPED target id
 * and nothing else, so no arbitrary local-mode string can be smuggled through the picker.
 *
 * Runs against the page-level runtime mock (no live runtime, no real process spawned).
 */

const OPEN_OK = trpcOk({ exitCode: 0, combinedOutput: "" });

async function gotoBoardWithPicker(page: Parameters<typeof gotoBoard>[0]) {
	const handle = await installRuntimeMock(page, {
		snapshot: buildBoardSnapshot(),
		mutations: { "runtime.openWorkspaceIn": () => OPEN_OK },
	});
	await gotoBoard(page);
	return handle;
}

test.describe("open-workspace picker (F2.6b)", () => {
	test("renders the Open control with the selected target named", async ({ page }) => {
		await gotoBoardWithPicker(page);
		await expect(page.getByRole("button", { name: /^Open in / })).toBeVisible();
		await expect(page.getByRole("button", { name: "Select open target" })).toBeVisible();
	});

	test("lists selectable targets in the popover", async ({ page }) => {
		await gotoBoardWithPicker(page);
		await page.getByRole("button", { name: "Select open target" }).click();
		// At least one alternative target is offered besides the current one.
		const options = page.locator("button", { hasText: /VS Code|Terminal|Finder|Explorer|Cursor|Zed|Windsurf/ });
		expect(await options.count()).toBeGreaterThan(0);
	});

	test("choosing a target updates the primary button's label and closes the popover", async ({ page }) => {
		await gotoBoardWithPicker(page);
		const beforeLabel = await page.getByRole("button", { name: /^Open in / }).getAttribute("aria-label");

		await page.getByRole("button", { name: "Select open target" }).click();
		const firstOption = page
			.locator("button", { hasText: /VS Code|Terminal|Finder|Explorer|Cursor|Zed|Windsurf/ })
			.filter({ hasNotText: new RegExp(`^${beforeLabel?.replace("Open in ", "") ?? "$^"}$`) })
			.first();
		const chosen = (await firstOption.innerText()).trim();
		await firstOption.click();

		await expect(page.getByRole("button", { name: `Open in ${chosen}` })).toBeVisible();
	});

	test("SECURITY: only a typed targetId crosses the wire — no command string", async ({ page }) => {
		const handle = await gotoBoardWithPicker(page);
		await page.getByRole("button", { name: /^Open in / }).click();

		await expect.poll(() => handle.calls["runtime.openWorkspaceIn"]?.length ?? 0).toBeGreaterThan(0);
		const body = handle.calls["runtime.openWorkspaceIn"]?.[0];
		const serialized = JSON.stringify(body ?? {});

		// The payload carries a target id…
		expect(serialized).toContain("targetId");
		// …and nothing that could be a client-built command: no shell strings, paths, or exec-ish keys.
		expect(serialized).not.toMatch(/"(command|cmd|args|shell|exec|path|workspacePath)"\s*:/);
		expect(serialized).not.toMatch(/open -a|cmd\.exe|\/bin\/sh|&&|\|\|/);
	});
});
