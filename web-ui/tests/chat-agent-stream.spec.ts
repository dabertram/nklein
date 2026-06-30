import { expect, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	chatMessage,
	installRuntimeMock,
	taskChatMessageFrame,
} from "./harness/runtime-mock";

/**
 * The "LLM use" e2e payoff (§5.AK/§5.AQ): a streamed `task_chat_message` (a simulated AGENT response) renders live in
 * the card's agent chat panel — model-free, deterministic. Proves the UI surfaces streamed model output end-to-end.
 * (The per-card agent chat panel renders only for an nklein-agent card — `agentId: "nklein"`, card-detail-view.tsx:515.)
 */
test.describe("agent chat streaming (harness pushFrame)", () => {
	test("a streamed assistant message renders live in the card's agent chat panel", async ({ page }) => {
		const card = { ...buildBoardCard({ id: "task-chat-1", title: "Chat streaming task" }), agentId: "nklein" };
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-chat-1"]');
		await expect(cardLocator).toBeVisible();
		// Open the card detail → its agent chat panel.
		await cardLocator.locator("p").filter({ hasText: "Chat streaming task" }).first().click();

		// Stream a simulated agent response; it appears live in the agent chat transcript (model-free).
		handle.pushFrame(
			taskChatMessageFrame("task-chat-1", chatMessage("msg-1", "assistant", "Hello from the streamed agent.")),
		);
		await expect(page.getByText("Hello from the streamed agent.")).toBeVisible({ timeout: 10_000 });
	});

	test("incremental token-streaming: re-emitting the same message id grows the text in place", async ({ page }) => {
		const card = { ...buildBoardCard({ id: "task-chat-2", title: "Token streaming task" }), agentId: "nklein" };
		const handle = await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBoardColumns({ in_progress: [card] }) }),
		});
		await gotoBoard(page);

		const cardLocator = page.locator('[data-task-id="task-chat-2"]');
		await expect(cardLocator).toBeVisible();
		await cardLocator.locator("p").filter({ hasText: "Token streaming task" }).first().click();

		// First token chunk for msg-stream renders…
		handle.pushFrame(taskChatMessageFrame("task-chat-2", chatMessage("msg-stream", "assistant", "Streaming")));
		await expect(page.getByText("Streaming", { exact: true })).toBeVisible({ timeout: 10_000 });

		// …then the SAME message id is re-emitted with grown content (token-by-token append). The upsert-by-id reducer
		// must replace in place — the final text shows, and the partial chunk no longer lingers as its own bubble.
		handle.pushFrame(
			taskChatMessageFrame("task-chat-2", chatMessage("msg-stream", "assistant", "Streaming token by token.")),
		);
		await expect(page.getByText("Streaming token by token.")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText("Streaming", { exact: true })).toHaveCount(0);
	});
});
