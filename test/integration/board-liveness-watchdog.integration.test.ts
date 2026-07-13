import { describe, expect, it, vi } from "vitest";
import {
	type BoardLivenessWatchdogTickEvent,
	startBoardLivenessWatchdog,
} from "../../src/server/board-liveness-watchdog";

describe("board-liveness watchdog integration", () => {
	it("records tick entry and recovers on the next interval after an injected snapshot hang", async () => {
		const events: BoardLivenessWatchdogTickEvent[] = [];
		const handled: string[] = [];
		let loadCalls = 0;
		const neverSettles = new Promise<never>(() => undefined);
		const watchdog = startBoardLivenessWatchdog({
			intervalMs: 20,
			snapshotTimeoutMs: 5,
			loadSnapshot: async () => {
				loadCalls += 1;
				if (loadCalls === 1) {
					return await neverSettles;
				}
				return { status: "ok", value: "recovered" } as const;
			},
			handleSnapshot: async (snapshot) => {
				handled.push(snapshot);
			},
			onTickEvent: (event) => events.push(event),
		});

		try {
			await vi.waitFor(() => expect(handled).toEqual(["recovered"]), { timeout: 500, interval: 5 });
		} finally {
			watchdog.dispose();
		}

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ tick: 1, stage: "entered" }),
				expect.objectContaining({ tick: 1, stage: "snapshot_timeout" }),
				expect.objectContaining({ tick: 2, stage: "entered" }),
				expect.objectContaining({ tick: 2, stage: "completed" }),
			]),
		);
	});

	it("reports a workspace scope mismatch separately from a snapshot hang", async () => {
		const events: BoardLivenessWatchdogTickEvent[] = [];
		const handleSnapshot = vi.fn(async () => undefined);
		const watchdog = startBoardLivenessWatchdog({
			intervalMs: 1_000,
			snapshotTimeoutMs: 50,
			loadSnapshot: async () => ({ status: "scope_mismatch", reason: "workspace id points elsewhere" }),
			handleSnapshot,
			onTickEvent: (event) => events.push(event),
		});

		try {
			watchdog.runNow();
			await vi.waitFor(() =>
				expect(events).toContainEqual(expect.objectContaining({ tick: 1, stage: "scope_mismatch" })),
			);
		} finally {
			watchdog.dispose();
		}

		expect(handleSnapshot).not.toHaveBeenCalled();
	});

	it("does not start a rescue after disposal while a snapshot was in flight", async () => {
		let resolveSnapshot!: (snapshot: { status: "ok"; value: string }) => void;
		const snapshot = new Promise<{ status: "ok"; value: string }>((resolve) => {
			resolveSnapshot = resolve;
		});
		const handleSnapshot = vi.fn(async () => undefined);
		const watchdog = startBoardLivenessWatchdog({
			intervalMs: 1_000,
			snapshotTimeoutMs: 500,
			loadSnapshot: async () => await snapshot,
			handleSnapshot,
		});

		watchdog.runNow();
		watchdog.dispose();
		resolveSnapshot({ status: "ok", value: "late" });
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(handleSnapshot).not.toHaveBeenCalled();
	});
});
