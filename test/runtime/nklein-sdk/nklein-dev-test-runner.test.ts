import { describe, expect, it } from "vitest";
import { summarizeDevTestCleanup } from "../../../src/core/dev-test-cleanup";
import type { DevTestBoardLike } from "../../../src/core/dev-test-outcome";
import {
	createDevTestStateReader,
	type DevTestCleanupCandidate,
	discoverDevTestCleanupEntries,
} from "../../../src/nklein-sdk/nklein-dev-test-runner";

function board(columns: Record<string, number>): DevTestBoardLike {
	return {
		columns: Object.entries(columns).map(([id, count]) => ({
			id,
			cards: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}` })),
		})),
	};
}

describe("createDevTestStateReader", () => {
	it("returns live state as reachable", async () => {
		const read = createDevTestStateReader({
			readLiveBoard: async () => board({ completed: 2 }),
			readPersistedBoard: async () => board({ backlog: 9 }),
		});
		const state = await read();
		expect(state.runtimeReachable).toBe(true);
		expect(state.board?.columns.find((column) => column.id === "completed")?.cards).toHaveLength(2);
	});

	it("includes the live failed-card count when the reader supplies it", async () => {
		const read = createDevTestStateReader({
			readLiveBoard: async () => board({ completed: 1 }),
			readPersistedBoard: async () => board({}),
			readFailedCardCount: async () => 3,
		});
		const state = await read();
		expect(state).toMatchObject({ runtimeReachable: true, failedCardCount: 3 });
	});

	it("falls back to the persisted board (unreachable) when the live read throws", async () => {
		const read = createDevTestStateReader({
			readLiveBoard: async () => {
				throw new Error("ECONNREFUSED");
			},
			readPersistedBoard: async () => board({ review: 4 }),
		});
		const state = await read();
		expect(state.runtimeReachable).toBe(false);
		expect(state.board?.columns.find((column) => column.id === "review")?.cards).toHaveLength(4);
	});

	it("returns a null board when both the live and persisted reads fail", async () => {
		const read = createDevTestStateReader({
			readLiveBoard: async () => {
				throw new Error("ECONNREFUSED");
			},
			readPersistedBoard: async () => {
				throw new Error("no persisted state");
			},
		});
		expect(await read()).toEqual({ board: null, runtimeReachable: false });
	});

	it("does not let a failed-card-count read break a reachable live read", async () => {
		const read = createDevTestStateReader({
			readLiveBoard: async () => board({ completed: 1 }),
			readPersistedBoard: async () => board({}),
			readFailedCardCount: async () => {
				throw new Error("summaries unavailable");
			},
		});
		const state = await read();
		expect(state.runtimeReachable).toBe(true);
		expect(state.failedCardCount).toBeUndefined();
	});
});

describe("discoverDevTestCleanupEntries", () => {
	const workspaces: DevTestCleanupCandidate[] = [
		{ path: "/runs/active", kind: "dev_test_workspace", sizeBytes: 100 },
		{ path: "/runs/old", kind: "dev_test_workspace", sizeBytes: 200 },
	];
	const volumes: DevTestCleanupCandidate[] = [{ path: "nklein-task-abc", kind: "sandbox_volume", sizeBytes: 50 }];

	it("retains the active workspace and marks everything else reclaimable", async () => {
		const entries = await discoverDevTestCleanupEntries({
			listDevTestWorkspaces: async () => workspaces,
			listSandboxVolumes: async () => volumes,
			activeWorkspacePath: "/runs/active/",
		});
		const report = summarizeDevTestCleanup(entries);
		expect(report.retained.map((entry) => entry.path)).toEqual(["/runs/active"]);
		expect(report.totalReclaimableBytes).toBe(250);
		expect(report.totalRetainedBytes).toBe(100);
	});

	it("never marks a sandbox volume as the active run even if paths coincide", async () => {
		const entries = await discoverDevTestCleanupEntries({
			listDevTestWorkspaces: async () => [],
			listSandboxVolumes: async () => [{ path: "/runs/active", kind: "sandbox_volume", sizeBytes: 10 }],
			activeWorkspacePath: "/runs/active",
		});
		expect(entries[0]?.isActive).toBe(false);
	});

	it("treats all artifacts as reclaimable when there is no active run", async () => {
		const entries = await discoverDevTestCleanupEntries({
			listDevTestWorkspaces: async () => workspaces,
			listSandboxVolumes: async () => volumes,
			activeWorkspacePath: null,
		});
		const report = summarizeDevTestCleanup(entries);
		expect(report.retained).toHaveLength(0);
		expect(report.totalReclaimableBytes).toBe(350);
	});
});
