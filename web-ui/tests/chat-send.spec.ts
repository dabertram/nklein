import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	installRuntimeMock,
	trpcOk,
} from "./harness/runtime-mock";

/**
 * TIER-1 "LLM use" flow (gap map): send a message to a task's agent. Typing in the agent chat composer and sending must
 * fire `runtime.sendTaskChatMessage`. Mocked + capture-asserted. (Agent panel needs an `agentId:"nklein"` card.)
 */
test.describe("agent chat send flow", () => {
	test("sending a chat message fires runtime.sendTaskChatMessage", async ({ page }) => {
		const card = { ...buildBoardCard({ id: "task-chat-send-1", title: "Chat send task" }), agentId: "nklein" };
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
			mutations: { "runtime.sendTaskChatMessage": () => trpcOk({ ok: true }) },
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-chat-send-1"]');
		await expect(cardLocator).toBeVisible();
		await cardLocator.locator("p").filter({ hasText: "Chat send task" }).first().click();

		// Type into the agent chat composer and send.
		await page.getByPlaceholder(/Ask !Klein/i).fill("Please summarize the task.");
		await page.getByRole("button", { name: "Send message" }).first().click();

		await expect.poll(() => handle.calls["runtime.sendTaskChatMessage"]?.length ?? 0).toBeGreaterThan(0);
	});
});
