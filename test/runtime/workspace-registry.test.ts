import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../../src/config/runtime-config";
import type { RuntimeBoardData } from "../../src/core/api-contract";
import { collectProjectWorktreeTaskIdsForRemoval, createWorkspaceRegistry } from "../../src/server/workspace-registry";
import { listWorkspaceIndexEntries, loadWorkspaceContext, saveWorkspaceState } from "../../src/state/workspace-state";
import { createGitTestEnv } from "../utilities/git-env";

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

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
	const tempHome = join(tmpdir(), `kanban-registry-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

describe("collectProjectWorktreeTaskIdsForRemoval", () => {
	it("includes tasks from every board column during project cleanup", () => {
		const board = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [{ id: "backlog-task" }] },
				{ id: "in_progress", title: "In Progress", cards: [{ id: "active-task" }] },
				{ id: "review", title: "Review", cards: [{ id: "review-task" }] },
				{ id: "trash", title: "Trash", cards: [{ id: "trash-task" }] },
			],
			dependencies: [],
		} as unknown as RuntimeBoardData;

		expect(Array.from(collectProjectWorktreeTaskIdsForRemoval(board)).sort()).toEqual([
			"active-task",
			"backlog-task",
			"review-task",
			"trash-task",
		]);
	});
});

describe("createWorkspaceRegistry", () => {
	it("does not auto-register the launch cwd when it is an unindexed git repository", async () => {
		await withTemporaryHome(async () => {
			const repoPath = join(
				tmpdir(),
				`kanban-registry-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			);
			mkdirSync(repoPath, { recursive: true });
			try {
				initGitRepository(repoPath);
				const registry = await createWorkspaceRegistry({
					cwd: repoPath,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: () => true,
					pathIsDirectory: async () => true,
				});

				const entries = await listWorkspaceIndexEntries();
				expect(registry.getActiveWorkspaceId()).toBeNull();
				expect(registry.getActiveWorkspacePath()).toBeNull();
				expect(entries).toHaveLength(0);
			} finally {
				rmSync(repoPath, { recursive: true, force: true });
			}
		});
	});

	it("hides an indexed launch checkout until it has explicit self-project confirmation", async () => {
		await withTemporaryHome(async () => {
			const repoPath = join(
				tmpdir(),
				`kanban-registry-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			);
			mkdirSync(repoPath, { recursive: true });
			try {
				initGitRepository(repoPath);
				await loadWorkspaceContext(repoPath);

				const registry = await createWorkspaceRegistry({
					cwd: repoPath,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: () => true,
					pathIsDirectory: async () => true,
				});
				const payload = await registry.buildProjectsPayload(null);

				expect(payload.projects.some((project) => realpathSync(project.path) === realpathSync(repoPath))).toBe(
					false,
				);
				expect(registry.getActiveWorkspaceId()).toBeNull();
			} finally {
				rmSync(repoPath, { recursive: true, force: true });
			}
		});
	});

	it("shows an indexed launch checkout after explicit self-project confirmation", async () => {
		await withTemporaryHome(async () => {
			const repoPath = join(
				tmpdir(),
				`kanban-registry-source-confirmed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			);
			mkdirSync(repoPath, { recursive: true });
			try {
				initGitRepository(repoPath);
				await loadWorkspaceContext(repoPath, { selfProjectConfirmed: true });

				const registry = await createWorkspaceRegistry({
					cwd: repoPath,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: () => true,
					pathIsDirectory: async () => true,
				});
				const payload = await registry.buildProjectsPayload(null);

				expect(payload.projects.some((project) => realpathSync(project.path) === realpathSync(repoPath))).toBe(
					true,
				);
				expect(realpathSync(registry.getActiveWorkspacePath() ?? "")).toBe(realpathSync(repoPath));
			} finally {
				rmSync(repoPath, { recursive: true, force: true });
			}
		});
	});

	it("reports accidental task-worktree projects with parent and artifact metadata", async () => {
		selfObservationMocks.recordSelfObservation.mockReset();
		await withTemporaryHome(async () => {
			const parentPath = join(tmpdir(), `kanban-parent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
			const worktreePath = join(
				process.env.HOME ?? tmpdir(),
				".nklein",
				"worktrees",
				"source-card",
				"kanban-parent",
			);
			const cwd = join(tmpdir(), `kanban-registry-cwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
			mkdirSync(parentPath, { recursive: true });
			mkdirSync(worktreePath, { recursive: true });
			mkdirSync(cwd, { recursive: true });
			try {
				initGitRepository(parentPath);
				initGitRepository(worktreePath);
				const parent = await loadWorkspaceContext(parentPath);
				await saveWorkspaceState(parentPath, {
					board: {
						columns: [
							{
								id: "backlog",
								title: "Backlog",
								cards: [
									{
										id: "source-card",
										title: "Source",
										prompt: "Break this down.",
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
					},
					sessions: {},
				});
				await loadWorkspaceContext(worktreePath, { allowTaskWorktreeProject: true });
				mkdirSync(join(worktreePath, ".nklein", "nklein", "plans", "misplaced-plan"), { recursive: true });

				const registry = await createWorkspaceRegistry({
					cwd,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: (path) => path === parentPath || path === worktreePath,
					pathIsDirectory: async () => true,
				});
				const payload = await registry.buildProjectsPayload(null);
				const accidental = payload.projects.find(
					(project) => realpathSync(project.path) === realpathSync(worktreePath),
				);

				const healthIssues = accidental?.healthIssues ?? [];
				expect(healthIssues).toHaveLength(1);
				expect(healthIssues[0]).toMatchObject({
					kind: "task_worktree_project",
					taskId: "source-card",
					parentWorkspaceId: parent.workspaceId,
					parentWorkspacePath: parent.repoPath,
					artifactCount: 1,
					canMigrateArtifacts: true,
				});
				expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
					expect.objectContaining({
						metadata: expect.objectContaining({
							operation: "workspace_resolution",
							source: "parent_worktree",
							parentWorkspaceId: parent.workspaceId,
							parentWorkspacePath: parent.repoPath,
							taskId: "source-card",
						}),
					}),
				);
			} finally {
				rmSync(parentPath, { recursive: true, force: true });
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	it("reports pending plan artifacts as project health diagnostics", async () => {
		await withTemporaryHome(async () => {
			const repoPath = join(
				tmpdir(),
				`kanban-pending-artifacts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			);
			const cwd = join(tmpdir(), `kanban-registry-cwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
			mkdirSync(repoPath, { recursive: true });
			mkdirSync(cwd, { recursive: true });
			try {
				initGitRepository(repoPath);
				await loadWorkspaceContext(repoPath);
				const artifactPath = join(repoPath, ".nklein", "nklein", "plans", "pending-plan");
				mkdirSync(artifactPath, { recursive: true });
				writeFileSync(
					join(artifactPath, "artifact.json"),
					JSON.stringify({
						artifactId: "decomposition:pending-plan",
						workspaceId: "workspace-1",
						workspacePath: repoPath,
						sourceTaskId: "source-card",
						artifactKind: "decomposition",
						planSlug: "pending-plan",
						createdAt: 1,
						updatedAt: 1,
						validationStatus: "valid",
						applicationStatus: "pending",
					}),
					"utf8",
				);

				const registry = await createWorkspaceRegistry({
					cwd,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: (path) => path === repoPath,
					pathIsDirectory: async () => true,
				});
				const payload = await registry.buildProjectsPayload(null);
				const project = payload.projects.find(
					(candidate) => realpathSync(candidate.path) === realpathSync(repoPath),
				);

				expect(project?.healthIssues?.[0]).toMatchObject({
					kind: "pending_plan_artifacts",
					artifactCount: 1,
					canMigrateArtifacts: false,
					canRemove: false,
				});
			} finally {
				rmSync(repoPath, { recursive: true, force: true });
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	it("reports lost sessions with pending plan artifacts", async () => {
		await withTemporaryHome(async () => {
			const repoPath = join(tmpdir(), `kanban-lost-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
			const cwd = join(tmpdir(), `kanban-registry-cwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
			mkdirSync(repoPath, { recursive: true });
			mkdirSync(cwd, { recursive: true });
			try {
				initGitRepository(repoPath);
				await loadWorkspaceContext(repoPath);
				await saveWorkspaceState(repoPath, {
					board: {
						columns: [
							{
								id: "backlog",
								title: "Backlog",
								cards: [
									{
										id: "source-card",
										title: "Source",
										prompt: "Split this work.",
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
					},
					sessions: {
						"source-card": {
							taskId: "source-card",
							state: "running",
							agentId: "nklein",
							workspacePath: repoPath,
							pid: null,
							startedAt: 1,
							updatedAt: 2,
							lastOutputAt: 2,
							lastHeartbeatAt: 1,
							heartbeatStatus: "lost",
							reviewReason: null,
							exitCode: null,
							lastHookAt: null,
							latestHookActivity: null,
							latestTurnCheckpoint: null,
							previousTurnCheckpoint: null,
						},
					},
				});
				const artifactPath = join(repoPath, ".nklein", "nklein", "plans", "pending-plan");
				mkdirSync(artifactPath, { recursive: true });
				writeFileSync(
					join(artifactPath, "artifact.json"),
					JSON.stringify({
						artifactId: "decomposition:pending-plan",
						workspaceId: "workspace-1",
						workspacePath: repoPath,
						sourceTaskId: "source-card",
						artifactKind: "decomposition",
						planSlug: "pending-plan",
						createdAt: 1,
						updatedAt: 1,
						validationStatus: "valid",
						applicationStatus: "pending",
					}),
					"utf8",
				);

				const registry = await createWorkspaceRegistry({
					cwd,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: (path) => path === repoPath,
					pathIsDirectory: async () => true,
				});
				const payload = await registry.buildProjectsPayload(null);
				const project = payload.projects.find(
					(candidate) => realpathSync(candidate.path) === realpathSync(repoPath),
				);

				expect(project?.healthIssues?.[0]).toMatchObject({
					kind: "lost_session_pending_artifacts",
					severity: "error",
					taskId: "source-card",
					artifactCount: 1,
				});
			} finally {
				rmSync(repoPath, { recursive: true, force: true });
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});
});
