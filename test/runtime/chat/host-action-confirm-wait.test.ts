import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitHostActionConfirmation } from "../../../src/chat/host-action-confirm-wait";
import {
	createHostActionConfirmQueue,
	type HostActionConfirmRequest,
} from "../../../src/core/host-action-confirm-queue";

const REQUEST: HostActionConfirmRequest = {
	attemptId: "a1",
	sessionId: "s1",
	action: "host_command",
	target: "npm test",
};

describe("awaitHostActionConfirmation (F2.2b/F2.12b)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("resolves TRUE on an explicit approval before the deadline", async () => {
		const queue = createHostActionConfirmQueue();
		const pending = awaitHostActionConfirmation(REQUEST, { queue, now: () => Date.now(), timeoutMs: 1000 });
		queue.resolve({ ...REQUEST, approve: true }, Date.now());
		await expect(pending).resolves.toBe(true);
	});

	it("resolves FALSE on an explicit denial", async () => {
		const queue = createHostActionConfirmQueue();
		const pending = awaitHostActionConfirmation(REQUEST, { queue, now: () => Date.now(), timeoutMs: 1000 });
		queue.resolve({ ...REQUEST, approve: false }, Date.now());
		await expect(pending).resolves.toBe(false);
	});

	it("FAILS CLOSED (false) when no answer arrives before the timeout", async () => {
		const queue = createHostActionConfirmQueue();
		const pending = awaitHostActionConfirmation(REQUEST, { queue, now: () => Date.now(), timeoutMs: 1000 });
		await vi.advanceTimersByTimeAsync(1100);
		await expect(pending).resolves.toBe(false);
		// The entry was consumed on timeout, so a late approval finds nothing to apply to.
		expect(queue.resolve({ ...REQUEST, approve: true }, Date.now())).toBe("unknown");
	});

	it("a mismatched decision never approves — the wait still times out to false", async () => {
		const queue = createHostActionConfirmQueue();
		const pending = awaitHostActionConfirmation(REQUEST, { queue, now: () => Date.now(), timeoutMs: 1000 });
		expect(queue.resolve({ ...REQUEST, target: "rm -rf /", approve: true }, Date.now())).toBe("mismatch");
		await vi.advanceTimersByTimeAsync(1100);
		await expect(pending).resolves.toBe(false);
	});
});
