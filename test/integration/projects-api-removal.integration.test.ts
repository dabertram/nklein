import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { RuntimeProjectTaskCounts } from "../../src/core/api-contract";
import { listWorkspaceIndexEntries, loadWorkspaceContext } from "../../src/state/workspace-state";
import type { TerminalSessionManager } from "../../src/terminal/session-manager";
import { type CreateProjectsApiDependencies, createProjectsApi } from "../../src/trpc/projects-api";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

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

function createDeps(serverCwd: string): CreateProjectsApiDependencies {
	return {
		getActiveWorkspacePath: () => null,
		getActiveWorkspaceId: () => null,
		rememberWorkspace: vi.fn(),
		setActiveWorkspace: vi.fn(async () => {}),
		clearActiveWorkspace: vi.fn(),
		resolveProjectInputPath: (inputPath, cwd) => resolve(cwd, inputPath),
		assertPathIsDirectory: vi.fn(async () => {}),
		hasGitRepository: () => true,
		summarizeProjectTaskCounts: async (): Promise<RuntimeProjectTaskCounts> => ({
			backlog: 0,
			planning: 0,
			in_progress: 0,
			review: 0,
			completed: 0,
			trash: 0,
		}),
		createProjectSummary: (project) => ({
			id: project.workspaceId,
			path: project.repoPath,
			name: "project",
			taskCounts: project.taskCounts,
			gitRepositoryCreatedByKanban: project.gitRepositoryCreatedByKanban,
		}),
		broadcastRuntimeProjectsUpdated: vi.fn(),
		getTerminalManagerForWorkspace: () => null,
		disposeWorkspace: () => ({
			terminalManager: null as TerminalSessionManager | null,
			workspacePath: null,
		}),
		collectProjectWorktreeTaskIdsForRemoval: () => new Set<string>(),
		warn: vi.fn(),
		buildProjectsPayload: async () => ({ currentProjectId: null, projects: [] }),
		pickDirectoryPathFromSystemDialog: () => null,
		serverCwd,
	};
}

function initializeGitRepository(projectPath: string): void {
	const result = spawnSync("git", ["init"], {
		cwd: projectPath,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(`Failed to initialize Git repository at ${projectPath}`);
	}
}

describe.sequential("project Git repository removal", () => {
	it("removes owned Git metadata but keeps project files", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-project-removal-");
			try {
				const projectPath = join(sandboxRoot, "project");
				mkdirSync(projectPath, { recursive: true });
				initializeGitRepository(projectPath);
				writeFileSync(join(projectPath, "README.md"), "keep me");
				const context = await loadWorkspaceContext(projectPath, {
					gitRepositoryCreatedByKanban: true,
				});
				const api = createProjectsApi(createDeps(sandboxRoot));

				const result = await api.removeProject(null, {
					projectId: context.workspaceId,
					deleteGitRepository: true,
				});

				expect(result).toEqual({ ok: true });
				expect(existsSync(join(projectPath, ".git"))).toBe(false);
				expect(existsSync(join(projectPath, "README.md"))).toBe(true);
				expect(await listWorkspaceIndexEntries()).toEqual([]);
			} finally {
				cleanup();
			}
		});
	});

	it("refuses to remove Git metadata for an unowned repository", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-project-removal-");
			try {
				const projectPath = join(sandboxRoot, "project");
				mkdirSync(projectPath, { recursive: true });
				initializeGitRepository(projectPath);
				const context = await loadWorkspaceContext(projectPath);
				const api = createProjectsApi(createDeps(sandboxRoot));

				const result = await api.removeProject(null, {
					projectId: context.workspaceId,
					deleteGitRepository: true,
				});

				expect(result.ok).toBe(false);
				expect(result.error).toContain("!Klein did not create this Git repository");
				expect(existsSync(join(projectPath, ".git"))).toBe(true);
				expect(await listWorkspaceIndexEntries()).toHaveLength(1);
			} finally {
				cleanup();
			}
		});
	});
});
