import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskTimeoutHandles } from "../../../src/nklein-agent/nklein-task-timeout-handles";

describe("TaskTimeoutHandles", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("stores a timer and lists the task id", () => {
		const handles = new TaskTimeoutHandles();
		handles.set(
			"t1",
			"stream",
			setTimeout(() => {}, 1_000),
		);
		expect([...handles.taskIds()]).toEqual(["t1"]);
	});

	it("clearKind cancels that kind's timer so its callback never fires", () => {
		const handles = new TaskTimeoutHandles();
		const fired = vi.fn();
		handles.set("t1", "stream", setTimeout(fired, 1_000));
		handles.clearKind("t1", "stream");
		vi.advanceTimersByTime(5_000);
		expect(fired).not.toHaveBeenCalled();
	});

	it("clearKind of one kind leaves other kinds armed", () => {
		const handles = new TaskTimeoutHandles();
		const streamFired = vi.fn();
		const toolFired = vi.fn();
		handles.set("t1", "stream", setTimeout(streamFired, 1_000));
		handles.set("t1", "tool", setTimeout(toolFired, 1_000));
		handles.clearKind("t1", "stream");
		vi.advanceTimersByTime(5_000);
		expect(streamFired).not.toHaveBeenCalled();
		expect(toolFired).toHaveBeenCalledTimes(1);
	});

	it("drops the per-task entry once its last kind is cleared", () => {
		const handles = new TaskTimeoutHandles();
		handles.set(
			"t1",
			"stream",
			setTimeout(() => {}, 1_000),
		);
		handles.clearKind("t1", "stream");
		expect([...handles.taskIds()]).toEqual([]);
	});

	it("keeps the per-task entry while other kinds remain", () => {
		const handles = new TaskTimeoutHandles();
		handles.set(
			"t1",
			"stream",
			setTimeout(() => {}, 1_000),
		);
		handles.set(
			"t1",
			"tool",
			setTimeout(() => {}, 1_000),
		);
		handles.clearKind("t1", "stream");
		expect([...handles.taskIds()]).toEqual(["t1"]);
	});

	it("clearAll cancels every kind and forgets the task", () => {
		const handles = new TaskTimeoutHandles();
		const streamFired = vi.fn();
		const toolFired = vi.fn();
		handles.set("t1", "stream", setTimeout(streamFired, 1_000));
		handles.set("t1", "tool", setTimeout(toolFired, 1_000));
		handles.clearAll("t1");
		vi.advanceTimersByTime(5_000);
		expect(streamFired).not.toHaveBeenCalled();
		expect(toolFired).not.toHaveBeenCalled();
		expect([...handles.taskIds()]).toEqual([]);
	});

	it("set only tracks the latest handle for a kind and does NOT auto-clear the previous one", () => {
		const handles = new TaskTimeoutHandles();
		const first = vi.fn();
		const second = vi.fn();
		handles.set("t1", "stream", setTimeout(first, 1_000));
		handles.set("t1", "stream", setTimeout(second, 1_000));
		handles.clearKind("t1", "stream");
		vi.advanceTimersByTime(5_000);
		// clearKind cancels the tracked (latest) handle...
		expect(second).not.toHaveBeenCalled();
		// ...but an untracked earlier timer still fires. This mirrors the prior inline behavior:
		// scheduleTaskTimeout always clearKind'd before set, so set never silently dropped a live timer.
		expect(first).toHaveBeenCalledTimes(1);
	});

	it("keeps per-task handles independent", () => {
		const handles = new TaskTimeoutHandles();
		handles.set(
			"t1",
			"stream",
			setTimeout(() => {}, 1_000),
		);
		handles.set(
			"t2",
			"conversation",
			setTimeout(() => {}, 1_000),
		);
		handles.clearAll("t1");
		expect([...handles.taskIds()]).toEqual(["t2"]);
	});
});
