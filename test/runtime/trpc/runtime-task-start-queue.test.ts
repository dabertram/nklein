import { describe, expect, it } from "vitest";

import {
	createRuntimeTaskStartQueue,
	type QueuedRuntimeTaskStart,
	replayPersistedQueuedTaskStarts,
} from "../../../src/trpc/runtime-task-start-queue";

function persistedEntry(
	workspaceId: string,
	taskId: string,
	over: Partial<QueuedRuntimeTaskStart> = {},
): QueuedRuntimeTaskStart {
	return {
		workspaceScope: { workspaceId, workspacePath: `/repo/${workspaceId}` },
		input: { taskId, prompt: "do it", baseRef: "main", queueOnEndpointBusy: true },
		queuedAt: 1_000,
		nextAttemptAt: 1_000,
		attempts: 1,
		lastError: null,
		...over,
	};
}

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

	it("fires onChange with a fresh snapshot only when a mutation actually changes the queue", () => {
		const snapshots: QueuedRuntimeTaskStart[][] = [];
		const queue = createRuntimeTaskStartQueue({ onChange: (entries) => snapshots.push(entries) });

		queue.enqueue({
			workspaceScope: { workspaceId: "w", workspacePath: "/repo/w" },
			request: { taskId: "t", prompt: "p", baseRef: "main" },
			now: 1_000,
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.map((entry) => entry.input.taskId)).toEqual(["t"]);

		// A remove that matches nothing must not persist a redundant snapshot.
		queue.remove("w", "absent");
		expect(snapshots).toHaveLength(1);

		// A real remove fires onChange with the now-empty snapshot.
		queue.remove("w", "t");
		expect(snapshots).toHaveLength(2);
		expect(snapshots[1]).toEqual([]);
	});

	it("replayPersistedQueuedTaskStarts hydrates the queue and arms a drain per restored start at its due time", () => {
		const queue = createRuntimeTaskStartQueue();
		const drains: Array<{ workspaceId: string; delayMs: number }> = [];

		replayPersistedQueuedTaskStarts({
			entries: [
				persistedEntry("w1", "t1", { nextAttemptAt: 6_000 }),
				persistedEntry("w2", "t2", { nextAttemptAt: 3_000, lastError: "endpoint busy" }),
			],
			queue,
			scheduleDrain: (scope, delayMs) => drains.push({ workspaceId: scope.workspaceId, delayMs }),
			now: 4_000,
		});

		expect(queue.size()).toBe(2);
		expect(drains).toEqual([
			{ workspaceId: "w1", delayMs: 2_000 }, // 6_000 - 4_000
			{ workspaceId: "w2", delayMs: 0 }, // 3_000 - 4_000, clamped to 0
		]);
	});

	it("replayPersistedQueuedTaskStarts is a no-op for an empty snapshot", () => {
		const queue = createRuntimeTaskStartQueue();
		let drainCalls = 0;
		replayPersistedQueuedTaskStarts({
			entries: [],
			queue,
			scheduleDrain: () => {
				drainCalls += 1;
			},
		});
		expect(queue.size()).toBe(0);
		expect(drainCalls).toBe(0);
	});
});
