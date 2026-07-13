import { randomUUID } from "node:crypto";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectRegistryResponse,
	RuntimeDevTestProjectRequest,
	RuntimeDevTestProjectResponse,
	RuntimeProjectAddResponse,
	RuntimeProjectArtifactMigrationResponse,
	RuntimeProjectAutoResumeResponse,
	RuntimeSelfImprovementProjectRequest,
	RuntimeSelfImprovementProjectResponse,
} from "../core/api-contract";
import {
	parseProjectAddRequest,
	parseProjectArtifactMigrationRequest,
	parseProjectAutoResumeRequest,
	parseProjectRemoveRequest,
	parseSelfImprovementProjectRequest,
} from "../core/api-validation";
import { resolveAutonomousTimeoutPowerMultiplier } from "../core/autonomous-timeout-defaults";
import { addTaskToColumn } from "../core/task-board-mutations";
import { loadDevTestProjectScenario } from "../nklein-agent/dev-test-project-registry";
import {
	resolveNKleinDevTestProjectScenario,
	scaffoldNKleinDevTestProject,
} from "../nklein-agent/nklein-dev-test-project";
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
	setWorkspaceAutoResumeEnabled,
} from "../state/workspace-state";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import { cloneGitRepository } from "../workspace/git-clone";
import {
	ensureInitialCommit,
	initializeGitRepository,
	isGitRepositoryCreatedByKanban,
	markGitRepositoryCreatedByKanban,
} from "../workspace/initialize-repo";
import { detectProjectHealthIssuesByWorkspaceId } from "../workspace/project-health";
import { confineToAllowedRoots } from "../workspace/remote-path-confinement";
import { deleteTaskArtifacts, deleteTaskPatchFilesForRepo } from "../workspace/task-artifact-cleanup";
import { deleteTaskResultBranchesForRepo } from "../workspace/task-result-branches";
import { isPathInsideTaskWorktreesHome } from "../workspace/task-worktree-path";
import type { RuntimeTrpcContext } from "./app-router";
import { buildDevTestTaskId, createDevTestBoard } from "./dev-test-board";
import { handleListDevTestProjects } from "./projects-api/dev-test-projects.js";
import { handleListDirectoryContents, handlePickProjectDirectory } from "./projects-api/directory-browse.js";
import {
	isMarkedDevTestWorkspaceEntry,
	listPlanArtifactDirectoryNames,
	pathExists,
	readEvidenceBundleBaseCommit,
	resolveKleinSourceRepoPath,
	updateMigratedArtifactMetadata,
} from "./projects-api-helpers";

// Re-exported so existing importers (cli.ts, workspace-registry.ts, tests) keep resolving it from here.
export { resolveKleinSourceRepoPath } from "./projects-api-helpers";

import { deleteChatSessionsForWorkspace } from "../chat/chat-session-store";
import type { CreateProjectsApiDependencies } from "./projects-api-types";
import { buildSelfImprovementTaskPrompt } from "./self-improvement-task-prompt";

export type { CreateProjectsApiDependencies } from "./projects-api-types";

export function createProjectsApi(deps: CreateProjectsApiDependencies): RuntimeTrpcContext["projectsApi"] {
	// In remote mode the filesystem root is narrowed to the first allowed root
	// (home directory) so the folder picker starts there, not at `/`.  In local
	// mode we keep the full FS root so existing behaviour is unchanged.
	const filesystemRoot = deps.isRemoteMode
		? (deps.allowedBrowseRoots[0] ?? resolve(deps.serverCwd, "/"))
		: resolve(deps.serverCwd, "/");

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

			// Remote mode: reject project paths that fall outside every allowed root.
			if (deps.isRemoteMode) {
				const rawPath = body.path ?? "";
				if (rawPath) {
					const preferredWorkspaceContext = preferredWorkspaceId
						? await loadWorkspaceContextById(preferredWorkspaceId)
						: null;
					const resolveBase =
						preferredWorkspaceContext?.repoPath ?? deps.getActiveWorkspacePath() ?? process.cwd();
					const resolved = deps.resolveProjectInputPath(rawPath, resolveBase);
					const confinement = confineToAllowedRoots(resolved, deps.allowedBrowseRoots);
					if (!confinement.allowed) {
						return {
							ok: false,
							project: null,
							error: "Access denied: the requested project path is outside the allowed directories for remote mode.",
						} satisfies RuntimeProjectAddResponse;
					}
				}
				if (body.gitUrl) {
					// For git clones, check the custom destination path if one is provided.
					const customDest = body.path ? body.path : null;
					if (customDest) {
						const resolved = deps.resolveProjectInputPath(customDest, deps.serverCwd);
						const confinement = confineToAllowedRoots(resolved, deps.allowedBrowseRoots);
						if (!confinement.allowed) {
							return {
								ok: false,
								project: null,
								error: "Access denied: the requested clone destination is outside the allowed directories for remote mode.",
							} satisfies RuntimeProjectAddResponse;
						}
					}
				}
			}

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
						// Remote clients may only clone network URLs — never a local/file source into the sandbox.
						isRemoteMode: deps.isRemoteMode,
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
					if (body.createDirectory) {
						if (await pathExists(projectPath)) {
							return {
								ok: false,
								project: null,
								error: "Project folder already exists. Choose an existing project or use a different folder name.",
							} satisfies RuntimeProjectAddResponse;
						}
						await mkdir(projectPath, { recursive: false });
					}
				}
				await deps.assertPathIsDirectory(projectPath);
				if (!deps.hasGitRepository(projectPath)) {
					if (!body.initializeGit) {
						return {
							ok: false,
							project: null,
							requiresGitInitialization: true,
							error: "This folder is not a git repository. !Klein requires git to manage worktrees. Initialize git to continue.",
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
						error: "That folder is a legacy !Klein task workspace. Add the owning parent project instead, or use the advanced legacy task-workspace project flow.",
					} satisfies RuntimeProjectAddResponse;
				}
				const sourceRepoPath = await (deps.resolveKleinSourceRepoPath ?? resolveKleinSourceRepoPath)();
				if (sourceRepoPath && sourceRepoPath === candidateRepoPath && body.confirmSelfProject !== true) {
					return {
						ok: false,
						project: null,
						requiresSelfProjectConfirmation: true,
						error: "This is !Klein's own source repository. Loading it as a project is a self-improvement workflow and needs confirmation.",
					} satisfies RuntimeProjectAddResponse;
				}
				const context = await loadWorkspaceContext(projectPath, {
					gitRepositoryCreatedByKanban,
					displayName: body.projectName,
					selfProjectConfirmed: sourceRepoPath === candidateRepoPath && body.confirmSelfProject === true,
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
						displayName: context.displayName,
						autoResumeEnabled: context.autoResumeEnabled === true,
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
		listDevTestProjects: async (): Promise<RuntimeDevTestProjectRegistryResponse> => handleListDevTestProjects(),
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
				const scenario =
					input?.registryId != null
						? loadDevTestProjectScenario(input.registryId)
						: resolveNKleinDevTestProjectScenario(input?.preset ?? "mid_task");
				// §5.W: honor the user-configured workspace base dir (global setting) for where the dev-test project is
				// created; null falls back to the env var / home default inside resolveSafeCreatedWorkspaceParentDir.
				const globalConfig = await loadGlobalRuntimeConfig();
				const scaffolded = await scaffoldNKleinDevTestProject({
					scenario,
					initializeGit: true,
					...(globalConfig.workspaceBaseDir ? { workspaceBaseDir: globalConfig.workspaceBaseDir } : {}),
				});
				const context = await loadWorkspaceContext(scaffolded.workspacePath, {
					gitRepositoryCreatedByKanban: true,
				});
				deps.rememberWorkspace(context.workspaceId, context.repoPath);
				await deps.setActiveWorkspace(context.workspaceId, context.repoPath);

				const now = Date.now();
				const runtimeConfig = await loadRuntimeConfig(context.repoPath);
				const powerMultiplier = await resolveAutonomousTimeoutPowerMultiplier();
				const baseRef = context.git.currentBranch ?? context.git.defaultBranch ?? "HEAD";
				const board = createDevTestBoard({
					taskId: buildDevTestTaskId(scenario.id),
					title: scenario.title,
					prompt: scenario.prompt,
					acceptanceCommand: scenario.acceptanceCommand,
					modelRoles: runtimeConfig.effectiveModelRoles,
					baseRef,
					powerMultiplier,
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
						"Visible !Klein dev scenario scaffolded. Start the seeded decomposition task in the UI to exercise the normal planning and task-graph pipeline.",
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
				const sourceRepoPath = await (deps.resolveKleinSourceRepoPath ?? resolveKleinSourceRepoPath)();
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
						agentId: "nklein",
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
					displayName: context.displayName,
					autoResumeEnabled: context.autoResumeEnabled === true,
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
					errors: [],
					error: "Dev test project cleanup is only available when NODE_ENV=development.",
				};
			}

			const errors: string[] = [];
			let removedProjects = 0;
			try {
				const allEntries = await listWorkspaceIndexEntries();
				const entries = [];
				for (const entry of allEntries) {
					if (await isMarkedDevTestWorkspaceEntry(entry)) {
						entries.push(entry);
					}
				}
				for (const entry of entries) {
					const terminalManager = deps.getTerminalManagerForWorkspace(entry.workspaceId);
					if (terminalManager) {
						terminalManager.markInterruptedAndStopAll();
					}

					// Per-task artifact deletion is unnecessary here: the patch store and result branches are cleaned
					// repo-wide below, and the fixture folder itself is removed right after.
					await deleteTaskPatchFilesForRepo(entry.repoPath);
					await deleteTaskResultBranchesForRepo({ repoPath: entry.repoPath }).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						errors.push(`Could not delete task result branches for ${entry.workspaceId}: ${message}`);
					});

					const removed = await removeWorkspaceIndexEntry(entry.workspaceId);
					if (!removed) {
						errors.push(`Could not remove project index entry for ${entry.workspaceId}.`);
					}
					// Cleanup must be consistent in EVERY detail (David 2026-07-10): the project's chats go with it.
					await deleteChatSessionsForWorkspace(entry.workspaceId).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						errors.push(`Could not remove chat sessions for ${entry.workspaceId}: ${message}`);
					});
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
					errors,
					...(errors.length > 0 ? { error: errors[0] } : {}),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					removedProjects,
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
						error: "!Klein did not create this Git repository, so its .git metadata will not be deleted.",
					};
				}

				const taskIdsToCleanup = new Set<string>();
				try {
					const workspaceState = await loadWorkspaceState(projectToRemove.repoPath);
					for (const taskId of deps.collectProjectTaskIdsForRemoval(workspaceState.board)) {
						taskIdsToCleanup.add(taskId);
					}
				} catch {
					// Best effort: if board state cannot be read, skip task artifact cleanup IDs.
				}

				const removedTerminalManager = deps.getTerminalManagerForWorkspace(body.projectId);
				if (removedTerminalManager) {
					removedTerminalManager.markInterruptedAndStopAll();
				}

				if (taskIdsToCleanup.size > 0) {
					const deletions = await Promise.all(
						Array.from(taskIdsToCleanup).map(async (taskId) => ({
							taskId,
							deleted: await deleteTaskArtifacts({
								repoPath: projectToRemove.repoPath,
								taskId,
							}),
						})),
					);
					for (const { taskId, deleted } of deletions) {
						if (deleted.ok) {
							continue;
						}
						const message = deleted.error ?? `Could not delete task artifacts for task "${taskId}".`;
						deps.warn(message);
						if (body.deleteGitRepository) {
							throw new Error(`Could not remove all task artifacts, so the Git repository was kept. ${message}`);
						}
					}
				}
				if (body.deleteGitRepository) {
					await deleteTaskResultBranchesForRepo({ repoPath: projectToRemove.repoPath });
					await rm(join(projectToRemove.repoPath, ".git"), {
						recursive: true,
						force: true,
					});
				}
				const removed = await removeWorkspaceIndexEntry(body.projectId);
				if (!removed) {
					throw new Error(`Could not remove project index entry for "${body.projectId}".`);
				}
				// Cleanup must be consistent in EVERY detail (David 2026-07-10): the project's chats go with it.
				await deleteChatSessionsForWorkspace(body.projectId).catch(() => {
					// Best-effort: a chat-store hiccup must not block the project removal itself.
				});
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
		setAutoResume: async (preferredWorkspaceId, input): Promise<RuntimeProjectAutoResumeResponse> => {
			try {
				const body = parseProjectAutoResumeRequest(input);
				const updated = await setWorkspaceAutoResumeEnabled(body.projectId, body.enabled);
				if (!updated) {
					return {
						ok: false,
						project: null,
						error: `Unknown project ID: ${body.projectId}`,
					};
				}
				const taskCounts = await deps.summarizeProjectTaskCounts(updated.workspaceId, updated.repoPath);
				const project = deps.createProjectSummary({
					workspaceId: updated.workspaceId,
					repoPath: updated.repoPath,
					taskCounts,
					gitRepositoryCreatedByKanban: updated.gitRepositoryCreatedByKanban,
					displayName: updated.displayName,
					autoResumeEnabled: updated.autoResumeEnabled,
				});
				await deps.broadcastRuntimeProjectsUpdated(preferredWorkspaceId ?? deps.getActiveWorkspaceId());
				return {
					ok: true,
					project,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					project: null,
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
						error: "This project is not detected as an accidental legacy task workspace project.",
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
						error: "No parent project was detected for this legacy task workspace project.",
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
					const sourceArtifactPath = join(sourceEntry.repoPath, ".nklein", "nklein", "plans", slug);
					const targetArtifactPath = join(issue.parentWorkspacePath, ".nklein", "nklein", "plans", slug);
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
		pickProjectDirectory: async () =>
			handlePickProjectDirectory({
				filesystemRoot,
				isRemoteMode: deps.isRemoteMode,
				allowedBrowseRoots: deps.allowedBrowseRoots,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
			}),
		listDirectoryContents: async (_preferredWorkspaceId, input) =>
			handleListDirectoryContents(input, {
				filesystemRoot,
				isRemoteMode: deps.isRemoteMode,
				allowedBrowseRoots: deps.allowedBrowseRoots,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
			}),
	};
}
