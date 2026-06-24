import { describe, expect, it } from "vitest";
import { createAsyncQueue } from "../../../src/chat/async-queue";

async function collect<T>(queue: AsyncIterable<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of queue) {
		items.push(item);
	}
	return items;
}

describe("createAsyncQueue", () => {
	it("delivers items pushed before iteration (buffered), then completes on close", async () => {
		const queue = createAsyncQueue<number>();
		queue.push(1);
		queue.push(2);
		queue.close();
		expect(await collect(queue)).toEqual([1, 2]);
	});

	it("delivers items pushed while the consumer is awaiting", async () => {
		const queue = createAsyncQueue<string>();
		const collected = collect(queue);
		// Push asynchronously, after the consumer has started awaiting.
		await Promise.resolve();
		queue.push("a");
		await Promise.resolve();
		queue.push("b");
		queue.close();
		expect(await collected).toEqual(["a", "b"]);
	});

	it("drains buffered items, then rejects with the failure", async () => {
		const queue = createAsyncQueue<number>();
		queue.push(1);
		queue.fail(new Error("boom"));
		const iterator = queue[Symbol.asyncIterator]();
		expect(await iterator.next()).toEqual({ value: 1, done: false });
		await expect(iterator.next()).rejects.toThrow("boom");
	});

	it("ignores pushes after close", async () => {
		const queue = createAsyncQueue<number>();
		queue.push(1);
		queue.close();
		queue.push(2);
		expect(await collect(queue)).toEqual([1]);
	});
});
