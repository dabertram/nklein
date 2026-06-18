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
});
