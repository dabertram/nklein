import { existsSync, mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
	RuntimeBoardData,
	RuntimeProjectAddResponse,
	RuntimeProjectRemoveResponse,
	RuntimeProjectsResponse,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamWorkspaceStateMessage,
	RuntimeWorkspaceStateResponse,
} from "../../src/core/api-contract";
import type { RuntimeStreamClient } from "../contract/helpers";
import {
	connectRuntimeStream,
	createBoard,
	getAvailablePort,
	initGitRepository,
	requestJson,
	startTsBackend,
} from "../contract/helpers";
import { createTempDir } from "../utilities/temp-dir";

function createReviewBoard(taskId: string, title: string, existingTrashTaskId?: string): RuntimeBoardData {
	const now = Date.now();
	const trashCards = existingTrashTaskId
		? [
				{
					id: existingTrashTaskId,
					title: "Already trashed task",
					prompt: "Already trashed task",
					startInPlanMode: false,
					baseRef: "main",
					createdAt: now,
					updatedAt: now,
				},
			]
		: [];
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: taskId,
						title: title,
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{ id: "trash", title: "Done", cards: trashCards },
		],
		dependencies: [],
	};
}

/**
 * Register the server's cwd as a project and return its workspace ID.
 *
 * The server no longer eagerly registers its cwd at startup — it only indexes
 * a workspace when the client explicitly adds it. Pass the cwd path and
 * `confirmSelfProject: true` so the self-project guard is satisfied, then read
 * the assigned workspace ID from the add response.
 */
async function resolveStartupWorkspaceId(port: number, cwdPath: string): Promise<string> {
	const addResponse = await requestJson<RuntimeProjectAddResponse>({
		baseUrl: `http://127.0.0.1:${port}`,
		procedure: "projects.add",
		type: "mutation",
		payload: { path: cwdPath, confirmSelfProject: true },
	});
	if (!addResponse.payload.ok || !addResponse.payload.project) {
		throw new Error(`Failed to register startup workspace: ${JSON.stringify(addResponse.payload)}`);
	}
	return addResponse.payload.project.id;
}

describe.sequential("runtime state stream integration", () => {
	it("starts outside a git repository with no active workspace", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-no-git-");
		const { path: nonGitPath, cleanup: cleanupNonGitPath } = createTempDir("kanban-no-git-");

		const port = await getAvailablePort();
		const server = await startTsBackend({
			cwd: nonGitPath,
			homeDir: tempHome,
			port,
		});

		let stream: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.baseUrl);
			expect(runtimeUrl.pathname).toBe("/");

			const projectsResponse = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
			});
			expect(projectsResponse.status).toBe(200);
			expect(projectsResponse.payload.currentProjectId).toBeNull();
			expect(projectsResponse.payload.projects).toEqual([]);

			stream = await connectRuntimeStream(`ws://127.0.0.1:${port}/api/runtime/ws`);
			const snapshot = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.currentProjectId).toBeNull();
			expect(snapshot.workspaceState).toBeNull();
			expect(snapshot.projects).toEqual([]);
		} finally {
			if (stream) {
				await stream.close();
			}
			await server.stop();
			cleanupNonGitPath();
			cleanupHome();
		}
	}, 30_000);

	it("starts from the home directory with no active workspace", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-home-dir-launch-");

		const port = await getAvailablePort();
		const server = await startTsBackend({
			cwd: tempHome,
			homeDir: tempHome,
			port,
		});

		let stream: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.baseUrl);
			expect(runtimeUrl.pathname).toBe("/");

			const projectsResponse = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
			});
			expect(projectsResponse.status).toBe(200);
			expect(projectsResponse.payload.currentProjectId).toBeNull();
			expect(projectsResponse.payload.projects).toEqual([]);

			stream = await connectRuntimeStream(`ws://127.0.0.1:${port}/api/runtime/ws`);
			const snapshot = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.currentProjectId).toBeNull();
			expect(snapshot.workspaceState).toBeNull();
			expect(snapshot.projects).toEqual([]);
		} finally {
			if (stream) {
				await stream.close();
			}
			await server.stop();
			cleanupHome();
		}
	}, 30_000);

	it("launches outside git using the first indexed project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-first-project-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-first-project-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		const nonGitPath = join(tempRoot, "non-git");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		mkdirSync(nonGitPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const firstPort = await getAvailablePort();
		const firstServer = await startTsBackend({
			cwd: projectAPath,
			homeDir: tempHome,
			port: firstPort,
		});

		let workspaceAId: string | null = null;
		try {
			workspaceAId = await resolveStartupWorkspaceId(firstPort, projectAPath);
			expect(workspaceAId).not.toBeNull();
			expect(workspaceAId).not.toBe("");

			const addProjectResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: projectBPath,
				},
			});
			expect(addProjectResponse.status).toBe(200);
			expect(addProjectResponse.payload.ok).toBe(true);
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startTsBackend({
			cwd: nonGitPath,
			homeDir: tempHome,
			port: secondPort,
		});

		let secondStream: RuntimeStreamClient | null = null;
		try {
			if (!workspaceAId) {
				throw new Error("Missing workspace id for project A.");
			}
			// Second server starts from a non-git dir; workspaceAId is already indexed from the
			// first server run, so read it from the initial WS snapshot (no add needed).
			const secondStream0 = await connectRuntimeStream(`ws://127.0.0.1:${secondPort}/api/runtime/ws`);
			const secondSnapshot0 = (await secondStream0.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			await secondStream0.close();
			expect(secondSnapshot0.currentProjectId).toBe(workspaceAId);
			const expectedProjectAPath = await realpath(projectAPath).catch(() => resolve(projectAPath));

			const projectsResponse = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "projects.list",
				type: "query",
			});
			expect(projectsResponse.status).toBe(200);
			expect(projectsResponse.payload.currentProjectId).toBe(workspaceAId);

			secondStream = await connectRuntimeStream(`ws://127.0.0.1:${secondPort}/api/runtime/ws`);
			const snapshot = (await secondStream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.currentProjectId).toBe(workspaceAId);
			expect(snapshot.workspaceState?.repoPath).toBe(expectedProjectAPath);
		} finally {
			if (secondStream) {
				await secondStream.close();
			}
			await secondServer.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 45_000);

	it("requires explicit confirmation before initializing git for a non-git added project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-project-add-git-confirm-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-project-add-git-confirm-");

		const projectAPath = join(tempRoot, "project-a");
		const nonGitPath = join(tempRoot, "non-git-project");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(nonGitPath, { recursive: true });
		initGitRepository(projectAPath);

		const port = await getAvailablePort();
		const server = await startTsBackend({
			cwd: projectAPath,
			homeDir: tempHome,
			port,
		});

		let workspaceAId: string | null = null;
		try {
			workspaceAId = await resolveStartupWorkspaceId(port, projectAPath);
			expect(workspaceAId).not.toBeNull();
			expect(workspaceAId).not.toBe("");

			const addWithoutInitResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: nonGitPath,
				},
			});
			expect(addWithoutInitResponse.status).toBe(200);
			expect(addWithoutInitResponse.payload.ok).toBe(false);
			expect(addWithoutInitResponse.payload.requiresGitInitialization).toBe(true);
			expect(existsSync(join(nonGitPath, ".git"))).toBe(false);

			const projectsAfterDenkleindInit = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
				workspaceId: workspaceAId,
			});
			expect(projectsAfterDenkleindInit.status).toBe(200);
			expect(projectsAfterDenkleindInit.payload.projects).toHaveLength(1);

			const addWithInitResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: nonGitPath,
					initializeGit: true,
				},
			});
			expect(addWithInitResponse.status).toBe(200);
			expect(addWithInitResponse.payload.ok).toBe(true);
			expect(addWithInitResponse.payload.project).not.toBeNull();
			expect(existsSync(join(nonGitPath, ".git"))).toBe(true);
		} finally {
			await server.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 45_000);

	it("streams per-project snapshots and isolates workspace updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-stream-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-projects-stream-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const port = await getAvailablePort();
		const server = await startTsBackend({
			cwd: projectAPath,
			homeDir: tempHome,
			port,
		});

		let streamA: RuntimeStreamClient | null = null;
		let streamB: RuntimeStreamClient | null = null;

		try {
			const workspaceAId = await resolveStartupWorkspaceId(port, projectAPath);
			const expectedProjectAPath = await realpath(projectAPath).catch(() => resolve(projectAPath));
			const expectedProjectBPath = await realpath(projectBPath).catch(() => resolve(projectBPath));

			const addProjectResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: projectBPath,
				},
			});
			expect(addProjectResponse.status).toBe(200);
			expect(addProjectResponse.payload.ok).toBe(true);
			const workspaceBId = addProjectResponse.payload.project?.id ?? null;
			expect(workspaceBId).not.toBeNull();
			if (!workspaceBId) {
				throw new Error("Missing project id for added workspace.");
			}

			streamA = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceAId)}`,
			);
			const snapshotA = (await streamA.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshotA.currentProjectId).toBe(workspaceAId);
			expect(snapshotA.workspaceState?.repoPath).toBe(expectedProjectAPath);
			expect(snapshotA.projects.map((project) => project.id).sort()).toEqual([workspaceAId, workspaceBId].sort());

			streamB = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceBId)}`,
			);
			const snapshotB = (await streamB.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshotB.currentProjectId).toBe(workspaceBId);
			expect(snapshotB.workspaceState?.repoPath).toBe(expectedProjectBPath);

			const currentWorkspaceBState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId: workspaceBId,
			});
			const previousRevision = currentWorkspaceBState.payload.revision;
			const saveWorkspaceBResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId: workspaceBId,
				payload: {
					board: createBoard("Realtime Task"),
					sessions: currentWorkspaceBState.payload.sessions,
					expectedRevision: previousRevision,
				},
			});
			expect(saveWorkspaceBResponse.status).toBe(200);
			expect(saveWorkspaceBResponse.payload.revision).toBe(previousRevision + 1);

			const workspaceUpdateB = (await streamB.waitForMessage(
				(message): message is RuntimeStateStreamWorkspaceStateMessage =>
					message.type === "workspace_state_updated" && message.workspaceId === workspaceBId,
			)) as RuntimeStateStreamWorkspaceStateMessage;
			expect(workspaceUpdateB.workspaceState.revision).toBe(previousRevision + 1);
			expect(workspaceUpdateB.workspaceState.board.columns[0]?.cards[0]?.prompt).toBe("Realtime Task");

			const streamAMessages = await streamA.collectFor(500);
			expect(
				streamAMessages.some(
					(message) => message.type === "workspace_state_updated" && message.workspaceId === workspaceBId,
				),
			).toBe(false);

			const projectsAfterUpdate = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
				workspaceId: workspaceAId,
			});
			expect(projectsAfterUpdate.status).toBe(200);
			const projectB = projectsAfterUpdate.payload.projects.find((project) => project.id === workspaceBId) ?? null;
			expect(projectB?.taskCounts.backlog).toBe(1);
		} finally {
			if (streamA) {
				await streamA.close();
			}
			if (streamB) {
				await streamB.close();
			}
			await server.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 30_000);

	it("moves stale completed review cards to trash on shutdown", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-stale-exit-review-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-stale-exit-review-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "stale-exit-review-task";
		const taskTitle = "Stale Exit Review Task";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startTsBackend({
			cwd: projectPath,
			homeDir: tempHome,
			port: firstPort,
		});

		try {
			const workspaceId = await resolveStartupWorkspaceId(firstPort, projectPath);

			const currentState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(currentState.status).toBe(200);

			const seedResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board: createReviewBoard(taskId, taskTitle),
					sessions: {
						[taskId]: {
							taskId,
							state: "awaiting_review",
							agentId: "codex",
							workspacePath: projectPath,
							pid: null,
							startedAt: now - 2_000,
							updatedAt: now,
							lastOutputAt: now,
							reviewReason: "exit",
							exitCode: 0,
							lastHookAt: null,
							latestHookActivity: null,
						},
					},
					expectedRevision: currentState.payload.revision,
				},
			});
			expect(seedResponse.status).toBe(200);
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startTsBackend({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const workspaceId = await resolveStartupWorkspaceId(secondPort, projectPath);

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(finalState.status).toBe(200);

			const reviewCards = finalState.payload.board.columns.find((column) => column.id === "review")?.cards ?? [];
			const trashCards = finalState.payload.board.columns.find((column) => column.id === "trash")?.cards ?? [];
			expect(reviewCards.some((card) => card.id === taskId)).toBe(false);
			expect(trashCards.some((card) => card.id === taskId)).toBe(true);
			expect(finalState.payload.sessions[taskId]?.state).toBe("interrupted");
			expect(finalState.payload.sessions[taskId]?.reviewReason).toBe("interrupted");
		} finally {
			await secondServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("skips stale session shutdown cleanup when --skip-shutdown-cleanup is enabled", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-skip-cleanup-flag-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-skip-cleanup-flag-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "skip-cleanup-flag-review-task";
		const taskTitle = "Keep review task when cleanup flag is enabled";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startTsBackend({
			cwd: projectPath,
			homeDir: tempHome,
			port: firstPort,
			extraArgs: ["--skip-shutdown-cleanup"],
		});

		try {
			const workspaceId = await resolveStartupWorkspaceId(firstPort, projectPath);

			const currentState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(currentState.status).toBe(200);

			const seedResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board: createReviewBoard(taskId, taskTitle),
					sessions: {
						[taskId]: {
							taskId,
							state: "awaiting_review",
							agentId: "codex",
							workspacePath: projectPath,
							pid: null,
							startedAt: now - 2_000,
							updatedAt: now,
							lastOutputAt: now,
							reviewReason: "hook",
							exitCode: null,
							lastHookAt: null,
							latestHookActivity: null,
						},
					},
					expectedRevision: currentState.payload.revision,
				},
			});
			expect(seedResponse.status).toBe(200);
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startTsBackend({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const workspaceId = await resolveStartupWorkspaceId(secondPort, projectPath);

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(finalState.status).toBe(200);

			const reviewCards = finalState.payload.board.columns.find((column) => column.id === "review")?.cards ?? [];
			const trashCards = finalState.payload.board.columns.find((column) => column.id === "trash")?.cards ?? [];
			expect(reviewCards.some((card) => card.id === taskId)).toBe(true);
			expect(trashCards.some((card) => card.id === taskId)).toBe(false);
			expect(finalState.payload.sessions[taskId]?.state).toBe("awaiting_review");
			expect(finalState.payload.sessions[taskId]?.reviewReason).toBe("hook");
		} finally {
			await secondServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("falls back to remaining project when removing the active project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-remove-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-projects-remove-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const port = await getAvailablePort();
		const server = await startTsBackend({
			cwd: projectAPath,
			homeDir: tempHome,
			port,
		});

		let streamA: RuntimeStreamClient | null = null;
		let streamB: RuntimeStreamClient | null = null;

		try {
			const workspaceAId = await resolveStartupWorkspaceId(port, projectAPath);
			const expectedProjectBPath = await realpath(projectBPath).catch(() => resolve(projectBPath));

			const addProjectResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: projectBPath,
				},
			});
			expect(addProjectResponse.status).toBe(200);
			expect(addProjectResponse.payload.ok).toBe(true);
			const workspaceBId = addProjectResponse.payload.project?.id ?? null;
			expect(workspaceBId).not.toBeNull();
			if (!workspaceBId) {
				throw new Error("Missing project id for added workspace.");
			}

			streamA = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceAId)}`,
			);
			const initialSnapshot = (await streamA.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(initialSnapshot.currentProjectId).toBe(workspaceAId);

			const removeResponse = await requestJson<RuntimeProjectRemoveResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.remove",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					projectId: workspaceAId,
				},
			});
			expect(removeResponse.status).toBe(200);
			expect(removeResponse.payload.ok).toBe(true);

			const projectsUpdated = (await streamA.waitForMessage(
				(message): message is RuntimeStateStreamProjectsMessage =>
					message.type === "projects_updated" && message.currentProjectId === workspaceBId,
			)) as RuntimeStateStreamProjectsMessage;
			expect(projectsUpdated.currentProjectId).toBe(workspaceBId);
			expect(projectsUpdated.projects.map((project) => project.id)).toEqual([workspaceBId]);

			streamB = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceBId)}`,
			);
			const fallbackSnapshot = (await streamB.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(fallbackSnapshot.currentProjectId).toBe(workspaceBId);
			expect(fallbackSnapshot.workspaceState?.repoPath).toBe(expectedProjectBPath);

			const projectsAfterRemoval = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
				workspaceId: workspaceBId,
			});
			expect(projectsAfterRemoval.status).toBe(200);
			expect(projectsAfterRemoval.payload.currentProjectId).toBe(workspaceBId);
			expect(projectsAfterRemoval.payload.projects.map((project) => project.id)).toEqual([workspaceBId]);
		} finally {
			if (streamA) {
				await streamA.close();
			}
			if (streamB) {
				await streamB.close();
			}
			await server.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 30_000);
});
