import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescingScheduler } from "../../../src/core/coalescing-scheduler";

describe("createCoalescingScheduler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces a burst into a single run after the window, using the latest arg", () => {
		const run = vi.fn<(arg: string) => void>();
		const scheduler = createCoalescingScheduler(run, 250);
		scheduler.schedule("a");
		scheduler.schedule("b");
		scheduler.schedule("c");
		expect(run).not.toHaveBeenCalled(); // nothing fires synchronously
		vi.advanceTimersByTime(250);
		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith("c"); // latest arg wins
	});

	it("starts a fresh window after firing (continuous requests keep firing — not a debounce)", () => {
		const run = vi.fn<(arg: number) => void>();
		const scheduler = createCoalescingScheduler(run, 100);
		scheduler.schedule(1);
		vi.advanceTimersByTime(100);
		expect(run).toHaveBeenCalledTimes(1);
		// A request after the fire schedules a new window (does not get absorbed into a spent timer).
		scheduler.schedule(2);
		vi.advanceTimersByTime(100);
		expect(run).toHaveBeenCalledTimes(2);
		expect(run).toHaveBeenLastCalledWith(2);
	});

	it("bounds runs to at most one per window under sustained scheduling", () => {
		const run = vi.fn<(arg: number) => void>();
		const scheduler = createCoalescingScheduler(run, 100);
		// 10 schedules over 250ms of virtual time → at most ~3 runs, never 10.
		for (let tick = 0; tick < 10; tick += 1) {
			scheduler.schedule(tick);
			vi.advanceTimersByTime(25);
		}
		expect(run.mock.calls.length).toBeLessThanOrEqual(3);
		expect(run.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("cancel() drops a pending run", () => {
		const run = vi.fn<(arg: string) => void>();
		const scheduler = createCoalescingScheduler(run, 200);
		scheduler.schedule("x");
		scheduler.cancel();
		vi.advanceTimersByTime(500);
		expect(run).not.toHaveBeenCalled();
	});
});
