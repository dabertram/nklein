import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueuedRuntimeTaskStart } from "../../src/trpc/runtime-task-start-queue";
import {
	loadQueuedTaskStartsFromDisk,
	saveQueuedTaskStartsToDisk,
} from "../../src/trpc/runtime-task-start-queue-store";

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

describe("durable queued-start store (file I/O)", () => {
	let dir: string;
	let path: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nklein-queue-store-"));
		path = join(dir, "nested", "task-start-queue.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("round-trips the queue snapshot to disk (creating parent dirs)", async () => {
		const entries = [entry("t1"), entry("t2", { attempts: 4, lastError: "endpoint busy" })];
		await saveQueuedTaskStartsToDisk(path, entries);
		expect(await loadQueuedTaskStartsFromDisk(path)).toEqual(entries);
	});

	it("returns an empty list when the snapshot file does not exist", async () => {
		expect(await loadQueuedTaskStartsFromDisk(join(dir, "missing.jsonl"))).toEqual([]);
	});

	it("overwrites the snapshot on each save (last write wins)", async () => {
		await saveQueuedTaskStartsToDisk(path, [entry("t1"), entry("t2")]);
		await saveQueuedTaskStartsToDisk(path, [entry("t3")]);
		const loaded = await loadQueuedTaskStartsFromDisk(path);
		expect(loaded.map((e) => e.input.taskId)).toEqual(["t3"]);
	});

	it("persists an empty queue as an empty snapshot", async () => {
		await saveQueuedTaskStartsToDisk(path, []);
		expect(await loadQueuedTaskStartsFromDisk(path)).toEqual([]);
	});
});
