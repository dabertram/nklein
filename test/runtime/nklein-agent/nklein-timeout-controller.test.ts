import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";
import {
	createTimeoutController,
	type NKleinTaskTimeoutSettings,
	type TimeoutControllerDeps,
} from "../../../src/nklein-agent/nklein-timeout-controller";

const settings = (over: Partial<NKleinTaskTimeoutSettings> = {}): NKleinTaskTimeoutSettings => ({
	streamTimeoutMs: 100,
	toolTimeoutMs: 100,
	conversationTimeoutMs: 100,
	streamTimeoutSource: null,
	toolTimeoutSource: null,
	conversationTimeoutSource: null,
	...over,
});

const entry = (state = "running"): NKleinTaskSessionEntry =>
	({ summary: { taskId: "t1", state, latestHookActivity: null } }) as unknown as NKleinTaskSessionEntry;

function deps(over: Partial<TimeoutControllerDeps> = {}): TimeoutControllerDeps {
	return {
		isToolActive: vi.fn(() => false),
		getTaskEntry: vi.fn(() => entry("running")),
		clearTaskRunTeardown: vi.fn(),
		abortTaskSession: vi.fn(() => Promise.resolve()),
		recordTimeout: vi.fn(),
		canRestartTaskSession: vi.fn(() => true),
		recordObservation: vi.fn(),
		emitTaskFailure: vi.fn(),
		...over,
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("scheduleStreamTimeout gating (§5.U extraction)", () => {
	it("does not schedule when there are no settings or a tool is active", async () => {
		const d1 = deps();
		const c1 = createTimeoutController(d1);
		c1.scheduleStreamTimeout("t1"); // no settings
		await vi.advanceTimersByTimeAsync(1000);
		expect(d1.abortTaskSession).not.toHaveBeenCalled();

		const d2 = deps({ isToolActive: () => true });
		const c2 = createTimeoutController(d2);
		c2.setSettings("t1", settings());
		c2.scheduleStreamTimeout("t1"); // tool active
		await vi.advanceTimersByTimeAsync(1000);
		expect(d2.abortTaskSession).not.toHaveBeenCalled();
	});
});

describe("timeout fire path (§5.U extraction)", () => {
	it("aborts + records + emits a failure when a running task's stream timeout fires", async () => {
		const d = deps();
		const c = createTimeoutController(d);
		c.setSettings("t1", settings({ streamTimeoutMs: 100 }));
		c.scheduleStreamTimeout("t1");

		await vi.advanceTimersByTimeAsync(150);
		expect(d.clearTaskRunTeardown).toHaveBeenCalledWith("t1");
		expect(d.abortTaskSession).toHaveBeenCalledWith("t1");
		expect(d.recordTimeout).toHaveBeenCalled();
		expect(d.recordObservation).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ category: "stream_inactivity_timeout" }) }),
		);
		expect(d.emitTaskFailure).toHaveBeenCalled();
	});

	it("no-ops on fire when the task is no longer running (early return before abort/fail)", async () => {
		const d = deps({ getTaskEntry: () => entry("failed") });
		const c = createTimeoutController(d);
		c.setSettings("t1", settings({ streamTimeoutMs: 100 }));
		c.scheduleStreamTimeout("t1");

		await vi.advanceTimersByTimeAsync(150);
		expect(d.abortTaskSession).not.toHaveBeenCalled();
		expect(d.emitTaskFailure).not.toHaveBeenCalled();
	});
});

describe("settings lifecycle (§5.U extraction)", () => {
	it("deleteSettings stops a subsequent schedule from firing", async () => {
		const d = deps();
		const c = createTimeoutController(d);
		c.setSettings("t1", settings());
		c.deleteSettings("t1");
		c.scheduleConversationTimeout("t1"); // no settings now → no schedule
		await vi.advanceTimersByTimeAsync(1000);
		expect(d.abortTaskSession).not.toHaveBeenCalled();
	});
});
