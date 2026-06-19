import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO } from "../../../src/cline-sdk/cline-dev-test-project";
import { writeClinePlanArtifacts } from "../../../src/cline-sdk/cline-plan-artifacts";
import type { RuntimeProjectTaskCounts } from "../../../src/core/api-contract";
import {
	getTaskWorktreesHomePath,
	getWorkspaceDirectoryPath,
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceState,
	saveWorkspaceState,
} from "../../../src/state/workspace-state";
import type { TerminalSessionManager } from "../../../src/terminal/session-manager";
import {
	type CreateProjectsApiDependencies,
	createDevTestBoard,
	createProjectsApi,
} from "../../../src/trpc/projects-api";
import { createGitTestEnv } from "../../utilities/git-env";

function createTestCwd(): string {
	const base = join(tmpdir(), `kanban-test-dir-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(base, { recursive: true });
	return base;
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
	for (const [key, value] of [
		["user.email", "kanban-test@example.com"],
		["user.name", "!Klein Test"],
	] as const) {
		const config = spawnSync("git", ["config", "--local", key, value], {
			cwd: path,
			stdio: "ignore",
			env: createGitTestEnv(),
		});
		if (config.status !== 0) {
			throw new Error(`Failed to configure git repository at ${path}`);
		}
	}
}

function commitAll(path: string, message: string): void {
	const add = spawnSync("git", ["add", "-A"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (add.status !== 0) {
		throw new Error(`Failed to stage git repository at ${path}`);
	}
	const commit = spawnSync("git", ["commit", "--allow-empty", "-m", message], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (commit.status !== 0) {
		throw new Error(`Failed to commit git repository at ${path}`);
	}
}

function getGitHead(path: string): string {
	const revParse = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
		cwd: path,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (revParse.status !== 0) {
		throw new Error(`Failed to read git HEAD at ${path}`);
	}
	return revParse.stdout.trim();
}

function getPatchRepoKey(repoPath: string): string {
	let canonicalRepoPath: string;
	try {
		canonicalRepoPath = realpathSync(repoPath);
	} catch {
		canonicalRepoPath = resolve(repoPath);
	}
	return createHash("sha256").update(canonicalRepoPath).digest("hex").slice(0, 12);
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const tempHome = createTestCwd();
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

function createDefaultDeps(serverCwd: string): CreateProjectsApiDependencies {
	return {
		getActiveWorkspacePath: vi.fn(() => null),
		getActiveWorkspaceId: vi.fn(() => null),
		rememberWorkspace: vi.fn(),
		setActiveWorkspace: vi.fn(async () => {}),
		clearActiveWorkspace: vi.fn(),
		resolveProjectInputPath: vi.fn((inputPath: string, cwd: string) => resolve(cwd, inputPath)),
		assertPathIsDirectory: vi.fn(async () => {}),
		hasGitRepository: vi.fn(() => false),
		summarizeProjectTaskCounts: vi.fn(
			async (): Promise<RuntimeProjectTaskCounts> => ({
				backlog: 0,
				planning: 0,
				in_progress: 0,
				review: 0,
				completed: 0,
				trash: 0,
			}),
		),
		createProjectSummary: vi.fn(() => ({
			id: "test",
			path: "/test",
			name: "test",
			taskCounts: { backlog: 0, planning: 0, in_progress: 0, review: 0, completed: 0, trash: 0 },
		})),
		broadcastRuntimeProjectsUpdated: vi.fn(),
		getTerminalManagerForWorkspace: vi.fn(() => null),
		disposeWorkspace: vi.fn(() => ({
			terminalManager: null as TerminalSessionManager | null,
			workspacePath: null as string | null,
		})),
		collectProjectWorktreeTaskIdsForRemoval: vi.fn(() => new Set<string>()),
		warn: vi.fn(),
		buildProjectsPayload: vi.fn(async () => ({ currentProjectId: null, projects: [] })),
		pickDirectoryPathFromSystemDialog: vi.fn(() => null),
		serverCwd,
	};
}

describe("createDevTestBoard", () => {
	it("seeds one Cline-only decomposition task without prebuilt dependencies", () => {
		const board = createDevTestBoard({
			taskId: "dev-initial-decompose",
			title: COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO.title,
			prompt: COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO.prompt,
			acceptanceCommand: COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO.acceptanceCommand,
			now: 123,
		});
		const backlog = board.columns.find((column) => column.id === "backlog")?.cards ?? [];
		expect(backlog).toHaveLength(1);
		expect(new Set(backlog.map((card) => card.agentId))).toEqual(new Set(["cline"]));
		expect(backlog[0]?.clineSettings).toBeUndefined();
		expect(backlog[0]?.startInPlanMode).toBe(true);
		expect(backlog[0]?.autoReviewEnabled).toBe(true);
		expect(backlog[0]?.prompt).not.toContain("/kanban-decompose");
		expect(backlog[0]?.prompt).toContain("specification.md");
		expect(backlog[0]?.prompt).toContain('defaultAcceptanceCommand: "npm test"');
		expect(backlog[0]?.prompt).not.toContain("Create reviewable !Klein tasks");
		expect(board.dependencies).toHaveLength(0);
	});
});

describe("self-improvement project creation", () => {
	const previousNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		if (previousNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
	});

	it("requires explicit self-project confirmation", async () => {
		process.env.NODE_ENV = "development";
		const cleanupCwd = createTestCwd();
		try {
			await withTemporaryHome(async () => {
				initGitRepository(cleanupCwd);
				commitAll(cleanupCwd, "Initial self project");
				const deps = createDefaultDeps(cleanupCwd);
				deps.hasGitRepository = vi.fn(() => true);
				const api = createProjectsApi(deps);

				const result = await api.createSelfImprovementProject(null, {});

				expect(result.ok).toBe(false);
				expect(result.requiresSelfProjectConfirmation).toBe(true);
				expect(deps.setActiveWorkspace).not.toHaveBeenCalled();
			});
		} finally {
			rmSync(cleanupCwd, { recursive: true, force: true });
		}
	});

	it("loads the running dev checkout and seeds an evidence-backed Cline task", async () => {
		process.env.NODE_ENV = "development";
		const cleanupCwd = createTestCwd();
		try {
			await withTemporaryHome(async () => {
				writeFileSync(join(cleanupCwd, "README.md"), "# self\n", "utf8");
				initGitRepository(cleanupCwd);
				commitAll(cleanupCwd, "Initial self project");
				const evidenceBaseCommit = getGitHead(cleanupCwd);
				const evidenceBundlePath = join(cleanupCwd, "evidence", "self-task");
				mkdirSync(evidenceBundlePath, { recursive: true });
				writeFileSync(
					join(evidenceBundlePath, "config-snapshot.json"),
					JSON.stringify({ baseCommit: evidenceBaseCommit }),
					"utf8",
				);
				const deps = createDefaultDeps(cleanupCwd);
				deps.hasGitRepository = vi.fn(() => true);
				const api = createProjectsApi(deps);

				const result = await api.createSelfImprovementProject(null, {
					confirmSelfProject: true,
					notes: "Focus on local model reliability.",
					evidenceBundlePath,
				});

				expect(result.ok).toBe(true);
				expect(result.source).toBe("current_dev_checkout");
				expect(result.workspacePath ? realpathSync(result.workspacePath) : null).toBe(realpathSync(cleanupCwd));
				expect(result.task?.agentId).toBe("cline");
				expect(result.task?.startInPlanMode).toBe(true);
				expect(result.task?.autoReviewEnabled).toBe(true);
				expect(result.task?.generatedFromPlan).toEqual({
					artifactKind: "spec",
					planSlug: "self-improvement-current-dev-checkout",
					planTaskId: "seed-self-improvement-task",
					sourceTaskId: null,
				});
				expect(result.task?.prompt).toContain("Current dev checkout");
				expect(result.task?.prompt).toContain("Focus on local model reliability.");
				expect(result.task?.prompt).toContain(evidenceBundlePath);
				expect(result.task?.baseRef).toBe(evidenceBaseCommit);
				expect(result.task?.filesLikelyTouched).toEqual([
					evidenceBundlePath,
					"follow-up-3-by-opus4.8-ultracode.md",
				]);
				const state = await loadWorkspaceState(cleanupCwd);
				const backlog = state.board.columns.find((column) => column.id === "backlog")?.cards ?? [];
				expect(backlog[0]?.id).toBe(result.task?.id);
				expect(backlog[0]?.baseRef).toBe(evidenceBaseCommit);
				expect(deps.setActiveWorkspace).toHaveBeenCalled();
			});
		} finally {
			rmSync(cleanupCwd, { recursive: true, force: true });
		}
	});
});

describe("dev-test project cleanup", () => {
	const previousNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		if (previousNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
	});

	it("removes only marked dev-test projects and their scoped stale patches", async () => {
		process.env.NODE_ENV = "development";
		const cleanupCwd = createTestCwd();
		try {
			await withTemporaryHome(async () => {
				const deps = createDefaultDeps(cleanupCwd);
				const api = createProjectsApi(deps);

				const marked = await api.createDevTestProject(null, { preset: "mid_task" });
				expect(marked.ok).toBe(true);
				if (!marked.workspacePath) {
					throw new Error("Expected marked dev-test workspace path.");
				}
				const markedWorkspacePath = marked.workspacePath;

				const unmarkedPath = join(cleanupCwd, `kanban-habit-lookalike-${Date.now()}`);
				mkdirSync(unmarkedPath, { recursive: true });
				initGitRepository(unmarkedPath);
				await loadWorkspaceContext(unmarkedPath, { gitRepositoryCreatedByKanban: true });

				const patchesDir = join(process.env.HOME ?? cleanupCwd, ".cline", "nklein", "trashed-task-patches");
				mkdirSync(patchesDir, { recursive: true });
				const markedPatchPath = join(patchesDir, `stale-task.${getPatchRepoKey(markedWorkspacePath)}.abc123.patch`);
				writeFileSync(markedPatchPath, "diff --git a/a b/a\n", "utf8");
				const unmarkedPatchPath = join(patchesDir, `stale-task.${getPatchRepoKey(unmarkedPath)}.abc123.patch`);
				writeFileSync(unmarkedPatchPath, "diff --git a/a b/a\n", "utf8");

				const cleanup = await api.cleanupDevTestProjects(null);

				expect(cleanup.ok).toBe(true);
				expect(cleanup.removedProjects).toBe(1);
				const remainingEntries = await listWorkspaceIndexEntries();
				expect(remainingEntries).toHaveLength(1);
				expect(realpathSync(remainingEntries[0]?.repoPath ?? "")).toBe(realpathSync(unmarkedPath));
				expect(() => realpathSync(markedWorkspacePath)).toThrow();
				expect(existsSync(unmarkedPath)).toBe(true);
				expect(() => realpathSync(markedPatchPath)).toThrow();
				expect(existsSync(unmarkedPatchPath)).toBe(true);
			});
		} finally {
			rmSync(cleanupCwd, { recursive: true, force: true });
		}
	});

	it("reports partial cleanup failures instead of claiming success", async () => {
		process.env.NODE_ENV = "development";
		const cleanupCwd = createTestCwd();
		try {
			await withTemporaryHome(async () => {
				const api = createProjectsApi(createDefaultDeps(cleanupCwd));

				const marked = await api.createDevTestProject(null, { preset: "mid_task" });
				expect(marked.ok).toBe(true);
				if (!marked.workspacePath) {
					throw new Error("Expected marked dev-test workspace path.");
				}
				const markedWorkspacePath = marked.workspacePath;
				const markedEntry = (await listWorkspaceIndexEntries()).find(
					(entry) => realpathSync(entry.repoPath) === realpathSync(markedWorkspacePath),
				);
				if (!markedEntry) {
					throw new Error("Expected marked workspace index entry.");
				}
				writeFileSync(join(getWorkspaceDirectoryPath(markedEntry.workspaceId), "board.json"), "{not-json", "utf8");

				const cleanup = await api.cleanupDevTestProjects(null);

				expect(cleanup.ok).toBe(false);
				expect(
					cleanup.errors.some((error) => error.includes(`Could not read board for ${markedEntry.workspaceId}`)),
				).toBe(true);
				expect(cleanup.error).toBe(cleanup.errors[0]);
			});
		} finally {
			rmSync(cleanupCwd, { recursive: true, force: true });
		}
	});
});

describe("accidental task-worktree project recovery", () => {
	it("copies misplaced plan artifacts to the detected parent project by explicit request", async () => {
		const cleanupCwd = createTestCwd();
		try {
			await withTemporaryHome(async () => {
				const api = createProjectsApi(createDefaultDeps(cleanupCwd));
				const parentPath = join(cleanupCwd, "parent-project");
				const worktreePath = join(
					process.env.HOME ?? cleanupCwd,
					".cline",
					"worktrees",
					"source-card",
					"parent-project",
				);
				mkdirSync(parentPath, { recursive: true });
				mkdirSync(worktreePath, { recursive: true });
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
										title: "Source card",
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
					sessions: {},
				});
				const accidental = await loadWorkspaceContext(worktreePath, { allowTaskWorktreeProject: true });
				await writeClinePlanArtifacts({
					workspacePath: worktreePath,
					workspaceId: accidental.workspaceId,
					sourceTaskId: "source-card",
					slug: "misplaced-plan",
					spec: "# Spec",
					plan: "# Plan",
					taskGraph: {
						schemaVersion: 1,
						slug: "misplaced-plan",
						title: "Misplaced Plan",
						tasks: [
							{
								id: "generated-task",
								title: "Generated task",
								prompt: "Do work.",
								dependsOn: [],
								complexity: 20,
								suggestedRole: null,
								filesLikelyTouched: [],
								acceptanceCommand: null,
								testFirst: false,
								acceptanceTestPrompt: null,
							},
						],
					},
				});

				const migrated = await api.migrateAccidentalProjectArtifacts(null, { projectId: accidental.workspaceId });

				expect(migrated.ok).toBe(true);
				expect(migrated.migratedArtifacts).toBe(1);
				expect(migrated.parentWorkspaceId).toBe(parent.workspaceId);
				const migratedMetadataPath = join(
					parentPath,
					".cline",
					"nklein",
					"plans",
					"misplaced-plan",
					"artifact.json",
				);
				expect(existsSync(migratedMetadataPath)).toBe(true);
				const metadata = JSON.parse(readFileSync(migratedMetadataPath, "utf8")) as {
					workspaceId?: unknown;
					workspacePath?: unknown;
					sourceTaskId?: unknown;
				};
				expect(metadata.workspaceId).toBe(parent.workspaceId);
				expect(metadata.workspacePath).toBe(parent.repoPath);
				expect(metadata.sourceTaskId).toBe("source-card");
				const remainingEntries = await listWorkspaceIndexEntries();
				expect(remainingEntries.some((entry) => entry.workspaceId === accidental.workspaceId)).toBe(true);
			});
		} finally {
			rmSync(cleanupCwd, { recursive: true, force: true });
		}
	});
});

describe("listDirectoryContents", () => {
	let testCwd: string;
	let filesystemRoot: string;

	beforeEach(() => {
		testCwd = createTestCwd();
		filesystemRoot = resolve(testCwd, "/");
	});

	afterEach(() => {
		rmSync(testCwd, { recursive: true, force: true });
	});

	it("returns filesystem root when path is empty", async () => {
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, {});
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(filesystemRoot);
		expect(result.parentPath).toBeNull();
		expect(result.rootPath).toBe(filesystemRoot);
	});

	it("returns filesystem root when path is undefined (no path key)", async () => {
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: undefined });
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(filesystemRoot);
		expect(result.rootPath).toBe(filesystemRoot);
	});

	it("returns contents for a valid absolute path", async () => {
		const subdir = join(testCwd, "sub");
		mkdirSync(subdir);
		mkdirSync(join(subdir, "child-a"));
		mkdirSync(join(subdir, "child-b"));
		writeFileSync(join(subdir, "file.txt"), "content");
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: subdir });
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(subdir);
		expect(result.parentPath).toBe(testCwd);
		expect(result.entries).toHaveLength(2);
		expect(result.entries.map((e) => e.name)).toEqual(["child-a", "child-b"]);
	});

	it("allows browsing paths outside the launch directory", async () => {
		const siblingDir = join(dirname(testCwd), `kanban-sibling-${Date.now()}`);
		mkdirSync(siblingDir, { recursive: true });
		mkdirSync(join(siblingDir, "inside"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: siblingDir });
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(siblingDir);
		expect(result.entries.map((e) => e.name)).toContain("inside");
		rmSync(siblingDir, { recursive: true, force: true });
	});

	it("returns subdirectory contents for another valid absolute path", async () => {
		const subdir = join(testCwd, "abs-sub");
		mkdirSync(subdir);
		mkdirSync(join(subdir, "inside"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: subdir });
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(subdir);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]?.name).toBe("inside");
	});

	it("detects git repositories via .git directory", async () => {
		mkdirSync(join(testCwd, "my-repo", ".git"), { recursive: true });
		mkdirSync(join(testCwd, "not-a-repo"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: testCwd });
		expect(result.ok).toBe(true);
		const repoEntry = result.entries.find((e) => e.name === "my-repo");
		const nonRepoEntry = result.entries.find((e) => e.name === "not-a-repo");
		expect(repoEntry?.isGitRepository).toBe(true);
		expect(nonRepoEntry?.isGitRepository).toBe(false);
	});

	it("excludes hidden directories (starting with .)", async () => {
		mkdirSync(join(testCwd, ".hidden"));
		mkdirSync(join(testCwd, "visible"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: testCwd });
		expect(result.ok).toBe(true);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]?.name).toBe("visible");
	});

	it("sorts entries alphabetically", async () => {
		mkdirSync(join(testCwd, "zebra"));
		mkdirSync(join(testCwd, "apple"));
		mkdirSync(join(testCwd, "mango"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: testCwd });
		expect(result.ok).toBe(true);
		expect(result.entries.map((e) => e.name)).toEqual(["apple", "mango", "zebra"]);
	});

	it("returns empty entries for a directory with no subdirectories", async () => {
		writeFileSync(join(testCwd, "file1.txt"), "data");
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: testCwd });
		expect(result.ok).toBe(true);
		expect(result.entries).toEqual([]);
	});

	it("allows absolute paths within the filesystem root", async () => {
		const subdir = join(testCwd, "abs-allowed");
		mkdirSync(subdir);
		mkdirSync(join(subdir, "nested"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: subdir });
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(subdir);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]?.name).toBe("nested");
	});

	it("allows absolute path equal to rootPath", async () => {
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: filesystemRoot });
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(filesystemRoot);
	});

	it("keeps traversal bounded at filesystem root", async () => {
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, {
			path: "../../../../../../../../..",
		});
		expect(result.ok).toBe(true);
		expect(result.currentPath).toBe(filesystemRoot);
	});

	it("parentPath is null when at filesystem root", async () => {
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, {});
		expect(result.ok).toBe(true);
		expect(result.parentPath).toBeNull();
	});

	it("parentPath points to launch directory when one level deep under it", async () => {
		mkdirSync(join(testCwd, "level1"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: join(testCwd, "level1") });
		expect(result.ok).toBe(true);
		expect(result.parentPath).toBe(testCwd);
	});

	it("parentPath correctly chains when deeply nested", async () => {
		mkdirSync(join(testCwd, "a", "b", "c"), { recursive: true });
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: join(testCwd, "a", "b", "c") });
		expect(result.ok).toBe(true);
		expect(result.parentPath).toBe(join(testCwd, "a", "b"));
	});

	// ── Error handling ──────────────────────────────────────

	it("returns error for non-existent directory", async () => {
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: join(testCwd, "does-not-exist") });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Directory not found.");
		expect(result.entries).toEqual([]);
	});

	it("returns error when path points to a file", async () => {
		writeFileSync(join(testCwd, "a-file.txt"), "hello");
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: join(testCwd, "a-file.txt") });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("The specified path is not a directory.");
	});

	// ── Schema validation ───────────────────────────────────

	it("success response validates against the schema", async () => {
		const { runtimeDirectoryListResponseSchema } = await import("../../../src/core/api-contract");
		mkdirSync(join(testCwd, "valid-dir"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: testCwd });
		expect(runtimeDirectoryListResponseSchema.safeParse(result).success).toBe(true);
	});

	it("error response validates against the schema", async () => {
		const { runtimeDirectoryListResponseSchema } = await import("../../../src/core/api-contract");
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: join(testCwd, "does-not-exist") });
		expect(runtimeDirectoryListResponseSchema.safeParse(result).success).toBe(true);
	});

	// ── Misc ────────────────────────────────────────────────

	it("includes rootPath in every response", async () => {
		mkdirSync(join(testCwd, "sub"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		expect((await api.listDirectoryContents(null, {})).rootPath).toBe(filesystemRoot);
		expect((await api.listDirectoryContents(null, { path: testCwd })).rootPath).toBe(filesystemRoot);
		expect((await api.listDirectoryContents(null, { path: join(testCwd, "sub") })).rootPath).toBe(filesystemRoot);
	});

	it("entry paths are absolute", async () => {
		mkdirSync(join(testCwd, "my-project"));
		const api = createProjectsApi(createDefaultDeps(testCwd));
		const result = await api.listDirectoryContents(null, { path: testCwd });
		expect(result.ok).toBe(true);
		expect(result.entries[0]?.path).toBe(join(testCwd, "my-project"));
	});
});

describe("addProject", () => {
	let testCwd: string;

	beforeEach(() => {
		testCwd = createTestCwd();
	});

	afterEach(() => {
		rmSync(testCwd, { recursive: true, force: true });
	});

	it("backward compat: accepts a path-only request", async () => {
		const deps = createDefaultDeps(testCwd);
		(deps.hasGitRepository as ReturnType<typeof vi.fn>).mockReturnValue(true);
		const api = createProjectsApi(deps);
		const result = await api.addProject(null, { path: testCwd });
		// The existing flow runs; we're verifying it doesn't throw on path-only input.
		// Since loadWorkspaceContext is a real call that needs a git repo, the catch
		// block will handle it. The important thing is no schema-level crash.
		expect(typeof result.ok).toBe("boolean");
	});

	it("rejects request with neither path nor gitUrl", async () => {
		const deps = createDefaultDeps(testCwd);
		const api = createProjectsApi(deps);
		await expect(api.addProject(null, {})).rejects.toThrow();
	});

	it("resolves clone destination relative to serverCwd, not the active project", async () => {
		const activeProjectPath = join(testCwd, "active-project");
		mkdirSync(activeProjectPath);
		const deps = createDefaultDeps(testCwd);
		(deps.getActiveWorkspacePath as ReturnType<typeof vi.fn>).mockReturnValue(activeProjectPath);
		const api = createProjectsApi(deps);
		// The clone itself will fail (no real git server), but we can verify
		// that resolveProjectInputPath was called with serverCwd as the base.
		await api.addProject(null, { gitUrl: "https://example.com/repo.git", path: "my-new-proj" });
		const resolveSpy = deps.resolveProjectInputPath as ReturnType<typeof vi.fn>;
		expect(resolveSpy).toHaveBeenCalledWith("my-new-proj", testCwd);
		// Crucially, it must NOT have been called with the active project path:
		expect(resolveSpy).not.toHaveBeenCalledWith("my-new-proj", activeProjectPath);
	});

	it("requires confirmation before adding the !Klein source repo as a project", async () => {
		await withTemporaryHome(async () => {
			const sourceRepoPath = join(testCwd, "kanban-source");
			mkdirSync(sourceRepoPath, { recursive: true });
			initGitRepository(sourceRepoPath);
			const deps = createDefaultDeps(sourceRepoPath);
			(deps.hasGitRepository as ReturnType<typeof vi.fn>).mockReturnValue(true);
			const api = createProjectsApi(deps);

			const firstResult = await api.addProject(null, { path: sourceRepoPath });
			expect(firstResult.ok).toBe(false);
			expect(firstResult.requiresSelfProjectConfirmation).toBe(true);
			expect(await listWorkspaceIndexEntries()).toHaveLength(0);

			const confirmedResult = await api.addProject(null, {
				path: sourceRepoPath,
				confirmSelfProject: true,
			});
			expect(confirmedResult.ok).toBe(true);
			expect(confirmedResult.project).not.toBeNull();
			expect(await listWorkspaceIndexEntries()).toHaveLength(1);
		});
	});

	it("does not add task worktree paths as standalone projects without the advanced override", async () => {
		await withTemporaryHome(async () => {
			const sourceRepoPath = join(testCwd, "source");
			mkdirSync(sourceRepoPath, { recursive: true });
			initGitRepository(sourceRepoPath);
			const worktreePath = join(getTaskWorktreesHomePath(), "task-123", "source");
			mkdirSync(worktreePath, { recursive: true });
			initGitRepository(worktreePath);
			const deps = createDefaultDeps(sourceRepoPath);
			(deps.hasGitRepository as ReturnType<typeof vi.fn>).mockReturnValue(true);
			const api = createProjectsApi(deps);

			const result = await api.addProject(null, { path: worktreePath });
			expect(result.ok).toBe(false);
			expect(result.requiresTaskWorktreeProjectConfirmation).toBe(true);
			expect(await listWorkspaceIndexEntries()).toHaveLength(0);
		});
	});
});
