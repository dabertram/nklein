import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStaleWhileRevalidateCache } from "../../../src/core/stale-while-revalidate-cache";

describe("createStaleWhileRevalidateCache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the initial value immediately on a cold get (no coldWait) and refreshes in the background", async () => {
		const refresh = vi.fn(async () => "fresh");
		const cache = createStaleWhileRevalidateCache({ initial: "initial", ttlMs: 1000, refresh });
		expect(await cache.get()).toBe("initial"); // cold → initial, refresh kicked off in background
		expect(refresh).toHaveBeenCalledTimes(1);
		await vi.runAllTimersAsync();
		expect(await cache.get()).toBe("fresh"); // refreshed value now served
	});

	it("awaits the first refresh up to coldWaitMs so an idle first read carries fresh data", async () => {
		const refresh = vi.fn(async () => "fresh");
		const cache = createStaleWhileRevalidateCache({ initial: "initial", ttlMs: 1000, coldWaitMs: 2000, refresh });
		const got = cache.get();
		await vi.runAllTimersAsync();
		expect(await got).toBe("fresh"); // fast refresh resolved within the cold wait
	});

	it("serves the cached value without refreshing while fresh", async () => {
		const refresh = vi.fn(async () => "fresh");
		const cache = createStaleWhileRevalidateCache({ initial: "i", ttlMs: 1000, coldWaitMs: 100, refresh });
		await cache.get();
		await vi.runAllTimersAsync();
		expect(refresh).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(500); // still within TTL
		expect(await cache.get()).toBe("fresh");
		expect(refresh).toHaveBeenCalledTimes(1); // not refreshed again
	});

	it("triggers a background refresh once the TTL elapses (serving the stale value meanwhile)", async () => {
		let value = "v1";
		const refresh = vi.fn(async () => value);
		const cache = createStaleWhileRevalidateCache({ initial: "i", ttlMs: 1000, coldWaitMs: 100, refresh });
		await cache.get();
		await vi.runAllTimersAsync();
		expect(await cache.get()).toBe("v1");
		value = "v2";
		vi.advanceTimersByTime(1500); // now stale
		expect(await cache.get()).toBe("v1"); // serves stale immediately + triggers refresh
		await vi.runAllTimersAsync();
		expect(await cache.get()).toBe("v2"); // refreshed
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("dedupes concurrent refreshes into one in-flight call", async () => {
		const refresh = vi.fn(async () => "fresh");
		const cache = createStaleWhileRevalidateCache({ initial: "i", ttlMs: 1000, refresh });
		await Promise.all([cache.get(), cache.get(), cache.get()]);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("keeps the last good value when a refresh rejects (never throws into get)", async () => {
		let mode: "ok" | "fail" = "ok";
		const refresh = vi.fn(async () => {
			if (mode === "fail") {
				throw new Error("boom");
			}
			return "good";
		});
		const cache = createStaleWhileRevalidateCache({ initial: "i", ttlMs: 1000, coldWaitMs: 100, refresh });
		await cache.get();
		await vi.runAllTimersAsync();
		expect(await cache.get()).toBe("good");
		mode = "fail";
		vi.advanceTimersByTime(1500);
		expect(await cache.get()).toBe("good"); // stale served; refresh will fail
		await vi.runAllTimersAsync();
		expect(await cache.get()).toBe("good"); // last good value retained
	});

	it("invalidate() forces the next get to refresh", async () => {
		const refresh = vi.fn(async () => "fresh");
		const cache = createStaleWhileRevalidateCache({ initial: "i", ttlMs: 100_000, refresh });
		await cache.get();
		await vi.runAllTimersAsync();
		expect(refresh).toHaveBeenCalledTimes(1);
		cache.invalidate();
		await cache.get();
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});
