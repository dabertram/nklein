/**
 * A minimal push→pull async queue (todo §5.M streaming). It bridges a callback-style producer (the chat model's
 * `onToken(delta)`) to the pull-style async iterator a tRPC v11 `subscription` yields from: the producer `push`es
 * items and `close`s (or `fail`s) when done, while the consumer `for await`s them. Items pushed before the consumer
 * pulls are buffered, so no token is lost. Kept generic + dependency-free so it's trivially unit-testable.
 */
export interface AsyncQueue<T> {
	/** Enqueue an item for the consumer. No-op after close/fail. */
	push: (item: T) => void;
	/** Signal end-of-stream; the consumer's iteration completes after draining buffered items. */
	close: () => void;
	/** Signal failure; the consumer's iteration rejects with this error after draining buffered items. */
	fail: (error: unknown) => void;
	[Symbol.asyncIterator]: () => AsyncIterator<T>;
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
	const buffer: T[] = [];
	let waiting: (() => void) | null = null;
	let closed = false;
	let failure: { error: unknown } | null = null;

	const wake = (): void => {
		const resolve = waiting;
		waiting = null;
		resolve?.();
	};

	return {
		push: (item) => {
			if (closed || failure) {
				return;
			}
			buffer.push(item);
			wake();
		},
		close: () => {
			if (closed || failure) {
				return;
			}
			closed = true;
			wake();
		},
		fail: (error) => {
			if (closed || failure) {
				return;
			}
			failure = { error };
			wake();
		},
		[Symbol.asyncIterator]: () => ({
			next: async (): Promise<IteratorResult<T>> => {
				while (true) {
					if (buffer.length > 0) {
						return { value: buffer.shift() as T, done: false };
					}
					if (failure) {
						throw failure.error;
					}
					if (closed) {
						return { value: undefined, done: true };
					}
					await new Promise<void>((resolve) => {
						waiting = resolve;
					});
				}
			},
		}),
	};
}
