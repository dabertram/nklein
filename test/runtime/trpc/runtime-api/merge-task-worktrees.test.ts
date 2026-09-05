import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTrpcWorkspaceScope } from "../../../../src/trpc/app-router";

const { mergeMock, recordObservationMock } = vi.hoisted(() => ({
	mergeMock: vi.fn(),
	recordObservationMock: vi.fn(),
}));

vi.mock("../../../../src/state/workspace-state", () => ({
	loadWorkspaceState: vi.fn(async () => ({ board: { columns: [], dependencies: [] } })),
	// Autonomy 2026-09-01: the handler now advances merged cards to the completed lane itself.
	mutateWorkspaceState: vi.fn(async () => ({ board: { columns: [], dependencies: [] }, value: null })),
}));
vi.mock("../../../../src/workspace/task-worktree-auto-merge", () => ({
	mergeTaskWorktreesInDependencyOrder: mergeMock,
	NO_RESULT_BRANCH_REASON: "no task result branch to merge.",
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

	it("live 2026-09-05: an APPROVED card with no result branch (a genuine no-op) is completed by the operator merge", async () => {
		mergeMock.mockResolvedValue({
			ok: true,
			steps: [{ type: "skipped", taskId: "noop", headCommit: "", reason: "no task result branch to merge." }],
			mergedTaskIds: [],
			skippedTaskIds: ["noop"],
			conflict: null,
			blocked: null,
		});
		const { mutateWorkspaceState } = await import("../../../../src/state/workspace-state");
		vi.mocked(mutateWorkspaceState).mockClear();
		await handleMergeTaskWorktrees(scope, {} as never);
		const mutate = vi.mocked(mutateWorkspaceState).mock.calls[0]?.[1] as unknown as
			| ((state: { board: unknown }) => { board: { columns: { id: string; cards: { id: string }[] }[] } })
			| undefined;
		expect(mutate).toBeDefined();
		const card = (status: string) => ({ id: "noop", title: "n", prompt: "p", review: { status } });
		const board = {
			columns: [
				{ id: "review", title: "Review", cards: [card("approved"), { ...card("changes_requested"), id: "other" }] },
				{ id: "completed", title: "Completed", cards: [] },
			],
			dependencies: [],
		};
		const next = mutate?.({ board });
		expect(next?.board.columns.find((column) => column.id === "completed")?.cards.map((c) => c.id)).toEqual(["noop"]);
		expect(next?.board.columns.find((column) => column.id === "review")?.cards.map((c) => c.id)).toEqual(["other"]);
	});
});
