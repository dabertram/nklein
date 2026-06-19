import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import type { WorkspaceStateConflictError } from "../../src/state/workspace-state";
import {
	getTaskWorktreesHomePath,
	getWorkspacesRootPath,
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	removeWorkspaceIndexEntry,
	saveWorkspaceState,
} from "../../src/state/workspace-state";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function createBoard(title: string): RuntimeBoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						title: title,
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function createSessionSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-");
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
		cleanup();
	}
}

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

describe.sequential("workspace-state integration", () => {
	beforeEach(() => {
		selfObservationMocks.recordSelfObservation.mockReset();
	});

	it("persists revision numbers and rejects stale writes", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const initial = await loadWorkspaceState(workspacePath);
				expect(initial.revision).toBe(0);

				const firstSave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task One"),
					sessions: {},
					expectedRevision: initial.revision,
				});
				expect(firstSave.revision).toBe(1);
				expect(firstSave.board.columns[0]?.cards[0]?.prompt).toBe("Task One");

				const secondSave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task Two"),
					sessions: {},
					expectedRevision: firstSave.revision,
				});
				expect(secondSave.revision).toBe(2);
				expect(secondSave.board.columns[0]?.cards[0]?.prompt).toBe("Task Two");

				await expect(
					saveWorkspaceState(workspacePath, {
						board: createBoard("Stale Task"),
						sessions: {},
						expectedRevision: firstSave.revision,
					}),
				).rejects.toMatchObject({
					name: "WorkspaceStateConflictError",
					currentRevision: secondSave.revision,
				} satisfies Partial<WorkspaceStateConflictError>);

				const loadedAfterConflict = await loadWorkspaceState(workspacePath);
				expect(loadedAfterConflict.revision).toBe(2);
				expect(loadedAfterConflict.board.columns[0]?.cards[0]?.prompt).toBe("Task Two");
			} finally {
				cleanup();
			}
		});
	});

	it("mirrors workspace state into the project for portable recovery", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-portable-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);
				const saved = await saveWorkspaceState(workspacePath, {
					board: createBoard("Portable Task"),
					sessions: {
						"task-1": createSessionSummary("task-1"),
					},
				});
				const localStatePath = join(workspacePath, ".cline", "nklein", "workspace");
				expect(existsSync(join(localStatePath, "identity.json"))).toBe(true);
				expect(JSON.parse(readFileSync(join(localStatePath, "identity.json"), "utf8"))).toMatchObject({
					version: 1,
					workspaceId: context.workspaceId,
					repoPath: realpathSync(workspacePath),
				});
				expect(JSON.parse(readFileSync(join(localStatePath, "board.json"), "utf8"))).toEqual(saved.board);
				expect(JSON.parse(readFileSync(join(localStatePath, "sessions.json"), "utf8"))).toEqual(saved.sessions);
				expect(JSON.parse(readFileSync(join(localStatePath, "meta.json"), "utf8"))).toMatchObject({
					revision: saved.revision,
				});

				rmSync(join(getWorkspacesRootPath(), context.workspaceId), { recursive: true, force: true });
				rmSync(join(getWorkspacesRootPath(), "index.json"), { force: true });
				const recoveredContext = await loadWorkspaceContext(workspacePath);
				expect(recoveredContext.workspaceId).toBe(context.workspaceId);

				const recovered = await loadWorkspaceState(workspacePath);
				expect(recovered.revision).toBe(saved.revision);
				expect(recovered.board.columns[0]?.cards[0]?.prompt).toBe("Portable Task");
				expect(recovered.sessions["task-1"]?.taskId).toBe("task-1");
			} finally {
				cleanup();
			}
		});
	});

	it("preserves existing sessions when saving board-only state", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-board-only-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const originalSession = createSessionSummary("task-1");
				const firstSave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task One"),
					sessions: {
						"task-1": originalSession,
					},
				});
				const boardOnlySave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task Two"),
					expectedRevision: firstSave.revision,
				});

				expect(boardOnlySave.board.columns[0]?.cards[0]?.prompt).toBe("Task Two");
				expect(boardOnlySave.sessions["task-1"]).toEqual(originalSession);
				const loaded = await loadWorkspaceState(workspacePath);
				expect(loaded.sessions["task-1"]).toEqual(originalSession);
			} finally {
				cleanup();
			}
		});
	});

	it("lists and removes workspace index entries across multiple projects", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspaces-");
			try {
				const workspaceAPath = join(sandboxRoot, "alpha");
				const workspaceBPath = join(sandboxRoot, "beta");
				mkdirSync(workspaceAPath, { recursive: true });
				mkdirSync(workspaceBPath, { recursive: true });
				initGitRepository(workspaceAPath);
				initGitRepository(workspaceBPath);

				const contextA = await loadWorkspaceContext(workspaceAPath, {
					gitRepositoryCreatedByKanban: true,
				});
				const contextB = await loadWorkspaceContext(workspaceBPath);

				const entries = await listWorkspaceIndexEntries();
				expect(entries).toHaveLength(2);
				expect(
					entries.find((entry) => entry.workspaceId === contextA.workspaceId)?.gitRepositoryCreatedByKanban,
				).toBe(true);
				expect(
					entries.find((entry) => entry.workspaceId === contextB.workspaceId)?.gitRepositoryCreatedByKanban,
				).toBe(false);
				expect(entries.map((entry) => entry.workspaceId).sort()).toEqual(
					[contextA.workspaceId, contextB.workspaceId].sort(),
				);

				expect(await loadWorkspaceContextById(contextA.workspaceId)).not.toBeNull();
				expect(await removeWorkspaceIndexEntry(contextA.workspaceId)).toBe(true);
				expect(await loadWorkspaceContextById(contextA.workspaceId)).toBeNull();
				expect(await removeWorkspaceIndexEntry(contextA.workspaceId)).toBe(false);

				const entriesAfterRemoval = await listWorkspaceIndexEntries();
				expect(entriesAfterRemoval).toHaveLength(1);
				expect(entriesAfterRemoval[0]?.workspaceId).toBe(contextB.workspaceId);
			} finally {
				cleanup();
			}
		});
	});

	it("keeps all workspace index entries when projects are added concurrently", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspaces-concurrent-");
			try {
				const workspaceAPath = join(sandboxRoot, "alpha");
				const workspaceBPath = join(sandboxRoot, "beta");
				mkdirSync(workspaceAPath, { recursive: true });
				mkdirSync(workspaceBPath, { recursive: true });
				initGitRepository(workspaceAPath);
				initGitRepository(workspaceBPath);

				const [contextA, contextB] = await Promise.all([
					loadWorkspaceContext(workspaceAPath),
					loadWorkspaceContext(workspaceBPath),
				]);

				const entries = await listWorkspaceIndexEntries();
				expect(entries).toHaveLength(2);
				expect(entries.map((entry) => entry.workspaceId).sort()).toEqual(
					[contextA.workspaceId, contextB.workspaceId].sort(),
				);
			} finally {
				cleanup();
			}
		});
	});

	it("creates readable workspace ids from folder names with random suffix on collisions", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-id-format-");
			try {
				const workspaceAPath = join(sandboxRoot, "one", "vscrui");
				const workspaceBPath = join(sandboxRoot, "two", "vscrui");
				const workspaceCPath = join(sandboxRoot, "three", "My Cool Repo");
				mkdirSync(workspaceAPath, { recursive: true });
				mkdirSync(workspaceBPath, { recursive: true });
				mkdirSync(workspaceCPath, { recursive: true });
				initGitRepository(workspaceAPath);
				initGitRepository(workspaceBPath);
				initGitRepository(workspaceCPath);

				const contextA = await loadWorkspaceContext(workspaceAPath);
				const contextB = await loadWorkspaceContext(workspaceBPath);
				const contextC = await loadWorkspaceContext(workspaceCPath);

				expect(contextA.workspaceId).toBe("vscrui");
				expect(contextB.workspaceId).toMatch(/^vscrui-[a-z0-9]{4}$/);
				expect(contextB.workspaceId).not.toBe(contextA.workspaceId);
				expect(contextC.workspaceId).toBe("my-cool-repo");

				const contextAAgain = await loadWorkspaceContext(workspaceAPath);
				expect(contextAAgain.workspaceId).toBe(contextA.workspaceId);
			} finally {
				cleanup();
			}
		});
	});

	it("can require an existing project without auto-creating workspace entries", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-autocreate-");
			try {
				const workspacePath = join(sandboxRoot, "gamma");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				await expect(
					loadWorkspaceContext(workspacePath, {
						autoCreateIfMissing: false,
					}),
				).rejects.toThrow("is not added to !Klein yet");

				const created = await loadWorkspaceContext(workspacePath);
				expect(created.repoPath).toBeTruthy();
				expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
					expect.objectContaining({
						signal: "custom",
						metadata: expect.objectContaining({
							operation: "workspace_resolution",
							source: "auto_registered",
						}),
					}),
				);
				selfObservationMocks.recordSelfObservation.mockReset();

				const existing = await loadWorkspaceContext(workspacePath, {
					autoCreateIfMissing: false,
				});
				expect(existing.workspaceId).toBe(created.workspaceId);
				expect(selfObservationMocks.recordSelfObservation).not.toHaveBeenCalled();
			} finally {
				cleanup();
			}
		});
	});

	it("does not auto-create workspace entries for task worktree paths", async () => {
		await withTemporaryHome(async () => {
			const { cleanup } = createTempDir("kanban-task-worktree-autocreate-");
			try {
				const worktreePath = join(getTaskWorktreesHomePath(), "task-123", "project");
				mkdirSync(worktreePath, { recursive: true });
				initGitRepository(worktreePath);

				await expect(loadWorkspaceContext(worktreePath)).rejects.toThrow("not a standalone !Klein project");
				expect(await listWorkspaceIndexEntries()).toHaveLength(0);
				expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
					expect.objectContaining({
						signal: "custom",
						severity: "warning",
						metadata: expect.objectContaining({
							operation: "workspace_resolution",
							source: "rejected_task_worktree",
						}),
					}),
				);

				const explicit = await loadWorkspaceContext(worktreePath, {
					allowTaskWorktreeProject: true,
				});
				expect(explicit.repoPath).toBe(realpathSync(worktreePath));
				expect(await listWorkspaceIndexEntries()).toHaveLength(1);
			} finally {
				cleanup();
			}
		});
	});

	it("records explicit path resolver telemetry when loading a workspace by project path", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-explicit-path-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath, {
					resolutionSource: "explicit_path",
					resolutionMetadata: {
						providedProjectPath: "./project-a",
					},
				});

				expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
					expect.objectContaining({
						metadata: expect.objectContaining({
							operation: "workspace_resolution",
							source: "explicit_path",
							workspaceId: context.workspaceId,
							autoRegistered: true,
							providedProjectPath: "./project-a",
						}),
					}),
				);
			} finally {
				cleanup();
			}
		});
	});

	it("records explicit id resolver telemetry when loading a workspace by workspace id", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-explicit-id-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);
				selfObservationMocks.recordSelfObservation.mockReset();

				const resolved = await loadWorkspaceContextById(context.workspaceId, {
					resolutionSource: "explicit_id",
				});
				expect(resolved?.workspaceId).toBe(context.workspaceId);
				expect(selfObservationMocks.recordSelfObservation).not.toHaveBeenCalled();
			} finally {
				cleanup();
			}
		});
	});

	it("fails loudly when persisted board data is malformed", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-malformed-board-");
			try {
				const workspacePath = join(sandboxRoot, "project-bad-board");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);
				mkdirSync(context.statePath, { recursive: true });
				writeFileSync(
					join(context.statePath, "board.json"),
					JSON.stringify(
						{
							columns: [
								{
									id: "backlog",
									title: "Backlog",
									cards: [
										{
											prompt: "Missing ID and baseRef",
											startInPlanMode: false,
											createdAt: Date.now(),
											updatedAt: Date.now(),
										},
									],
								},
								{ id: "in_progress", title: "In Progress", cards: [] },
								{ id: "review", title: "Review", cards: [] },
								{ id: "trash", title: "Done", cards: [] },
							],
						},
						null,
						2,
					),
					"utf8",
				);

				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow("board.json");
				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow(/id|baseRef/);
			} finally {
				cleanup();
			}
		});
	});

	it("fails loudly when persisted sessions include unknown states", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-malformed-sessions-");
			try {
				const workspacePath = join(sandboxRoot, "project-bad-sessions");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);
				mkdirSync(context.statePath, { recursive: true });
				writeFileSync(
					join(context.statePath, "board.json"),
					JSON.stringify(createBoard("Valid board"), null, 2),
					"utf8",
				);
				writeFileSync(
					join(context.statePath, "sessions.json"),
					JSON.stringify(
						{
							"task-1": {
								...createSessionSummary("task-1"),
								state: "not-a-valid-state",
							},
						},
						null,
						2,
					),
					"utf8",
				);

				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow("sessions.json");
				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow("state");
			} finally {
				cleanup();
			}
		});
	});

	it("fails loudly when persisted workspace index data is malformed", async () => {
		await withTemporaryHome(async () => {
			mkdirSync(getWorkspacesRootPath(), { recursive: true });
			writeFileSync(
				join(getWorkspacesRootPath(), "index.json"),
				JSON.stringify(
					{
						version: 1,
						entries: {
							"workspace-a": {
								workspaceId: "workspace-a",
							},
						},
						repoPathToId: {},
					},
					null,
					2,
				),
				"utf8",
			);

			await expect(listWorkspaceIndexEntries()).rejects.toThrow("index.json");
			await expect(listWorkspaceIndexEntries()).rejects.toThrow("repoPath");
		});
	});
});
