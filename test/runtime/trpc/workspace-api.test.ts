import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	RuntimeBoardData,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesResponse,
} from "../../../src/core/api-contract";
import { loadWorkspaceContext, loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";
import { createGitTestEnv } from "../../utilities/git-env";

const taskArtifactCleanupMocks = vi.hoisted(() => ({
	deleteTaskArtifacts: vi.fn(),
}));

const workspaceChangesMocks = vi.hoisted(() => ({
	createEmptyWorkspaceChangesResponse: vi.fn(),
	getWorkspaceChanges: vi.fn(),
	getWorkspaceChangesBetweenRefs: vi.fn(),
	getWorkspaceChangesFromRef: vi.fn(),
}));

const taskResultBranchMocks = vi.hoisted(() => ({
	resolveTaskResultBranchCommit: vi.fn(),
}));

vi.mock("../../../src/workspace/task-artifact-cleanup.js", () => ({
	deleteTaskArtifacts: taskArtifactCleanupMocks.deleteTaskArtifacts,
}));

vi.mock("../../../src/workspace/get-workspace-changes.js", () => ({
	createEmptyWorkspaceChangesResponse: workspaceChangesMocks.createEmptyWorkspaceChangesResponse,
	getWorkspaceChanges: workspaceChangesMocks.getWorkspaceChanges,
	getWorkspaceChangesBetweenRefs: workspaceChangesMocks.getWorkspaceChangesBetweenRefs,
	getWorkspaceChangesFromRef: workspaceChangesMocks.getWorkspaceChangesFromRef,
}));

vi.mock("../../../src/workspace/task-result-branches.js", () => ({
	resolveTaskResultBranchCommit: taskResultBranchMocks.resolveTaskResultBranchCommit,
}));

import { createWorkspaceApi } from "../../../src/trpc/workspace-api";

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const tempHome = join(tmpdir(), `kanban-workspace-api-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(tempHome, { recursive: true });
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		rmSync(tempHome, { recursive: true, force: true });
	}
}

function createBoard(title: string): RuntimeBoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						title,
						prompt: "Do the work.",
						startInPlanMode: true,
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "nklein",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createChangesResponse(): RuntimeWorkspaceChangesResponse {
	return {
		repoRoot: "/tmp/worktree",
		generatedAt: Date.now(),
		files: [],
	};
}

describe("createWorkspaceApi loadChanges", () => {
	beforeEach(() => {
		taskArtifactCleanupMocks.deleteTaskArtifacts.mockReset();
		workspaceChangesMocks.createEmptyWorkspaceChangesResponse.mockReset();
		workspaceChangesMocks.getWorkspaceChanges.mockReset();
		workspaceChangesMocks.getWorkspaceChangesBetweenRefs.mockReset();
		workspaceChangesMocks.getWorkspaceChangesFromRef.mockReset();
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockReset();

		taskArtifactCleanupMocks.deleteTaskArtifacts.mockResolvedValue({ ok: true });
		workspaceChangesMocks.createEmptyWorkspaceChangesResponse.mockResolvedValue(createChangesResponse());
		workspaceChangesMocks.getWorkspaceChanges.mockResolvedValue(createChangesResponse());
		workspaceChangesMocks.getWorkspaceChangesBetweenRefs.mockResolvedValue(createChangesResponse());
		workspaceChangesMocks.getWorkspaceChangesFromRef.mockResolvedValue(createChangesResponse());
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue(null);
	});

	it("returns the result-branch diff for last_turn mode (per-turn host checkpoints retired)", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue("result-commit");
		const response = createChangesResponse();
		workspaceChangesMocks.getWorkspaceChangesBetweenRefs.mockResolvedValue(response);

		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedNKleinTaskSessionService: vi.fn(),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(),
		});

		await expect(
			api.loadChanges(
				{
					workspaceId: "workspace-1",
					workspacePath: "/tmp/repo",
				},
				{
					taskId: "task-1",
					baseRef: "main",
					mode: "last_turn",
				},
			),
		).resolves.toBe(response);

		// last_turn no longer diffs per-turn host checkpoints (the worktree-backed checkpoint flow is retired,
		// §5.A); the reviewable diff is always the task's result branch vs base, on the project repo path.
		expect(workspaceChangesMocks.getWorkspaceChangesBetweenRefs).toHaveBeenCalledWith({
			cwd: "/tmp/repo",
			fromRef: "main",
			toRef: "result-commit",
		});
		expect(workspaceChangesMocks.getWorkspaceChangesFromRef).not.toHaveBeenCalled();
	});

	it("loads sandbox task result branch changes without resolving a host worktree", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue("result-commit");
		const response = createChangesResponse();
		workspaceChangesMocks.getWorkspaceChangesBetweenRefs.mockResolvedValue(response);
		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedNKleinTaskSessionService: vi.fn(),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(),
		});

		await expect(
			api.loadChanges(
				{
					workspaceId: "workspace-1",
					workspacePath: "/tmp/repo",
				},
				{
					taskId: "task-1",
					baseRef: "main",
					mode: "working_copy",
				},
			),
		).resolves.toBe(response);

		expect(taskResultBranchMocks.resolveTaskResultBranchCommit).toHaveBeenCalledWith({
			repoPath: "/tmp/repo",
			taskId: "task-1",
		});
		expect(workspaceChangesMocks.getWorkspaceChangesBetweenRefs).toHaveBeenCalledWith({
			cwd: "/tmp/repo",
			fromRef: "main",
			toRef: "result-commit",
		});
		expect(workspaceChangesMocks.getWorkspaceChanges).not.toHaveBeenCalled();
	});

	it("returns an empty diff for an in-progress task with no result branch yet", async () => {
		taskResultBranchMocks.resolveTaskResultBranchCommit.mockResolvedValue(null);
		const emptyResponse = createChangesResponse();
		workspaceChangesMocks.createEmptyWorkspaceChangesResponse.mockResolvedValue(emptyResponse);

		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedNKleinTaskSessionService: vi.fn(),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(),
		});

		const response = await api.loadChanges(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				mode: "last_turn",
			},
		);

		// No result branch yet → no host-visible task changes (work is in the sandbox); empty, not a throw.
		expect(response).toBe(emptyResponse);
		expect(workspaceChangesMocks.createEmptyWorkspaceChangesResponse).toHaveBeenCalledWith("/tmp/repo");
		expect(workspaceChangesMocks.getWorkspaceChangesBetweenRefs).not.toHaveBeenCalled();
	});

	it("returns an empty diff in working_copy mode when there is no result branch", async () => {
		const emptyResponse = createChangesResponse();
		workspaceChangesMocks.createEmptyWorkspaceChangesResponse.mockResolvedValue(emptyResponse);

		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedNKleinTaskSessionService: vi.fn(),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(),
		});

		const response = await api.loadChanges(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				mode: "working_copy",
			},
		);

		expect(response).toBe(emptyResponse);
		expect(workspaceChangesMocks.createEmptyWorkspaceChangesResponse).toHaveBeenCalledWith("/tmp/repo");
		expect(workspaceChangesMocks.getWorkspaceChanges).not.toHaveBeenCalled();
	});

	it("routes trash cleanup to task artifact deletion", async () => {
		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedNKleinTaskSessionService: vi.fn(),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(),
		});

		await expect(
			api.deleteTaskArtifacts(
				{
					workspaceId: "workspace-1",
					workspacePath: "/tmp/repo",
				},
				{
					taskId: "task-1",
				},
			),
		).resolves.toEqual({ ok: true });

		expect(taskArtifactCleanupMocks.deleteTaskArtifacts).toHaveBeenCalledWith({
			repoPath: "/tmp/repo",
			taskId: "task-1",
		});
	});
});

describe("createWorkspaceApi loadState", () => {
	it("merges live NKlein summaries into workspace state snapshots", async () => {
		const snapshot = {
			repoPath: "/tmp/project",
			statePath: "/tmp/project/.nklein/nklein/workspace/board.json",
			board: createBoard("Run NKlein task"),
			sessions: {},
			git: {
				currentBranch: "main",
				defaultBranch: "main",
				branches: ["main"],
			},
			revision: 1,
		};
		const nkleinSummary = createSummary({
			taskId: "task-1",
			agentId: "nklein",
			state: "running",
			workspacePath: "/tmp/project",
		});
		const api = createWorkspaceApi({
			ensureTerminalManagerForWorkspace: vi.fn(),
			getScopedNKleinTaskSessionService: vi.fn(
				async () => ({ listSummaries: vi.fn(() => [nkleinSummary]) }) as never,
			),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastRuntimeProjectsUpdated: vi.fn(),
			buildWorkspaceStateSnapshot: vi.fn(async () => snapshot),
		});

		const loaded = await api.loadState({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/project",
		});

		expect(loaded.sessions["task-1"]).toEqual(nkleinSummary);
	});
});

describe("createWorkspaceApi saveState", () => {
	it("preserves runtime-owned sessions when saving a board from stale UI state", async () => {
		await withTemporaryHome(async () => {
			const repoPath = join(
				tmpdir(),
				`kanban-workspace-api-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			);
			mkdirSync(repoPath, { recursive: true });
			try {
				initGitRepository(repoPath);
				const context = await loadWorkspaceContext(repoPath);
				const runtimeSummary = createSummary({
					state: "awaiting_review",
					agentId: "nklein",
					updatedAt: 200,
					workspacePath: repoPath,
				});
				await saveWorkspaceState(repoPath, {
					board: createBoard("Original title"),
					sessions: {
						"task-1": runtimeSummary,
					},
				});
				const latest = await loadWorkspaceState(repoPath);
				const staleUiSummary = createSummary({
					state: "running",
					agentId: "nklein",
					updatedAt: 10,
					workspacePath: repoPath,
				});
				const input = {
					board: createBoard("Edited title"),
					expectedRevision: latest.revision,
				};
				const buildWorkspaceStateSnapshot = vi.fn(async () => await loadWorkspaceState(repoPath));
				const api = createWorkspaceApi({
					ensureTerminalManagerForWorkspace: vi.fn(),
					getScopedNKleinTaskSessionService: vi.fn(),
					broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
					broadcastRuntimeProjectsUpdated: vi.fn(),
					buildWorkspaceStateSnapshot,
				});

				const saved = await api.saveState(
					{
						workspaceId: context.workspaceId,
						workspacePath: context.repoPath,
					},
					input,
				);

				expect(saved.board.columns[0]?.cards[0]?.title).toBe("Edited title");
				expect(saved.sessions["task-1"]?.state).toBe("awaiting_review");
				expect(saved.sessions["task-1"]?.updatedAt).toBe(200);
				expect(staleUiSummary.state).toBe("running");
				expect(buildWorkspaceStateSnapshot).not.toHaveBeenCalled();
			} finally {
				rmSync(repoPath, { recursive: true, force: true });
			}
		});
	});
});
