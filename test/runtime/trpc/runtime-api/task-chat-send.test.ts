import { describe, expect, it, vi } from "vitest";
import type { RuntimeTrpcWorkspaceScope } from "../../../../src/trpc/app-router";
import { handleSendTaskChatMessage, type TaskChatSendDeps } from "../../../../src/trpc/runtime-api/task-chat-send";

const workspaceScope = { workspaceId: "ws1" } as unknown as RuntimeTrpcWorkspaceScope;

describe("handleSendTaskChatMessage — /clear teardown ordering", () => {
	it("clears the session even when launch-config resolution would throw (e.g. the model was unloaded)", async () => {
		// Regression: /clear is a pure teardown and must not be gated behind resolveLaunchConfig, which throws when
		// the selected model can't be resolved — exactly the recovery state where a user reaches for /clear. A
		// providerId override forces the old code down the resolveLaunchConfig path before the /clear early-return.
		const clearTaskSession = vi.fn(async (taskId: string) => ({ taskId, cleared: true }));
		const resolveLaunchConfig = vi.fn(async () => {
			throw new Error('Selected LM Studio model "coder" is not currently loaded.');
		});
		const broadcastTaskChatCleared = vi.fn();
		const deps = {
			getScopedNKleinTaskSessionService: async () => ({ clearTaskSession }) as never,
			nkleinProviderService: { resolveLaunchConfig } as never,
			broadcastTaskChatCleared,
		} as unknown as TaskChatSendDeps;

		const result = await handleSendTaskChatMessage(
			workspaceScope,
			{ taskId: "t1", text: "/clear", providerId: "lmstudio" } as never,
			deps,
		);

		expect(result.ok).toBe(true);
		expect(clearTaskSession).toHaveBeenCalledWith("t1");
		expect(broadcastTaskChatCleared).toHaveBeenCalledWith("ws1", "t1");
		// The whole point: teardown must NOT depend on resolving the (possibly-unloaded) model.
		expect(resolveLaunchConfig).not.toHaveBeenCalled();
	});
});

describe("handleSendTaskChatMessage — terminal-lane guard (G6.8a v14 ghost)", () => {
	it("refuses guidance to a completed-lane card instead of starting a ghost session", async () => {
		// Live v14 (2026-07-29): guidance delivered around completion restarted a fresh worker session on a
		// COMPLETED card; its awaiting_review summary then held a concurrency slot forever (board livelock).
		vi.resetModules();
		vi.doMock("../../../../src/state/workspace-state", () => ({
			loadWorkspaceState: async () => ({
				board: {
					columns: [
						{ id: "completed", cards: [{ id: "t-done" }] },
						{ id: "in_progress", cards: [] },
					],
				},
			}),
		}));
		const { handleSendTaskChatMessage: handler } = await import("../../../../src/trpc/runtime-api/task-chat-send");
		const sendTaskSessionInput = vi.fn();
		const deps = {
			getScopedNKleinTaskSessionService: async () => ({ sendTaskSessionInput }) as never,
			nkleinProviderService: { resolveLaunchConfig: vi.fn() } as never,
		} as unknown as TaskChatSendDeps;
		const result = await handler(
			{ workspaceId: "ws1", workspacePath: "/tmp/ws" } as unknown as RuntimeTrpcWorkspaceScope,
			{ taskId: "t-done", text: "please tweak the output" } as never,
			deps,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("completed");
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
		vi.doUnmock("../../../../src/state/workspace-state");
	});

	it("refuses guidance to a trashed card with the trash wording", async () => {
		vi.resetModules();
		vi.doMock("../../../../src/state/workspace-state", () => ({
			loadWorkspaceState: async () => ({
				board: { columns: [{ id: "trash", cards: [{ id: "t-gone" }] }] },
			}),
		}));
		const { handleSendTaskChatMessage: handler } = await import("../../../../src/trpc/runtime-api/task-chat-send");
		const deps = {
			getScopedNKleinTaskSessionService: async () => ({}) as never,
			nkleinProviderService: { resolveLaunchConfig: vi.fn() } as never,
		} as unknown as TaskChatSendDeps;
		const result = await handler(
			{ workspaceId: "ws1", workspacePath: "/tmp/ws" } as unknown as RuntimeTrpcWorkspaceScope,
			{ taskId: "t-gone", text: "hello?" } as never,
			deps,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("trash");
		vi.doUnmock("../../../../src/state/workspace-state");
	});
});
