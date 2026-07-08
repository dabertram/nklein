import { expect, type Page, test } from "@playwright/test";
import { gotoBoard } from "./harness/board-actions";
import {
	buildBoardCard,
	buildBoardColumns,
	buildBoardSnapshot,
	chatMessage,
	installRuntimeMock,
	taskChatMessageFrame,
	taskSessionSummary,
	taskSessionsUpdatedFrame,
} from "./harness/runtime-mock";

/**
 * Smoothness/perf assertions on the mock harness (todo §"Smoothness/perf assertions"): catch main-thread JANK
 * regressions — render storms where a high-frequency stream re-renders the whole board — not micro-benchmarks.
 * Budgets are deliberately GENEROUS (shared CI machines vary widely); they only trip on catastrophic regressions:
 * a 10Hz frame burst re-rendering 40+ cards per flush blows past them, normal batched rendering stays far under.
 * Long tasks are captured via PerformanceObserver('longtask'); "blocking time" = sum of (duration - 50ms) per task.
 */

const SINGLE_LONG_TASK_BUDGET_MS = 1_000;
const RENDER_BLOCKING_BUDGET_MS = 2_500;
const STREAM_BLOCKING_BUDGET_MS = 2_500;

interface LongTaskWindow {
	__longTasks?: number[];
}

/** Install BEFORE page.goto: records every long-task duration from document start. */
async function installLongTaskProbe(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const w = window as Window & LongTaskWindow;
		w.__longTasks = [];
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					w.__longTasks?.push(entry.duration);
				}
			}).observe({ type: "longtask", buffered: true });
		} catch {
			// longtask unsupported → probe stays empty and the budgets trivially pass (better than a hard fail here).
		}
	});
}

function readLongTasks(page: Page): Promise<number[]> {
	return page.evaluate(() => (window as Window & LongTaskWindow).__longTasks ?? []);
}

function resetLongTasks(page: Page): Promise<void> {
	return page.evaluate(() => {
		(window as Window & LongTaskWindow).__longTasks = [];
	});
}

function blockingTime(durations: number[]): number {
	return durations.reduce((total, duration) => total + Math.max(0, duration - 50), 0);
}

function buildBusyColumns(cardsPerColumn: number): ReturnType<typeof buildBoardColumns> {
	const cardsFor = (column: string): Record<string, unknown>[] =>
		Array.from({ length: cardsPerColumn }, (_, index) =>
			buildBoardCard({ id: `${column}-task-${index}`, title: `${column} task ${index} — busy-board fixture` }),
		);
	return buildBoardColumns({
		backlog: cardsFor("backlog"),
		planning: cardsFor("planning"),
		in_progress: cardsFor("in_progress"),
		review: cardsFor("review"),
		completed: cardsFor("completed"),
	});
}

test.describe("board smoothness (long-task budgets on the mock harness)", () => {
	test("initial render of a busy board stays within the blocking budget", async ({ page }) => {
		await installRuntimeMock(page, {
			snapshot: buildBoardSnapshot({ columns: buildBusyColumns(8) }),
		});
		await installLongTaskProbe(page);
		await gotoBoard(page);
		// Let deferred work (post-hydration effects, first flush) land before judging.
		await page.waitForTimeout(500);

		const longTasks = await readLongTasks(page);
		expect(Math.max(0, ...longTasks)).toBeLessThan(SINGLE_LONG_TASK_BUDGET_MS);
		expect(blockingTime(longTasks)).toBeLessThan(RENDER_BLOCKING_BUDGET_MS);
	});

	test("a task-start + chat/reasoning streaming burst stays smooth and the card shows the live snippet", async ({
		page,
	}) => {
		const card = buildBoardCard({ id: "task-perf-1", title: "Streaming perf task" });
		const columns = buildBusyColumns(8);
		const inProgress = columns.find((column) => (column as { id?: string }).id === "in_progress") as {
			cards: unknown[];
		};
		inProgress.cards.push(card);
		const handle = await installRuntimeMock(page, { snapshot: buildBoardSnapshot({ columns }) });
		await installLongTaskProbe(page);
		await gotoBoard(page);
		await expect(page.locator('[data-task-id="task-perf-1"]')).toBeVisible();
		await resetLongTasks(page);

		// Task start: the session flips to running…
		handle.pushFrame(taskSessionsUpdatedFrame([taskSessionSummary("task-perf-1", { state: "running" })]));
		// …then ~2s of 10-frames-per-100ms reasoning streaming (same message id, growing content — the live upsert
		// shape) with a session-state frame every round. This is the exact firehose the batched dispatch + App-level
		// snippet memo exist to absorb.
		let content = "";
		for (let round = 0; round < 15; round += 1) {
			for (let step = 0; step < 10; step += 1) {
				content += `thinking step ${round}-${step}. `;
				handle.pushFrame(
					taskChatMessageFrame(
						"task-perf-1",
						chatMessage("reasoning-perf-1", "reasoning", `${content}\nline ${round}`),
					),
				);
			}
			handle.pushFrame(taskSessionsUpdatedFrame([taskSessionSummary("task-perf-1", { state: "running" })]));
			await page.waitForTimeout(100);
		}
		// Let the final batch flush render.
		await page.waitForTimeout(400);

		// The streamed reasoning actually reached the card (L3688 snippet — proves frames applied, not dropped)…
		await expect(page.locator('[data-task-id="task-perf-1"]')).toContainText("Thinking: line 14");
		// …without blowing the jank budgets while 40+ sibling cards sat on the board.
		const longTasks = await readLongTasks(page);
		expect(Math.max(0, ...longTasks)).toBeLessThan(SINGLE_LONG_TASK_BUDGET_MS);
		expect(blockingTime(longTasks)).toBeLessThan(STREAM_BLOCKING_BUDGET_MS);
	});
});
