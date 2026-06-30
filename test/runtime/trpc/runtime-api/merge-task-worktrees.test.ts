import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTrpcWorkspaceScope } from "../../../../src/trpc/app-router";

const { mergeMock, recordObservationMock } = vi.hoisted(() => ({
	mergeMock: vi.fn(),
	recordObservationMock: vi.fn(),
}));

vi.mock("../../../../src/state/workspace-state", () => ({
	loadWorkspaceState: vi.fn(async () => ({ board: { columns: [], dependencies: [] } })),
}));
vi.mock("../../../../src/workspace/task-worktree-auto-merge", () => ({
	mergeTaskWorktreesInDependencyOrder: mergeMock,
}));
vi.mock("../../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: recordObservationMock,
}));

import { handleMergeTaskWorktrees } from "../../../../src/trpc/runtime-api/merge-task-worktrees";

const scope = { workspacePath: "/w" } as RuntimeTrpcWorkspaceScope;

beforeEach(() => {
	mergeMock.mockReset();
	recordObservationMock.mockReset();
	mergeMock.mockResolvedValue({
		ok: true,
		steps: [],
		mergedTaskIds: ["t1"],
		skippedTaskIds: [],
		conflict: null,
		blocked: null,
	});
});

describe("handleMergeTaskWorktrees", () => {
	it("defaults the column to 'review' and shapes the response", async () => {
		const result = await handleMergeTaskWorktrees(scope, {} as never);
		expect(result.column).toBe("review");
		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["t1"]);
		expect(mergeMock).toHaveBeenCalledWith(expect.objectContaining({ columns: ["review"], taskIds: undefined }));
	});

	it("passes the given column and wraps a single taskId", async () => {
		await handleMergeTaskWorktrees(scope, { column: "completed", taskId: "t9" } as never);
		expect(mergeMock).toHaveBeenCalledWith(expect.objectContaining({ columns: ["completed"], taskIds: ["t9"] }));
	});
});
