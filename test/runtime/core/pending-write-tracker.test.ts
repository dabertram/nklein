import { describe, expect, it } from "vitest";
import { createPendingWriteTracker } from "../../../src/core/pending-write-tracker";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("createPendingWriteTracker (N13 dispose-flush contract)", () => {
	it("flush resolves only after every tracked write settled", async () => {
		const tracker = createPendingWriteTracker();
		const write = deferred<void>();
		tracker.track(write.promise);
		expect(tracker.pending()).toBe(1);
		let flushed = false;
		const flushing = tracker.flush().then(() => {
			flushed = true;
		});
		await Promise.resolve();
		expect(flushed).toBe(false); // the write is still in flight — flush must not resolve early
		write.resolve();
		await flushing;
		expect(flushed).toBe(true);
		expect(tracker.pending()).toBe(0);
	});

	it("swallows rejections (the fire-and-forget caller already chose not to observe them)", async () => {
		const tracker = createPendingWriteTracker();
		const failing = deferred<void>();
		tracker.track(failing.promise);
		failing.reject(new Error("disk full"));
		await expect(tracker.flush()).resolves.toBeUndefined();
		expect(tracker.pending()).toBe(0);
	});

	it("includes writes tracked WHILE flushing (a write that enqueues another write still flushes)", async () => {
		const tracker = createPendingWriteTracker();
		const first = deferred<void>();
		const second = deferred<void>();
		tracker.track(
			first.promise.then(() => {
				tracker.track(second.promise);
			}),
		);
		const flushing = tracker.flush();
		first.resolve();
		// Give the chained track a tick, then settle the second write.
		await Promise.resolve();
		second.resolve();
		await flushing;
		expect(tracker.pending()).toBe(0);
	});

	it("flush on an idle tracker resolves immediately", async () => {
		await expect(createPendingWriteTracker().flush()).resolves.toBeUndefined();
	});
});
