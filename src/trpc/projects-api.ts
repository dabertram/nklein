import { randomUUID } from "node:crypto";
import { cp, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	CLINE_DEV_TEST_PROJECT_MARKER_PATH,
	resolveClineDevTestProjectScenario,
	scaffoldClineDevTestProject,
} from "../cline-sdk/cline-dev-test-project";
import { loadRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeBoardData,
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectRequest,
	RuntimeDevTestProjectResponse,
	RuntimeDirectoryListResponse,
	RuntimeModelRoles,
	RuntimeProjectAddResponse,
	RuntimeProjectArtifactMigrationResponse,
	RuntimeProjectHealthIssue,
	RuntimeProjectSummary,
	RuntimeProjectTaskCounts,
	RuntimeSelfImprovementProjectRequest,
	RuntimeSelfImprovementProjectResponse,
	RuntimeTaskClineSettings,
} from "../core/api-contract";
import {
	parseDirectoryListRequest,
	parseProjectAddRequest,
	parseProjectArtifactMigrationRequest,
	parseProjectRemoveRequest,
	parseSelfImprovementProjectRequest,
} from "../core/api-validation";
import { addTaskToColumn } from "../core/task-board-mutations";
import { lockedFileSystem } from "../fs/locked-file-system";
import {
	getCanonicalTaskWorktreesHomePath,
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
	resolveWorkspacePath,
	saveWorkspaceState,
} from "../state/workspace-state";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { cloneGitRepository } from "../workspace/git-clone";
import {
	ensureInitialCommit,
	initializeGitRepository,
	isGitRepositoryCreatedByKanban,
	markGitRepositoryCreatedByKanban,
} from "../workspace/initialize-repo";
import { isPathWithinRoot } from "../workspace/path-sandbox";
import { detectProjectHealthIssuesByWorkspaceId } from "../workspace/project-health";
import { deleteTaskPatchFilesForRepo, deleteTaskWorktree } from "../workspace/task-worktree";
import { isPathInsideTaskWorktreesHome } from "../workspace/task-worktree-path";
import type { RuntimeTrpcContext } from "./app-router";

interface DisposeWorkspaceOptions {
	stopTerminalSessions?: boolean;
}

const DEV_TEST_TASK_ID = "dev-habit-insights-mid";
async function isMarkedDevTestWorkspaceEntry(entry: {
	workspaceId: string;
	repoPath: string;
	gitRepositoryCreatedByKanban: boolean;
}): Promise<boolean> {
	if (!entry.gitRepositoryCreatedByKanban) {
		return false;
	}
	try {
		const rawMarker = await readFile(join(entry.repoPath, CLINE_DEV_TEST_PROJECT_MARKER_PATH), "utf8");
		const parsed = JSON.parse(rawMarker) as { createdBy?: unknown };
		return parsed.createdBy === "nklein-dev-test";
	} catch {
		return false;
	}
}

async function resolveGitRootIfAvailable(path: string): Promise<string | null> {
	try {
		return await resolveWorkspacePath(path);
	} catch {
		return null;
	}
}

export function createDevTestBoard(input: {
	taskId: string;
	title: string;
	prompt: string;
	acceptanceCommand: string;
	modelRoles?: RuntimeModelRoles;
	now: number;
}): RuntimeBoardData {
	const workerSettings = input.modelRoles?.worker;
	const firstRoleSettings = Object.values(input.modelRoles ?? {}).find(
		(settings): settings is RuntimeTaskClineSettings => Boolean(settings.providerId || settings.modelId),
	);
	const clineSettings = workerSettings ?? firstRoleSettings;
	const card = {
		id: input.taskId,
		title: `Decompose ${input.title}`,
		prompt: input.prompt,
		startInPlanMode: true,
		autoReviewEnabled: true,
		agentId: "cline" as const,
		...(clineSettings ? { clineSettings } : {}),
		baseRef: "main",
		createdAt: input.now,
		updatedAt: input.now,
	};
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [card] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function buildSelfImprovementTaskPrompt(input: {
	workspacePath: string;
	notes?: string | null;
	evidenceBundlePath?: string | null;
}): string {
	const lines = [
		"/nklein-ts",
		"",
		"Improve !Klein using the currently running development checkout.",
		"",
		"Source:",
		`- Current dev checkout: ${input.workspacePath}`,
		"",
		"Main driver:",
		"- Keep improving support for small local LLMs on limited hardware.",
		"- Preserve the local-only, forward-moving fork direction.",
		"- Keep protected-test guardrails intact; do not weaken protected tests without explicit human approval.",
	];
	if (input.evidenceBundlePath?.trim()) {
		lines.push("", "Evidence:", `- Bundle: ${input.evidenceBundlePath.trim()}`);
	}
	if (input.notes?.trim()) {
		lines.push("", "User notes:", input.notes.trim());
	}
	lines.push(
		"",
		"Acceptance:",
		"- Make the smallest coherent improvement that addresses the evidence or notes.",
		"- Add or update focused tests.",
		"- Run the relevant focused checks and report exact commands/results.",
	);
	return lines.join("\n");
}

async function readEvidenceBundleBaseCommit(evidenceBundlePath: string | null | undefined): Promise<string | null> {
	const bundlePath = evidenceBundlePath?.trim();
	if (!bundlePath) {
		return null;
	}
	try {
		const raw = await readFile(join(bundlePath, "config-snapshot.json"), "utf8");
		const parsed = JSON.parse(raw) as { baseCommit?: unknown };
		const baseCommit = typeof parsed.baseCommit === "string" ? parsed.baseCommit.trim() : "";
		return /^[0-9a-f]{7,40}$/iu.test(baseCommit) ? baseCommit : null;
	} catch {
		return null;
	}
}

export interface CreateProjectsApiDependencies {
	getActiveWorkspacePath: () => string | null;
	getActiveWorkspaceId: () => string | null;
	rememberWorkspace: (workspaceId: string, repoPath: string) => void;
	setActiveWorkspace: (workspaceId: string, repoPath: string) => Promise<void>;
	clearActiveWorkspace: () => void;
	resolveProjectInputPath: (inputPath: string, cwd: string) => string;
	assertPathIsDirectory: (path: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	summarizeProjectTaskCounts: (workspaceId: string, repoPath: string) => Promise<RuntimeProjectTaskCounts>;
	createProjectSummary: (project: {
		workspaceId: string;
		repoPath: string;
		taskCounts: RuntimeProjectTaskCounts;
		gitRepositoryCreatedByKanban: boolean;
		healthIssues?: RuntimeProjectHealthIssue[];
	}) => RuntimeProjectSummary;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void> | void;
	getTerminalManagerForWorkspace: (workspaceId: string) => TerminalSessionManager | null;
	disposeWorkspace: (
		workspaceId: string,
		options?: DisposeWorkspaceOptions,
	) => { terminalManager: TerminalSessionManager | null; workspacePath: string | null };
	collectProjectWorktreeTaskIdsForRemoval: (board: RuntimeBoardData) => Set<string>;
	warn: (message: string) => void;
	buildProjectsPayload: (preferredCurrentProjectId: string | null) => Promise<{
		currentProjectId: string | null;
		projects: RuntimeProjectSummary[];
	}>;
	pickDirectoryPathFromSystemDialog: () => string | null;
	serverCwd: string;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function listPlanArtifactDirectoryNames(workspacePath: string): Promise<string[]> {
	const plansPath = join(workspacePath, ".cline", "nklein", "plans");
	const entries = await readdir(plansPath, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

async function updateMigratedArtifactMetadata(input: {
	artifactPath: string;
	parentWorkspaceId: string;
	parentWorkspacePath: string;
	sourceTaskId: string | null;
}): Promise<void> {
	const metadataPath = join(input.artifactPath, "artifact.json");
	const raw = await readFile(metadataPath, "utf8").catch(() => null);
	if (!raw) {
		return;
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!isJsonRecord(parsed)) {
		return;
	}
	const metadata = {
		...parsed,
		workspaceId: input.parentWorkspaceId,
		workspacePath: input.parentWorkspacePath,
		sourceTaskId:
			typeof parsed.sourceTaskId === "string" && parsed.sourceTaskId.trim()
				? parsed.sourceTaskId
				: input.sourceTaskId,
		updatedAt: Date.now(),
	};
	await lockedFileSystem.writeJsonFileAtomic(metadataPath, metadata, { lock: null });
}

export function createProjectsApi(deps: CreateProjectsApiDependencies): RuntimeTrpcContext["projectsApi"] {
	const filesystemRoot = resolve(deps.serverCwd, "/");

	return {
		listProjects: async (preferredWorkspaceId) => {
			const payload = await deps.buildProjectsPayload(preferredWorkspaceId);
			return {
				currentProjectId: payload.currentProjectId,
				projects: payload.projects,
			};
		},
		addProject: async (preferredWorkspaceId, input) => {
			const body = parseProjectAddRequest(input);
			const preferredWorkspaceContext = preferredWorkspaceId
				? await loadWorkspaceContextById(preferredWorkspaceId)
				: null;
			const resolveBasePath = preferredWorkspaceContext?.repoPath ?? deps.getActiveWorkspacePath() ?? process.cwd();
			try {
				let projectPath: string;
				let gitRepositoryCreatedByKanban = false;
				if (body.gitUrl) {
					// Clone from Git URL. If a custom path is provided alongside
					// gitUrl, use it as the clone destination. Otherwise derive
					// a destination from the URL.
					// Resolve relative to serverCwd (the default clone base), not the
					// active project — the clone target belongs under the kanban
					// working directory, not inside another project.
					const customDest = body.path ? deps.resolveProjectInputPath(body.path, deps.serverCwd) : undefined;
					const cloneResult = await cloneGitRepository(body.gitUrl, deps.serverCwd, customDest, filesystemRoot, {
						ref: body.ref,
					});
					if (!cloneResult.ok) {
						return {
							ok: false,
							project: null,
							error: cloneResult.error ?? "Git clone failed.",
						} satisfies RuntimeProjectAddResponse;
					}
					projectPath = cloneResult.clonedPath;
					const markerResult = await markGitRepositoryCreatedByKanban(projectPath);
					if (!markerResult.ok) {
						return {
							ok: false,
							project: null,
							error: markerResult.error ?? "Failed to record Git repository ownership.",
						} satisfies RuntimeProjectAddResponse;
					}
					gitRepositoryCreatedByKanban = true;
				} else {
					// path is guaranteed to exist here by the schema refine and the gitUrl branch above.
					projectPath = deps.resolveProjectInputPath(body.path as string, resolveBasePath);
				}
				await deps.assertPathIsDirectory(projectPath);
				if (!deps.hasGitRepository(projectPath)) {
					if (!body.initializeGit) {
						return {
							ok: false,
							project: null,
							requiresGitInitialization: true,
							error: "This folder is not a git repository. Cline requires git to manage worktrees. Initialize git to continue.",
						} satisfies RuntimeProjectAddResponse;
					}
					const initResult = await initializeGitRepository(projectPath);
					if (!initResult.ok) {
						return {
							ok: false,
							project: null,
							error: initResult.error ?? "Failed to initialize git repository.",
						} satisfies RuntimeProjectAddResponse;
					}
					gitRepositoryCreatedByKanban = true;
				} else {
					gitRepositoryCreatedByKanban = await isGitRepositoryCreatedByKanban(projectPath);
					const commitResult = await ensureInitialCommit(projectPath);
					if (!commitResult.ok) {
						return {
							ok: false,
							project: null,
							error: commitResult.error ?? "Failed to ensure initial commit.",
						} satisfies RuntimeProjectAddResponse;
					}
				}
				const candidateRepoPath = await resolveWorkspacePath(projectPath);
				if (
					isPathInsideTaskWorktreesHome(candidateRepoPath, await getCanonicalTaskWorktreesHomePath()) &&
					body.allowTaskWorktreeProject !== true
				) {
					return {
						ok: false,
						project: null,
						requiresTaskWorktreeProjectConfirmation: true,
						error: "That folder is a Kanban task worktree. Add the owning parent project instead, or use an advanced task-worktree project flow.",
					} satisfies RuntimeProjectAddResponse;
				}
				const sourceRepoPath = await resolveGitRootIfAvailable(deps.serverCwd);
				if (sourceRepoPath && sourceRepoPath === candidateRepoPath && body.confirmSelfProject !== true) {
					return {
						ok: false,
						project: null,
						requiresSelfProjectConfirmation: true,
						error: "This is Kanban's own source repository. Loading it as a project is a self-improvement workflow and needs confirmation.",
					} satisfies RuntimeProjectAddResponse;
				}
				const context = await loadWorkspaceContext(projectPath, {
					gitRepositoryCreatedByKanban,
					allowTaskWorktreeProject: body.allowTaskWorktreeProject === true,
				});
				deps.rememberWorkspace(context.workspaceId, context.repoPath);
				const projectsAfterAdd = await listWorkspaceIndexEntries();
				const activeWorkspaceId = deps.getActiveWorkspaceId();
				const hasActiveWorkspace = activeWorkspaceId
					? projectsAfterAdd.some((project) => project.workspaceId === activeWorkspaceId)
					: false;
				if (!hasActiveWorkspace) {
					await deps.setActiveWorkspace(context.workspaceId, context.repoPath);
				}
				const taskCounts = await deps.summarizeProjectTaskCounts(context.workspaceId, context.repoPath);
				void deps.broadcastRuntimeProjectsUpdated(context.workspaceId);
				return {
					ok: true,
					project: deps.createProjectSummary({
						workspaceId: context.workspaceId,
						repoPath: context.repoPath,
						taskCounts,
						gitRepositoryCreatedByKanban: context.gitRepositoryCreatedByKanban === true,
					}),
				} satisfies RuntimeProjectAddResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					project: null,
					error: message,
				} satisfies RuntimeProjectAddResponse;
			}
		},
		createDevTestProject: async (
			_preferredWorkspaceId,
			input?: RuntimeDevTestProjectRequest,
		): Promise<RuntimeDevTestProjectResponse> => {
			if (process.env.NODE_ENV !== "development") {
				return {
					ok: false,
					project: null,
					task: null,
					tasks: [],
					scenario: null,
					workspacePath: null,
					evidenceRootPath: null,
					error: "Dev test projects are only available when NODE_ENV=development.",
				};
			}
			try {
				const preset = input?.preset ?? "mid_task";
				const scenario = resolveClineDevTestProjectScenario(preset);
				const scaffolded = await scaffoldClineDevTestProject({
					scenario,
					initializeGit: true,
				});
				const context = await loadWorkspaceContext(scaffolded.workspacePath, {
					gitRepositoryCreatedByKanban: true,
				});
				deps.rememberWorkspace(context.workspaceId, context.repoPath);
				await deps.setActiveWorkspace(context.workspaceId, context.repoPath);

				const now = Date.now();
				const runtimeConfig = await loadRuntimeConfig(context.repoPath);
				const board = createDevTestBoard({
					taskId: DEV_TEST_TASK_ID,
					title: scenario.title,
					prompt: scenario.prompt,
					acceptanceCommand: scenario.acceptanceCommand,
					modelRoles: runtimeConfig.modelRoles,
					now,
				});
				const state = await saveWorkspaceState(context.repoPath, {
					board,
					sessions: {},
				});
				const evidenceBundle = await createEvidenceBundle({
					scenario: scenario.id,
					startedAt: now,
					finishedAt: now,
					outcome: "unknown",
					summary:
						"Visible Kanban dev scenario scaffolded. Start the seeded decomposition task in the UI to exercise the normal planning and task-graph pipeline.",
					metrics: [
						{ label: "workspace", value: context.repoPath },
						{
							label: "seeded initial tasks",
							value: board.columns.find((column) => column.id === "backlog")?.cards.length ?? 0,
						},
						{ label: "acceptance command", value: scenario.acceptanceCommand },
					],
					configSnapshot: {
						workspaceId: context.workspaceId,
						workspacePath: context.repoPath,
						scenario,
						board,
					},
					evalResult: {
						status: "skipped",
						command: scenario.acceptanceCommand,
					},
				});
				const tasks = state.board.columns.find((column) => column.id === "backlog")?.cards ?? [];
				const task = tasks[0] ?? null;
				const taskCounts = await deps.summarizeProjectTaskCounts(context.workspaceId, context.repoPath);
				const project = deps.createProjectSummary({
					workspaceId: context.workspaceId,
					repoPath: context.repoPath,
					taskCounts,
					gitRepositoryCreatedByKanban: true,
				});
				void deps.broadcastRuntimeProjectsUpdated(context.workspaceId);
				return {
					ok: true,
					project,
					task,
					tasks,
					scenario: {
						id: scenario.id,
						title: scenario.title,
						prompt: scenario.prompt,
						acceptanceCommand: scenario.acceptanceCommand,
						complexity: scenario.complexity ?? null,
						filesLikelyTouched: scenario.filesLikelyTouched ?? [],
					},
					workspacePath: context.repoPath,
					evidenceRootPath: evidenceBundle.bundlePath,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					project: null,
					task: null,
					tasks: [],
					scenario: null,
					workspacePath: null,
					evidenceRootPath: null,
					error: message,
				};
			}
		},
		createSelfImprovementProject: async (
			_preferredWorkspaceId,
			input?: RuntimeSelfImprovementProjectRequest,
		): Promise<RuntimeSelfImprovementProjectResponse> => {
			if (process.env.NODE_ENV !== "development") {
				return {
					ok: false,
					project: null,
					task: null,
					workspacePath: null,
					source: null,
					error: "Self-improvement projects are only available when NODE_ENV=development.",
				};
			}
			const body = parseSelfImprovementProjectRequest(input);
			if (body?.confirmSelfProject !== true) {
				return {
					ok: false,
					project: null,
					task: null,
					workspacePath: null,
					source: "current_dev_checkout",
					requiresSelfProjectConfirmation: true,
					error: "Creating a !Klein self-improvement project needs confirmation.",
				};
			}
			try {
				const sourceRepoPath = await resolveGitRootIfAvailable(deps.serverCwd);
				if (!sourceRepoPath) {
					return {
						ok: false,
						project: null,
						task: null,
						workspacePath: null,
						source: "current_dev_checkout",
						error: "Could not resolve the currently running development checkout.",
					};
				}
				await deps.assertPathIsDirectory(sourceRepoPath);
				if (!deps.hasGitRepository(sourceRepoPath)) {
					return {
						ok: false,
						project: null,
						task: null,
						workspacePath: sourceRepoPath,
						source: "current_dev_checkout",
						error: "The currently running checkout is not a git repository.",
					};
				}
				const commitResult = await ensureInitialCommit(sourceRepoPath);
				if (!commitResult.ok) {
					return {
						ok: false,
						project: null,
						task: null,
						workspacePath: sourceRepoPath,
						source: "current_dev_checkout",
						error: commitResult.error ?? "Failed to ensure initial commit.",
					};
				}
				const gitRepositoryCreatedByKanban = await isGitRepositoryCreatedByKanban(sourceRepoPath);
				const context = await loadWorkspaceContext(sourceRepoPath, {
					gitRepositoryCreatedByKanban,
				});
				deps.rememberWorkspace(context.workspaceId, context.repoPath);
				await deps.setActiveWorkspace(context.workspaceId, context.repoPath);

				const state = await loadWorkspaceState(context.repoPath);
				const evidenceBaseCommit = await readEvidenceBundleBaseCommit(body?.evidenceBundlePath);
				const baseRef =
					evidenceBaseCommit ??
					state.git.currentBranch ??
					state.git.defaultBranch ??
					state.git.branches[0] ??
					"HEAD";
				const now = Date.now();
				const created = addTaskToColumn(
					state.board,
					"backlog",
					{
						title: "Improve !Klein from current evidence",
						prompt: buildSelfImprovementTaskPrompt({
							workspacePath: context.repoPath,
							notes: body?.notes,
							evidenceBundlePath: body?.evidenceBundlePath,
						}),
						startInPlanMode: true,
						autoReviewEnabled: true,
						agentId: "cline",
						generatedFromPlan: {
							artifactKind: "spec",
							planSlug: "self-improvement-current-dev-checkout",
							planTaskId: "seed-self-improvement-task",
							sourceTaskId: null,
						},
						filesLikelyTouched: [
							...(body?.evidenceBundlePath ? [body.evidenceBundlePath] : []),
							"follow-up-3-by-opus4.8-ultracode.md",
						],
						baseRef,
					},
					randomUUID,
					now,
				);
				await saveWorkspaceState(context.repoPath, {
					board: created.board,
					sessions: state.sessions,
				});

				const taskCounts = await deps.summarizeProjectTaskCounts(context.workspaceId, context.repoPath);
				const project = deps.createProjectSummary({
					workspaceId: context.workspaceId,
					repoPath: context.repoPath,
					taskCounts,
					gitRepositoryCreatedByKanban: context.gitRepositoryCreatedByKanban === true,
				});
				void deps.broadcastRuntimeProjectsUpdated(context.workspaceId);
				return {
					ok: true,
					project,
					task: created.task,
					workspacePath: context.repoPath,
					source: "current_dev_checkout",
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					project: null,
					task: null,
					workspacePath: null,
					source: "current_dev_checkout",
					error: message,
				};
			}
		},
		cleanupDevTestProjects: async (preferredWorkspaceId): Promise<RuntimeDevTestCleanupResponse> => {
			if (process.env.NODE_ENV !== "development") {
				return {
					ok: false,
					removedProjects: 0,
					removedTaskWorktrees: 0,
					errors: [],
					error: "Dev test project cleanup is only available when NODE_ENV=development.",
				};
			}

			const errors: string[] = [];
			let removedProjects = 0;
			let removedTaskWorktrees = 0;
			try {
				const allEntries = await listWorkspaceIndexEntries();
				const entries = [];
				for (const entry of allEntries) {
					if (await isMarkedDevTestWorkspaceEntry(entry)) {
						entries.push(entry);
					}
				}
				for (const entry of entries) {
					const taskIdsToCleanup = new Set<string>();
					try {
						const workspaceState = await loadWorkspaceState(entry.repoPath);
						for (const taskId of deps.collectProjectWorktreeTaskIdsForRemoval(workspaceState.board)) {
							taskIdsToCleanup.add(taskId);
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						errors.push(`Could not read board for ${entry.workspaceId}: ${message}`);
					}

					const terminalManager = deps.getTerminalManagerForWorkspace(entry.workspaceId);
					if (terminalManager) {
						terminalManager.markInterruptedAndStopAll();
					}

					for (const taskId of taskIdsToCleanup) {
						const deleted = await deleteTaskWorktree({
							repoPath: entry.repoPath,
							taskId,
							preserveChanges: false,
						});
						if (deleted.ok) {
							removedTaskWorktrees += 1;
						} else {
							errors.push(deleted.error ?? `Could not delete task workspace for ${taskId}.`);
						}
					}
					await deleteTaskPatchFilesForRepo(entry.repoPath);

					const removed = await removeWorkspaceIndexEntry(entry.workspaceId);
					if (!removed) {
						errors.push(`Could not remove project index entry for ${entry.workspaceId}.`);
					}
					await removeWorkspaceStateFiles(entry.workspaceId).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						errors.push(`Could not remove workspace state for ${entry.workspaceId}: ${message}`);
					});
					deps.disposeWorkspace(entry.workspaceId, {
						stopTerminalSessions: true,
					});
					await rm(entry.repoPath, { recursive: true, force: true }).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						errors.push(`Could not remove fixture folder ${entry.repoPath}: ${message}`);
					});
					try {
						await stat(entry.repoPath);
						errors.push(`Fixture folder still exists after cleanup: ${entry.repoPath}`);
					} catch {
						// Removed successfully.
					}
					removedProjects += 1;
				}

				if (entries.some((entry) => entry.workspaceId === deps.getActiveWorkspaceId())) {
					const remaining = await listWorkspaceIndexEntries();
					const fallbackWorkspace =
						remaining.find((entry) => entry.workspaceId === preferredWorkspaceId) ?? remaining[0];
					if (fallbackWorkspace) {
						await deps.setActiveWorkspace(fallbackWorkspace.workspaceId, fallbackWorkspace.repoPath);
					} else {
						deps.clearActiveWorkspace();
					}
				}
				await deps.broadcastRuntimeProjectsUpdated(deps.getActiveWorkspaceId());
				return {
					ok: errors.length === 0,
					removedProjects,
					removedTaskWorktrees,
					errors,
					...(errors.length > 0 ? { error: errors[0] } : {}),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					removedProjects,
					removedTaskWorktrees,
					errors: [...errors, message],
					error: message,
				};
			}
		},
		removeProject: async (_preferredWorkspaceId, input) => {
			try {
				const body = parseProjectRemoveRequest(input);
				const projectsBeforeRemoval = await listWorkspaceIndexEntries();
				const projectToRemove = projectsBeforeRemoval.find((project) => project.workspaceId === body.projectId);
				if (!projectToRemove) {
					return {
						ok: false,
						error: `Unknown project ID: ${body.projectId}`,
					};
				}
				if (body.deleteGitRepository && !projectToRemove.gitRepositoryCreatedByKanban) {
					return {
						ok: false,
						error: "Kanban did not create this Git repository, so its .git metadata will not be deleted.",
					};
				}

				const taskIdsToCleanup = new Set<string>();
				try {
					const workspaceState = await loadWorkspaceState(projectToRemove.repoPath);
					for (const taskId of deps.collectProjectWorktreeTaskIdsForRemoval(workspaceState.board)) {
						taskIdsToCleanup.add(taskId);
					}
				} catch {
					// Best effort: if board state cannot be read, skip worktree cleanup IDs.
				}

				const removedTerminalManager = deps.getTerminalManagerForWorkspace(body.projectId);
				if (removedTerminalManager) {
					removedTerminalManager.markInterruptedAndStopAll();
				}

				if (taskIdsToCleanup.size > 0) {
					const deletions = await Promise.all(
						Array.from(taskIdsToCleanup).map(async (taskId) => ({
							taskId,
							deleted: await deleteTaskWorktree({
								repoPath: projectToRemove.repoPath,
								taskId,
								preserveChanges: false,
							}),
						})),
					);
					for (const { taskId, deleted } of deletions) {
						if (deleted.ok) {
							continue;
						}
						const message = deleted.error ?? `Could not delete task workspace for task "${taskId}".`;
						deps.warn(message);
						if (body.deleteGitRepository) {
							throw new Error(`Could not remove all task worktrees, so the Git repository was kept. ${message}`);
						}
					}
				}
				if (body.deleteGitRepository) {
					await rm(join(projectToRemove.repoPath, ".git"), {
						recursive: true,
						force: true,
					});
				}
				const removed = await removeWorkspaceIndexEntry(body.projectId);
				if (!removed) {
					throw new Error(`Could not remove project index entry for "${body.projectId}".`);
				}
				await removeWorkspaceStateFiles(body.projectId);
				deps.disposeWorkspace(body.projectId, {
					stopTerminalSessions: false,
				});

				if (deps.getActiveWorkspaceId() === body.projectId) {
					const remaining = await listWorkspaceIndexEntries();
					const fallbackWorkspace = remaining[0];
					if (fallbackWorkspace) {
						await deps.setActiveWorkspace(fallbackWorkspace.workspaceId, fallbackWorkspace.repoPath);
					} else {
						deps.clearActiveWorkspace();
					}
				}
				await deps.broadcastRuntimeProjectsUpdated(deps.getActiveWorkspaceId());
				return {
					ok: true,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					error: message,
				};
			}
		},
		migrateAccidentalProjectArtifacts: async (
			_preferredWorkspaceId,
			input,
		): Promise<RuntimeProjectArtifactMigrationResponse> => {
			let migratedArtifacts = 0;
			let skippedArtifacts = 0;
			const errors: string[] = [];
			try {
				const body = parseProjectArtifactMigrationRequest(input);
				const entries = await listWorkspaceIndexEntries();
				const sourceEntry = entries.find((entry) => entry.workspaceId === body.projectId);
				if (!sourceEntry) {
					return {
						ok: false,
						migratedArtifacts,
						skippedArtifacts,
						parentWorkspaceId: null,
						parentWorkspacePath: null,
						errors: [],
						error: `Unknown project ID: ${body.projectId}`,
					};
				}
				const issuesByWorkspaceId = await detectProjectHealthIssuesByWorkspaceId({ projects: entries });
				const issue = (issuesByWorkspaceId.get(sourceEntry.workspaceId) ?? []).find(
					(candidate) =>
						candidate.kind === "task_worktree_project" || candidate.kind === "missing_parent_workspace",
				);
				if (!issue) {
					return {
						ok: false,
						migratedArtifacts,
						skippedArtifacts,
						parentWorkspaceId: null,
						parentWorkspacePath: null,
						errors: [],
						error: "This project is not detected as an accidental task-worktree project.",
					};
				}
				if (!issue.parentWorkspaceId || !issue.parentWorkspacePath) {
					return {
						ok: false,
						migratedArtifacts,
						skippedArtifacts,
						parentWorkspaceId: null,
						parentWorkspacePath: null,
						errors: [],
						error: "No parent project was detected for this task worktree project.",
					};
				}
				if (!issue.canMigrateArtifacts) {
					return {
						ok: false,
						migratedArtifacts,
						skippedArtifacts,
						parentWorkspaceId: issue.parentWorkspaceId,
						parentWorkspacePath: issue.parentWorkspacePath,
						errors: [],
						error: "No migratable plan artifacts were found.",
					};
				}
				const artifactSlugs = await listPlanArtifactDirectoryNames(sourceEntry.repoPath);
				for (const slug of artifactSlugs) {
					const sourceArtifactPath = join(sourceEntry.repoPath, ".cline", "nklein", "plans", slug);
					const targetArtifactPath = join(issue.parentWorkspacePath, ".cline", "nklein", "plans", slug);
					if (await pathExists(targetArtifactPath)) {
						skippedArtifacts += 1;
						errors.push(`Skipped ${slug}: the parent project already has an artifact with that slug.`);
						continue;
					}
					await cp(sourceArtifactPath, targetArtifactPath, {
						recursive: true,
						errorOnExist: true,
						force: false,
					});
					await updateMigratedArtifactMetadata({
						artifactPath: targetArtifactPath,
						parentWorkspaceId: issue.parentWorkspaceId,
						parentWorkspacePath: issue.parentWorkspacePath,
						sourceTaskId: issue.taskId,
					});
					migratedArtifacts += 1;
				}
				await deps.broadcastRuntimeProjectsUpdated(deps.getActiveWorkspaceId());
				return {
					ok: errors.length === 0,
					migratedArtifacts,
					skippedArtifacts,
					parentWorkspaceId: issue.parentWorkspaceId,
					parentWorkspacePath: issue.parentWorkspacePath,
					errors,
					...(errors.length > 0 ? { error: errors[0] } : {}),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					migratedArtifacts,
					skippedArtifacts,
					parentWorkspaceId: null,
					parentWorkspacePath: null,
					errors: [...errors, message],
					error: message,
				};
			}
		},
		pickProjectDirectory: async () => {
			try {
				const selectedPath = deps.pickDirectoryPathFromSystemDialog();
				if (!selectedPath) {
					return {
						ok: false,
						path: null,
						error: "No directory was selected.",
					};
				}
				return {
					ok: true,
					path: selectedPath,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					path: null,
					error: message,
				};
			}
		},
		listDirectoryContents: async (_preferredWorkspaceId, input) => {
			const body = parseDirectoryListRequest(input);
			const rootPath = filesystemRoot;
			const requestedPath = body.path?.trim() || "";
			// Reject absolute paths that fall outside the sandbox
			if (requestedPath && isAbsolute(requestedPath)) {
				if (!isPathWithinRoot(rootPath, requestedPath)) {
					return {
						ok: false,
						currentPath: rootPath,
						parentPath: null,
						rootPath,
						entries: [],
						error: "Access denied: absolute path is outside the server root directory.",
					} satisfies RuntimeDirectoryListResponse;
				}
				// Absolute path is within sandbox — fall through to existing stat/readdir logic
			}
			const resolvedPath = resolve(rootPath, requestedPath) || rootPath;

			if (!isPathWithinRoot(rootPath, resolvedPath)) {
				return {
					ok: false,
					currentPath: rootPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: "Access denied: path is outside the server root directory.",
				} satisfies RuntimeDirectoryListResponse;
			}

			try {
				const dirStat = await stat(resolvedPath);
				if (!dirStat.isDirectory()) {
					return {
						ok: false,
						currentPath: resolvedPath,
						parentPath: null,
						rootPath,
						entries: [],
						error: "The specified path is not a directory.",
					} satisfies RuntimeDirectoryListResponse;
				}

				const dirEntries = await readdir(resolvedPath, { withFileTypes: true });
				const directoryEntries = dirEntries.filter((entry) => {
					if (!entry.isDirectory()) {
						return false;
					}
					if (entry.name.startsWith(".")) {
						return false;
					}
					return true;
				});

				directoryEntries.sort((a, b) => a.name.localeCompare(b.name));

				const entries = await Promise.all(
					directoryEntries.map(async (entry) => {
						const entryPath = resolve(resolvedPath, entry.name);
						let isGitRepository = false;
						try {
							const gitDirStat = await stat(resolve(entryPath, ".git"));
							isGitRepository = gitDirStat.isDirectory() || gitDirStat.isFile();
						} catch {
							// .git does not exist or is not accessible
						}
						return {
							name: entry.name,
							path: entryPath,
							isGitRepository,
						};
					}),
				);

				const isAtRoot = resolvedPath === rootPath;
				const rawParent = dirname(resolvedPath);
				const parentIsWithinRoot = isPathWithinRoot(rootPath, rawParent);
				const parentPath = isAtRoot ? null : parentIsWithinRoot ? rawParent : null;

				return {
					ok: true,
					currentPath: resolvedPath,
					parentPath,
					rootPath,
					entries,
				} satisfies RuntimeDirectoryListResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const isPermissionError =
					error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EACCES";
				const isNotFoundError =
					error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
				return {
					ok: false,
					currentPath: resolvedPath,
					parentPath: null,
					rootPath,
					entries: [],
					error: isPermissionError
						? "Permission denied: cannot read this directory."
						: isNotFoundError
							? "Directory not found."
							: message,
				} satisfies RuntimeDirectoryListResponse;
			}
		},
	};
}
