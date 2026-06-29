import { describe, expect, it, vi } from "vitest";
import { isTransientNetworkError, withTransientRetry } from "../../../src/core/transient-error";

describe("isTransientNetworkError", () => {
	it("flags the undici timeouts a live scout actually hit", () => {
		expect(isTransientNetworkError("Agent error: Body Timeout Error")).toBe(true);
		expect(isTransientNetworkError(new Error("fetch failed"))).toBe(true);
		expect(isTransientNetworkError(new Error("HeadersTimeoutError: Headers Timeout Error"))).toBe(true);
	});

	it("reads the undici code off error.cause", () => {
		const err = new Error("fetch failed");
		(err as { cause?: unknown }).cause = new Error("UND_ERR_BODY_TIMEOUT");
		expect(isTransientNetworkError(err)).toBe(true);
	});

	it("flags connection blips and transient server states", () => {
		expect(isTransientNetworkError("read ECONNRESET")).toBe(true);
		expect(isTransientNetworkError("socket hang up")).toBe(true);
		expect(isTransientNetworkError(new Error("503 Service Unavailable"))).toBe(true);
		expect(isTransientNetworkError({ message: "The server is overloaded" })).toBe(true);
	});

	it("does NOT flag a genuine, non-transient failure", () => {
		expect(isTransientNetworkError("Type validation failed: invalid tool arguments")).toBe(false);
		expect(isTransientNetworkError(new Error("model declined to call a tool"))).toBe(false);
		expect(isTransientNetworkError(null)).toBe(false);
		expect(isTransientNetworkError(undefined)).toBe(false);
		expect(isTransientNetworkError(42)).toBe(false);
	});
});

describe("withTransientRetry", () => {
	const noSleep = () => Promise.resolve();

	it("retries a transient failure then succeeds, within the budget", async () => {
		let calls = 0;
		const result = await withTransientRetry(
			async () => {
				calls += 1;
				if (calls < 3) {
					throw new Error("Body Timeout Error");
				}
				return "ok";
			},
			{ maxRetries: 3, sleep: noSleep },
		);
		expect(result).toBe("ok");
		expect(calls).toBe(3); // 2 transient throws + 1 success
	});

	it("rethrows a NON-transient error immediately (no retries)", async () => {
		const fn = vi.fn(async () => {
			throw new Error("Type validation failed");
		});
		await expect(withTransientRetry(fn, { maxRetries: 3, sleep: noSleep })).rejects.toThrow("Type validation failed");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("rethrows the transient error after the retry budget is exhausted", async () => {
		const fn = vi.fn(async () => {
			throw new Error("fetch failed");
		});
		const onRetry = vi.fn();
		await expect(withTransientRetry(fn, { maxRetries: 2, sleep: noSleep, onRetry })).rejects.toThrow("fetch failed");
		expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
		expect(onRetry).toHaveBeenCalledTimes(2);
	});

	it("applies the injected backoff delay between retries", async () => {
		const slept: number[] = [];
		let calls = 0;
		await withTransientRetry(
			async () => {
				calls += 1;
				if (calls < 2) {
					throw new Error("ECONNRESET");
				}
				return 1;
			},
			{ delayMs: (attempt) => attempt * 100, sleep: async (ms) => void slept.push(ms) },
		);
		expect(slept).toEqual([100]); // one retry, backoff for attempt 1
	});
});
