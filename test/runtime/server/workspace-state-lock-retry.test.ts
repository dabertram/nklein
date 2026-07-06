import { describe, expect, it, vi } from "vitest";
import {
	retryWorkspaceStateLock,
	WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS,
} from "../../../src/server/workspace-state-lock-retry";

const lockError = () => new Error("Lock file is already being held by pid 4242");
const noopSleep = () => Promise.resolve();

describe("retryWorkspaceStateLock (§5.U extraction)", () => {
	it("returns immediately when the operation succeeds first try (no sleeps)", async () => {
		const sleep = vi.fn(noopSleep);
		const operation = vi.fn(() => Promise.resolve("ok"));
		await expect(retryWorkspaceStateLock(operation, { sleep })).resolves.toBe("ok");
		expect(operation).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("retries a lock error along the backoff schedule, then succeeds", async () => {
		const sleep = vi.fn(noopSleep);
		let calls = 0;
		const operation = vi.fn(() => {
			calls += 1;
			if (calls <= 2) {
				return Promise.reject(lockError());
			}
			return Promise.resolve("recovered");
		});
		await expect(retryWorkspaceStateLock(operation, { sleep })).resolves.toBe("recovered");
		expect(operation).toHaveBeenCalledTimes(3);
		// Slept once per retry with the scheduled delays.
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenNthCalledWith(1, WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS[0]);
		expect(sleep).toHaveBeenNthCalledWith(2, WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS[1]);
	});

	it("propagates a non-lock error immediately without retrying", async () => {
		const sleep = vi.fn(noopSleep);
		const operation = vi.fn(() => Promise.reject(new Error("disk full")));
		await expect(retryWorkspaceStateLock(operation, { sleep })).rejects.toThrow("disk full");
		expect(operation).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("rethrows the last lock error after exhausting the schedule", async () => {
		const sleep = vi.fn(noopSleep);
		const operation = vi.fn(() => Promise.reject(lockError()));
		await expect(retryWorkspaceStateLock(operation, { delaysMs: [1, 2], sleep })).rejects.toThrow(
			/Lock file is already being held/,
		);
		// initial attempt + one per delay = 3 attempts, 2 sleeps.
		expect(operation).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});
});
