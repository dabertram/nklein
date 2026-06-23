import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeGitSyncSummary } from "../../../src/core/api-contract";

const gitSyncMocks = vi.hoisted(() => ({
	getGitSyncSummary: vi.fn(),
	probeGitWorkspaceState: vi.fn(),
}));

vi.mock("../../../src/workspace/git-sync.js", () => ({
	getGitSyncSummary: gitSyncMocks.getGitSyncSummary,
	probeGitWorkspaceState: gitSyncMocks.probeGitWorkspaceState,
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

describe("createWorkspaceMetadataMonitor", () => {
	beforeEach(() => {
		gitSyncMocks.probeGitWorkspaceState.mockReset();
		gitSyncMocks.getGitSyncSummary.mockReset();
		gitSyncMocks.probeGitWorkspaceState.mockResolvedValue({
			currentBranch: "main",
			headCommit: "home-head",
			stateToken: "home-token",
		});
		gitSyncMocks.getGitSyncSummary.mockResolvedValue(EMPTY_GIT_SUMMARY);
	});

	it("polls the project home git summary and never tracks per-task host workspaces (worktrees retired)", async () => {
		const monitor = createWorkspaceMetadataMonitor({
			onMetadataUpdated: vi.fn(),
		});

		try {
			const metadata = await monitor.connectWorkspace({
				workspaceId: "workspace-1",
				workspacePath: "/repo",
			});

			expect(metadata.homeGitSummary).toEqual(EMPTY_GIT_SUMMARY);
			// Native NKlein tasks run in Docker sandboxes and surface their delta via the result branch, so there is
			// no per-task host checkout to poll — taskWorkspaces is always empty (§5.A).
			expect(metadata.taskWorkspaces).toEqual([]);
			expect(gitSyncMocks.getGitSyncSummary).toHaveBeenCalledWith("/repo", expect.anything());
		} finally {
			monitor.close();
		}
	});

	it("re-emits metadata only when the home git state token changes", async () => {
		const onMetadataUpdated = vi.fn();
		const monitor = createWorkspaceMetadataMonitor({ onMetadataUpdated });

		try {
			await monitor.connectWorkspace({ workspaceId: "workspace-1", workspacePath: "/repo" });
			onMetadataUpdated.mockClear();

			// Same state token → cached, no re-emit.
			await monitor.updateWorkspaceState({ workspaceId: "workspace-1", workspacePath: "/repo" });
			expect(onMetadataUpdated).not.toHaveBeenCalled();

			// New state token → summary refresh → re-emit.
			gitSyncMocks.probeGitWorkspaceState.mockResolvedValue({
				currentBranch: "main",
				headCommit: "home-head-2",
				stateToken: "home-token-2",
			});
			gitSyncMocks.getGitSyncSummary.mockResolvedValue({ ...EMPTY_GIT_SUMMARY, changedFiles: 3 });
			await monitor.updateWorkspaceState({ workspaceId: "workspace-1", workspacePath: "/repo" });
			expect(onMetadataUpdated).toHaveBeenCalledTimes(1);
		} finally {
			monitor.close();
		}
	});
});
