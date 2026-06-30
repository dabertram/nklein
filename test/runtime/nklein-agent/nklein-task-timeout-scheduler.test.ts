import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskTimeoutScheduler } from "../../../src/nklein-agent/nklein-task-timeout-scheduler";

describe("TaskTimeoutScheduler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires onFired with the timeout once the delay elapses", () => {
		const scheduler = new TaskTimeoutScheduler();
		const onFired = vi.fn();
		scheduler.schedule("t1", "stream", 1000, onFired);
		expect(onFired).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		expect(onFired).toHaveBeenCalledTimes(1);
		expect(onFired).toHaveBeenCalledWith(1000);
	});

	it("is a no-op for null / non-positive / non-finite timeouts", () => {
		const scheduler = new TaskTimeoutScheduler();
		const onFired = vi.fn();
		scheduler.schedule("t1", "stream", null, onFired);
		scheduler.schedule("t1", "tool", 0, onFired);
		scheduler.schedule("t1", "conversation", -5, onFired);
		scheduler.schedule("t1", "stream", Number.POSITIVE_INFINITY, onFired);
		vi.advanceTimersByTime(1_000_000);
		expect(onFired).not.toHaveBeenCalled();
	});

	it("clearKind cancels a pending timeout of that kind", () => {
		const scheduler = new TaskTimeoutScheduler();
		const onFired = vi.fn();
		scheduler.schedule("t1", "stream", 1000, onFired);
		scheduler.clearKind("t1", "stream");
		vi.advanceTimersByTime(2000);
		expect(onFired).not.toHaveBeenCalled();
	});

	it("clearAll cancels every kind for the task", () => {
		const scheduler = new TaskTimeoutScheduler();
		const onFired = vi.fn();
		scheduler.schedule("t1", "stream", 1000, onFired);
		scheduler.schedule("t1", "conversation", 1500, onFired);
		scheduler.clearAll("t1");
		vi.advanceTimersByTime(2000);
		expect(onFired).not.toHaveBeenCalled();
	});

	it("re-scheduling the same kind replaces the prior timer", () => {
		const scheduler = new TaskTimeoutScheduler();
		const onFired = vi.fn();
		scheduler.schedule("t1", "stream", 1000, onFired);
		scheduler.schedule("t1", "stream", 3000, onFired);
		vi.advanceTimersByTime(1000);
		expect(onFired).not.toHaveBeenCalled(); // the original 1000ms timer was cancelled
		vi.advanceTimersByTime(2000);
		expect(onFired).toHaveBeenCalledTimes(1);
		expect(onFired).toHaveBeenCalledWith(3000);
	});

	it("tracks the task ids with pending timers", () => {
		const scheduler = new TaskTimeoutScheduler();
		scheduler.schedule("t1", "stream", 1000, vi.fn());
		scheduler.schedule("t2", "tool", 1000, vi.fn());
		expect([...scheduler.taskIds()].sort()).toEqual(["t1", "t2"]);
	});
});
