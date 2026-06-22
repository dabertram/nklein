import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTempDir } from "../utilities/temp-dir";

const lockfileMocks = vi.hoisted(() => ({
	lock: vi.fn(),
	release: vi.fn(async () => {}),
}));

vi.mock("proper-lockfile", () => ({
	lock: lockfileMocks.lock,
}));

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

import { LockedFileSystem } from "../../src/fs/locked-file-system";

describe("LockedFileSystem", () => {
	beforeEach(() => {
		lockfileMocks.release.mockReset();
		lockfileMocks.release.mockResolvedValue(undefined);
		lockfileMocks.lock.mockReset();
		lockfileMocks.lock.mockResolvedValue(lockfileMocks.release);
		selfObservationMocks.recordSelfObservation.mockReset();
	});

	it("installs a non-throwing default onCompromised handler that records the anomaly", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();

			await lockedFileSystem.withLock({ path: filePath, type: "file" }, async () => {});

			expect(lockfileMocks.lock).toHaveBeenCalledTimes(1);
			const options = lockfileMocks.lock.mock.calls[0]?.[1] as Record<string, unknown>;
			expect(typeof options.onCompromised).toBe("function");

			// The library invokes onCompromised from a timer; it must never throw,
			// or the uncaught exception takes down the whole runtime process.
			const onCompromised = options.onCompromised as (error: Error) => void;
			expect(() => onCompromised(new Error("ENOENT: lockfile removed"))).not.toThrow();
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({ signal: "runtime_error", severity: "warning" }),
			);

			expect(lockfileMocks.release).toHaveBeenCalledTimes(1);
		} finally {
			tempDir.cleanup();
		}
	});

	it("forwards onCompromised when a handler is provided", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();
			const onCompromised = vi.fn();

			await lockedFileSystem.withLock({ path: filePath, type: "file", onCompromised }, async () => {});

			const options = lockfileMocks.lock.mock.calls[0]?.[1] as Record<string, unknown>;
			expect(options.onCompromised).toBe(onCompromised);
		} finally {
			tempDir.cleanup();
		}
	});

	it("does not let a release rejection escape or mask the operation result", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const filePath = join(tempDir.path, "state.json");
			const lockedFileSystem = new LockedFileSystem();
			// A compromised lock makes proper-lockfile reject the release with ERELEASED.
			lockfileMocks.release.mockRejectedValueOnce(
				Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }),
			);

			const result = await lockedFileSystem.withLock({ path: filePath, type: "file" }, async () => "ok");

			expect(result).toBe("ok");
			expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
				expect.objectContaining({ signal: "runtime_error", severity: "warning" }),
			);
		} finally {
			tempDir.cleanup();
		}
	});

	it("releases every lock even when an earlier release rejects", async () => {
		const tempDir = createTempDir("kanban-locked-fs-");
		try {
			const lockedFileSystem = new LockedFileSystem();
			const releaseA = vi.fn(async () => {});
			const releaseB = vi.fn().mockRejectedValueOnce(new Error("boom"));
			// Acquisition order is sorted by lockfile path; release happens in reverse.
			lockfileMocks.lock.mockResolvedValueOnce(releaseA).mockResolvedValueOnce(releaseB);

			await lockedFileSystem.withLocks(
				[
					{ path: join(tempDir.path, "a.json"), type: "file" },
					{ path: join(tempDir.path, "b.json"), type: "file" },
				],
				async () => {},
			);

			expect(releaseA).toHaveBeenCalledTimes(1);
			expect(releaseB).toHaveBeenCalledTimes(1);
		} finally {
			tempDir.cleanup();
		}
	});
});
