import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostActionConfirmQueue, type HostActionConfirmRequest } from "../core/host-action-confirm-queue";
import { awaitHostActionConfirmation } from "./host-action-confirm-wait";

const REQUEST: HostActionConfirmRequest = {
	attemptId: "sess-1:call-9",
	sessionId: "sess-1",
	action: "host_command",
	target: "rm -rf build",
};

describe("awaitHostActionConfirmation — the fail-closed operator-confirm bridge (F2.2b/F2.12b)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves TRUE only on an explicit approval bound to the exact attempt", async () => {
		const queue = createHostActionConfirmQueue();
		const promise = awaitHostActionConfirmation(REQUEST, { queue, timeoutMs: 60_000 });
		expect(queue.listPending(Date.now())).toHaveLength(1);
		expect(queue.resolve({ ...REQUEST, approve: true }, Date.now())).toBe("applied");
		await expect(promise).resolves.toBe(true);
	});

	it("resolves FALSE on an explicit denial", async () => {
		const queue = createHostActionConfirmQueue();
		const promise = awaitHostActionConfirmation(REQUEST, { queue, timeoutMs: 60_000 });
		expect(queue.resolve({ ...REQUEST, approve: false }, Date.now())).toBe("applied");
		await expect(promise).resolves.toBe(false);
	});

	it("fails closed (FALSE) on timeout when nothing resolves, consuming the entry", async () => {
		const queue = createHostActionConfirmQueue();
		const promise = awaitHostActionConfirmation(REQUEST, { queue, timeoutMs: 60_000 });
		await vi.advanceTimersByTimeAsync(60_051);
		await expect(promise).resolves.toBe(false);
		// The timer consumed the (now-expired) entry so a late approval can never apply to this attempt.
		expect(queue.status(REQUEST.attemptId, Date.now())).toBe("unknown");
	});

	it("fails closed (FALSE) when a mismatched decision leaves the attempt parked until timeout", async () => {
		const queue = createHostActionConfirmQueue();
		const promise = awaitHostActionConfirmation(REQUEST, { queue, timeoutMs: 60_000 });
		// Right attempt id, wrong target — a stale/cross-attempt approval resolves NOTHING.
		expect(queue.resolve({ ...REQUEST, target: "rm -rf /etc", approve: true }, Date.now())).toBe("mismatch");
		await vi.advanceTimersByTimeAsync(60_051);
		await expect(promise).resolves.toBe(false);
	});
});
