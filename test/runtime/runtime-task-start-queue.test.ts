import { describe, expect, it } from "vitest";
import {
	parseQueuedTaskStarts,
	type QueuedRuntimeTaskStart,
	serializeQueuedTaskStarts,
} from "../../src/trpc/runtime-task-start-queue";

function entry(taskId: string, over: Partial<QueuedRuntimeTaskStart> = {}): QueuedRuntimeTaskStart {
	return {
		workspaceScope: { workspaceId: "ws", workspacePath: "/repo" },
		input: { taskId, prompt: "do it", baseRef: "main", queueOnEndpointBusy: true },
		queuedAt: 100,
		nextAttemptAt: 200,
		attempts: 1,
		lastError: null,
		...over,
	};
}

describe("durable queued-start store (serialize/parse)", () => {
	it("round-trips entries through serialize → parse", () => {
		const entries = [entry("t1"), entry("t2", { attempts: 3, lastError: "endpoint busy" })];
		const parsed = parseQueuedTaskStarts(serializeQueuedTaskStarts(entries));
		expect(parsed).toEqual(entries);
	});

	it("returns an empty list for empty content", () => {
		expect(parseQueuedTaskStarts("")).toEqual([]);
	});

	it("skips an invalid / non-JSON line but keeps the valid ones", () => {
		const content = `${serializeQueuedTaskStarts([entry("t1")])}\n{"not":"a valid entry"}\nnot json at all`;
		const parsed = parseQueuedTaskStarts(content);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.input.taskId).toBe("t1");
	});
});
