import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleRetireTaskSession } from "../../../src/trpc/runtime-api/task-session-io";

/**
 * P1.ZOMBIEBOARD — abandoning a board must RETIRE its sessions, not merely trash its cards: a trashed card whose
 * session is mid-turn restores itself out of trash, and removing the workspace blinds the watchdog that could stop
 * it. The handler records the retirement FIRST (the ledger is what a recovery path consults), then stops the live
 * session mid-turn.
 */
function scope() {
	return { workspaceId: "ws-retire", workspacePath: mkdtempSync(join(tmpdir(), "nklein-retire-")) };
}

describe("handleRetireTaskSession", () => {
	it("records the retirement BEFORE stopping, stops the live session mid-turn, and reports it", async () => {
		const order: string[] = [];
		const retireTaskSession = vi.fn((entry: { taskId: string; reason: string; detail: string }) => {
			order.push(`retire:${entry.taskId}:${entry.reason}`);
		});
		const stopTaskSession = vi.fn(async (taskId: string, options?: { abortActiveTurn?: boolean }) => {
			order.push(`stop:${taskId}:${options?.abortActiveTurn ? "abort" : "graceful"}`);
			return { taskId, state: "interrupted" } as never;
		});
		const result = await handleRetireTaskSession(
			scope(),
			{ taskId: "t-1", reason: "terminal_lane_card", detail: "rail cleanup" },
			{ getScopedNKleinTaskSessionService: async () => ({ retireTaskSession, stopTaskSession }) as never },
		);
		expect(result).toEqual({ ok: true, stopped: true });
		expect(order).toEqual(["retire:t-1:terminal_lane_card", "stop:t-1:abort"]);
		expect(retireTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t-1", reason: "terminal_lane_card", detail: "rail cleanup" }),
		);
	});

	it("still records the retirement when there is no live session to stop (stopped: false)", async () => {
		const retireTaskSession = vi.fn();
		const stopTaskSession = vi.fn(async () => null);
		const result = await handleRetireTaskSession(
			scope(),
			{ taskId: "t-2", reason: "card_absent_from_board" },
			{ getScopedNKleinTaskSessionService: async () => ({ retireTaskSession, stopTaskSession }) as never },
		);
		expect(result).toEqual({ ok: true, stopped: false });
		expect(retireTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t-2", reason: "card_absent_from_board" }),
		);
	});

	it("a failed stop does not undo the retirement — the ledger entry is what keeps the session dead", async () => {
		const retireTaskSession = vi.fn();
		const stopTaskSession = vi.fn(async () => {
			throw new Error("stop exploded");
		});
		const result = await handleRetireTaskSession(
			scope(),
			{ taskId: "t-3", reason: "terminal_lane_card" },
			{ getScopedNKleinTaskSessionService: async () => ({ retireTaskSession, stopTaskSession }) as never },
		);
		expect(result).toEqual({ ok: true, stopped: false });
		expect(retireTaskSession).toHaveBeenCalledTimes(1);
	});

	it("rejects a blank task id without touching the service", async () => {
		const getScopedNKleinTaskSessionService = vi.fn();
		const result = await handleRetireTaskSession(scope(), { taskId: "   ", reason: "terminal_lane_card" }, {
			getScopedNKleinTaskSessionService,
		} as never);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/retire payload/);
		expect(getScopedNKleinTaskSessionService).not.toHaveBeenCalled();
	});
});
