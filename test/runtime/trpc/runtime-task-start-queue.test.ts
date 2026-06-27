import { describe, expect, it } from "vitest";

import { createRuntimeTaskStartQueue } from "../../../src/trpc/runtime-task-start-queue";

describe("runtime task start queue", () => {
	it("deduplicates queued starts by workspace and task", () => {
		const queue = createRuntimeTaskStartQueue();
		const workspaceScope = {
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		};

		queue.enqueue({
			workspaceScope,
			request: {
				taskId: "task-1",
				prompt: "First",
				baseRef: "main",
			},
			delayMs: 1_000,
			now: 1_000,
		});
		queue.enqueue({
			workspaceScope,
			request: {
				taskId: "task-1",
				prompt: "Second",
				baseRef: "main",
			},
			delayMs: 2_000,
			error: "endpoint busy",
			now: 2_000,
		});

		expect(queue.size("workspace-1")).toBe(1);
		const ready = queue.takeReady("workspace-1", { force: true });
		expect(ready).toHaveLength(1);
		expect(ready[0]?.input.prompt).toBe("Second");
		expect(ready[0]?.input.queueOnEndpointBusy).toBe(true);
		expect(ready[0]?.attempts).toBe(2);
		expect(ready[0]?.lastError).toBe("endpoint busy");
	});

	it("holds delayed starts until the next attempt time unless forced", () => {
		const queue = createRuntimeTaskStartQueue();
		queue.enqueue({
			workspaceScope: {
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			request: {
				taskId: "task-1",
				prompt: "Queued",
				baseRef: "main",
			},
			delayMs: 5_000,
			now: 1_000,
		});

		expect(queue.takeReady("workspace-1", { now: 5_999 })).toEqual([]);
		expect(queue.size("workspace-1")).toBe(1);
		expect(queue.takeReady("workspace-1", { now: 6_000 })).toHaveLength(1);
	});

	it("round-trips a multi-workspace queue through snapshot → hydrate (preserving scheduling state)", () => {
		const queue = createRuntimeTaskStartQueue();
		queue.enqueue({
			workspaceScope: { workspaceId: "workspace-1", workspacePath: "/tmp/a" },
			request: { taskId: "task-1", prompt: "A", baseRef: "main" },
			delayMs: 5_000,
			now: 1_000,
		});
		queue.enqueue({
			workspaceScope: { workspaceId: "workspace-2", workspacePath: "/tmp/b" },
			request: { taskId: "task-2", prompt: "B", baseRef: "main" },
			error: "endpoint busy",
			now: 2_000,
		});

		const snapshot = queue.snapshot();
		expect(snapshot).toHaveLength(2);

		// A fresh queue restored from the snapshot must keep each entry's queuedAt/nextAttemptAt/attempts —
		// so a delayed start stays held until its original due time, not reset to "ready now".
		const restored = createRuntimeTaskStartQueue();
		restored.hydrate(snapshot);
		expect(restored.size()).toBe(2);
		expect(restored.takeReady("workspace-1", { now: 5_999 })).toEqual([]);
		const readyA = restored.takeReady("workspace-1", { now: 6_000 });
		expect(readyA).toHaveLength(1);
		expect(readyA[0]?.input.prompt).toBe("A");
		const readyB = restored.takeReady("workspace-2", { now: 6_000 });
		expect(readyB[0]?.lastError).toBe("endpoint busy");
	});

	it("hydrate replaces any existing entries (last snapshot wins)", () => {
		const queue = createRuntimeTaskStartQueue();
		queue.enqueue({
			workspaceScope: { workspaceId: "workspace-1", workspacePath: "/tmp/a" },
			request: { taskId: "stale", prompt: "stale", baseRef: "main" },
			now: 1_000,
		});
		queue.hydrate([]);
		expect(queue.size()).toBe(0);
		expect(queue.snapshot()).toEqual([]);
	});
});
