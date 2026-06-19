import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeBoardData, RuntimeGitSyncSummary } from "../../../src/core/api-contract";

const gitSyncMocks = vi.hoisted(() => ({
	getGitSyncSummary: vi.fn(),
	probeGitWorkspaceState: vi.fn(),
}));

const taskWorktreeMocks = vi.hoisted(() => ({
	getTaskWorkspacePathInfo: vi.fn(),
}));

vi.mock("../../../src/workspace/git-sync.js", () => ({
	getGitSyncSummary: gitSyncMocks.getGitSyncSummary,
	probeGitWorkspaceState: gitSyncMocks.probeGitWorkspaceState,
}));

vi.mock("../../../src/workspace/task-worktree.js", () => ({
	getTaskWorkspacePathInfo: taskWorktreeMocks.getTaskWorkspacePathInfo,
}));

import { createWorkspaceMetadataMonitor } from "../../../src/server/workspace-metadata-monitor";

const EMPTY_GIT_SUMMARY: RuntimeGitSyncSummary = {
	currentBranch: "main",
	upstreamBranch: null,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	aheadCount: 0,
	behindCount: 0,
};

function createBoard(): RuntimeBoardData {
	const now = 1_700_000_000_000;
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "planning",
				title: "Planning",
				cards: [
					{
						id: "default-cline-task",
						title: "Default Cline task",
						prompt: "Default Cline task",
						startInPlanMode: true,
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{
				id: "in_progress",
				title: "In Progress",
				cards: [
					{
						id: "explicit-cline-task",
						title: "Explicit Cline task",
						prompt: "Explicit Cline task",
						startInPlanMode: false,
						agentId: "cline",
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
					{
						id: "legacy-codex-task",
						title: "Legacy Codex task",
						prompt: "Legacy Codex task",
						startInPlanMode: false,
						agentId: "codex",
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

describe("createWorkspaceMetadataMonitor", () => {
	beforeEach(() => {
		gitSyncMocks.probeGitWorkspaceState.mockReset();
		gitSyncMocks.getGitSyncSummary.mockReset();
		taskWorktreeMocks.getTaskWorkspacePathInfo.mockReset();
		gitSyncMocks.probeGitWorkspaceState.mockResolvedValue({
			currentBranch: "main",
			headCommit: "home-head",
			stateToken: "home-token",
		});
		gitSyncMocks.getGitSyncSummary.mockResolvedValue(EMPTY_GIT_SUMMARY);
		taskWorktreeMocks.getTaskWorkspacePathInfo.mockResolvedValue({
			taskId: "legacy-codex-task",
			path: "/repo/.cline/worktrees/legacy-codex-task/repo",
			exists: false,
			baseRef: "main",
		});
	});

	it("tracks host task workspace metadata only for explicit legacy agents", async () => {
		const monitor = createWorkspaceMetadataMonitor({
			onMetadataUpdated: vi.fn(),
		});

		try {
			const metadata = await monitor.connectWorkspace({
				workspaceId: "workspace-1",
				workspacePath: "/repo",
				board: createBoard(),
			});

			expect(metadata.taskWorkspaces.map((task) => task.taskId)).toEqual(["legacy-codex-task"]);
			expect(taskWorktreeMocks.getTaskWorkspacePathInfo).toHaveBeenCalledTimes(1);
			expect(taskWorktreeMocks.getTaskWorkspacePathInfo).toHaveBeenCalledWith({
				cwd: "/repo",
				taskId: "legacy-codex-task",
				baseRef: "main",
			});
		} finally {
			monitor.close();
		}
	});
});
