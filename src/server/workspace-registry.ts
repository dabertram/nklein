import { type RuntimeConfigState, toGlobalRuntimeConfigState } from "../config/runtime-config";
import type {
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeProjectHealthIssue,
	RuntimeProjectSummary,
	RuntimeProjectTaskCounts,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { type ActiveAgentSessionCounts, countActiveAgentSessions } from "../core/api-contract";
import { createStaleWhileRevalidateCache } from "../core/stale-while-revalidate-cache";
import { applyLiveSessionsToWorkspaceState } from "../state/workspace-live-session-merge";
import {
	listWorkspaceIndexEntries,
	loadWorkspaceBoardById,
	loadWorkspaceState,
	type RuntimeWorkspaceIndexEntry,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
	resolveWorkspacePath,
} from "../state/workspace-state";
import { TerminalSessionManager } from "../terminal/session-manager";
import {
	detectProjectHealthIssuesByWorkspaceId,
	type ProjectHealthIssuesByWorkspaceId,
} from "../workspace/project-health";

export interface WorkspaceRegistryScope {
	workspaceId: string;
	workspacePath: string;
}

export interface CreateWorkspaceRegistryDependencies {
	cwd: string;
	loadGlobalRuntimeConfig: () => Promise<RuntimeConfigState>;
	loadRuntimeConfig: (cwd: string) => Promise<RuntimeConfigState>;
	hasGitRepository: (path: string) => boolean;
	pathIsDirectory: (path: string) => Promise<boolean>;
	onTerminalManagerReady?: (workspaceId: string, manager: TerminalSessionManager) => void;
	/**
	 * Resolve !Klein's OWN source-repo path (the "source workspace" that needs explicit confirmation before it shows as a
	 * project). This MUST identify the repo by where !Klein's code is INSTALLED (`resolveKleinSourceRepoPath`), independent
	 * of where the server runs — the same notion `addProject`'s self-project guard uses. Keying off `cwd` instead (the old
	 * behavior, kept only as the fallback) is wrong: when the server runs from inside a user's project (server `cwd` = that
	 * project), the source-workspace filter would treat the user's OWN project as the unconfirmed source repo and hide it
	 * from the project list even after a successful add (the launch-from-project bug; b4a904dd fixed only the guard half).
	 */
	resolveSourceRepoPath?: () => Promise<string | null>;
}

export interface DisposeWorkspaceRegistryOptions {
	stopTerminalSessions?: boolean;
}

export interface ResolvedWorkspaceStreamTarget {
	workspaceId: string | null;
	workspacePath: string | null;
	removedRequestedWorkspacePath: string | null;
	didPruneProjects: boolean;
}

export interface RemovedWorkspaceNotice {
	workspaceId: string;
	repoPath: string;
	message: string;
}

export interface WorkspaceRegistry {
	getActiveWorkspaceId: () => string | null;
	getActiveWorkspacePath: () => string | null;
	getWorkspacePathById: (workspaceId: string) => string | null;
	rememberWorkspace: (workspaceId: string, repoPath: string) => void;
	getActiveRuntimeConfig: () => RuntimeConfigState;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	loadScopedRuntimeConfig: (scope: WorkspaceRegistryScope) => Promise<RuntimeConfigState>;
	getTerminalManagerForWorkspace: (workspaceId: string) => TerminalSessionManager | null;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	setActiveWorkspace: (workspaceId: string, repoPath: string) => Promise<void>;
	clearActiveWorkspace: () => void;
	disposeWorkspace: (
		workspaceId: string,
		options?: DisposeWorkspaceRegistryOptions,
	) => {
		terminalManager: TerminalSessionManager | null;
		workspacePath: string | null;
	};
	summarizeProjectTaskCounts: (workspaceId: string, repoPath: string) => Promise<RuntimeProjectTaskCounts>;
	createProjectSummary: (input: {
		workspaceId: string;
		repoPath: string;
		taskCounts: RuntimeProjectTaskCounts;
		gitRepositoryCreatedByKanban: boolean;
		displayName?: string | null;
		healthIssues?: RuntimeProjectHealthIssue[];
	}) => RuntimeProjectSummary;
	buildWorkspaceStateSnapshot: (workspaceId: string, workspacePath: string) => Promise<RuntimeWorkspaceStateResponse>;
	/**
	 * Supply the live NKlein agent-session summaries for a workspace (the hub owns that cache). Without it the
	 * per-project activity badge would only see terminal/PTY sessions and miss the Docker-isolated NKlein agents — so the
	 * registry unions this provider's summaries with the terminal manager's when counting running/queued agents.
	 */
	setNKleinSessionSummariesProvider: (provider: (workspaceId: string) => readonly RuntimeTaskSessionSummary[]) => void;
	buildProjectsPayload: (preferredCurrentProjectId: string | null) => Promise<{
		currentProjectId: string | null;
		projects: RuntimeProjectSummary[];
	}>;
	resolveWorkspaceForStream: (
		requestedWorkspaceId: string | null,
		options?: {
			onRemovedWorkspace?: (workspace: RemovedWorkspaceNotice) => void;
		},
	) => Promise<ResolvedWorkspaceStreamTarget>;
	listManagedWorkspaces: () => Array<{
		workspaceId: string;
		workspacePath: string | null;
		terminalManager: TerminalSessionManager;
	}>;
}

function createEmptyProjectTaskCounts(): RuntimeProjectTaskCounts {
	return {
		backlog: 0,
		planning: 0,
		in_progress: 0,
		review: 0,
		completed: 0,
		trash: 0,
	};
}

function countTasksByColumn(board: RuntimeBoardData): RuntimeProjectTaskCounts {
	const counts = createEmptyProjectTaskCounts();
	for (const column of board.columns) {
		const count = column.cards.length;
		switch (column.id) {
			case "backlog":
				counts.backlog += count;
				break;
			case "planning":
				counts.planning += count;
				break;
			case "in_progress":
				counts.in_progress += count;
				break;
			case "review":
				counts.review += count;
				break;
			case "completed":
				counts.completed += count;
				break;
			case "trash":
				counts.trash += count;
				break;
		}
	}
	return counts;
}

export function collectProjectWorktreeTaskIdsForRemoval(board: RuntimeBoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function applyLiveSessionStateToProjectTaskCounts(
	counts: RuntimeProjectTaskCounts,
	board: RuntimeBoardData,
	sessionSummaries: RuntimeWorkspaceStateResponse["sessions"],
): RuntimeProjectTaskCounts {
	const taskColumnById = new Map<string, RuntimeBoardColumnId>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskColumnById.set(card.id, column.id);
		}
	}
	const next = {
		...counts,
	};
	for (const summary of Object.values(sessionSummaries)) {
		const columnId = taskColumnById.get(summary.taskId);
		if (!columnId) {
			continue;
		}
		if (summary.state === "awaiting_review" && (columnId === "in_progress" || columnId === "planning")) {
			if (columnId === "planning") {
				next.planning = Math.max(0, next.planning - 1);
			} else {
				next.in_progress = Math.max(0, next.in_progress - 1);
			}
			next.review += 1;
		}
	}
	return next;
}

function toProjectSummary(project: {
	workspaceId: string;
	repoPath: string;
	taskCounts: RuntimeProjectTaskCounts;
	activeSessions?: ActiveAgentSessionCounts;
	gitRepositoryCreatedByKanban: boolean;
	displayName?: string | null;
	healthIssues?: RuntimeProjectHealthIssue[];
}): RuntimeProjectSummary {
	const normalized = project.repoPath.replaceAll("\\", "/").replace(/\/+$/g, "");
	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	const name = project.displayName?.trim() || segments[segments.length - 1] || normalized;
	return {
		id: project.workspaceId,
		path: project.repoPath,
		name,
		taskCounts: project.taskCounts,
		runningSessionCount: project.activeSessions?.running ?? 0,
		queuedSessionCount: project.activeSessions?.queued ?? 0,
		gitRepositoryCreatedByKanban: project.gitRepositoryCreatedByKanban,
		healthIssues: project.healthIssues ?? [],
	};
}

export async function createWorkspaceRegistry(deps: CreateWorkspaceRegistryDependencies): Promise<WorkspaceRegistry> {
	// The "source workspace" (needs confirmation before listing) is !Klein's OWN installed repo — resolve it via the
	// injected install-location resolver, consistent with `addProject`'s self-project guard. Fall back to the legacy
	// cwd-based notion only when no resolver is injected (back-compat for direct-registry callers/tests).
	const sourceWorkspacePath = deps.resolveSourceRepoPath
		? await deps.resolveSourceRepoPath().catch(() => null)
		: deps.hasGitRepository(deps.cwd)
			? await resolveWorkspacePath(deps.cwd).catch(() => null)
			: null;
	const filterUnconfirmedSourceWorkspace = (projects: RuntimeWorkspaceIndexEntry[]): RuntimeWorkspaceIndexEntry[] =>
		sourceWorkspacePath
			? projects.filter(
					(project) => project.repoPath !== sourceWorkspacePath || project.selfProjectConfirmed === true,
				)
			: projects;
	const indexedWorkspaces = filterUnconfirmedSourceWorkspace(await listWorkspaceIndexEntries());
	const indexedWorkspace = indexedWorkspaces[0] ?? null;

	let activeWorkspaceId: string | null = indexedWorkspace?.workspaceId ?? null;
	let activeWorkspacePath: string | null = indexedWorkspace?.repoPath ?? null;
	let globalRuntimeConfig = await deps.loadGlobalRuntimeConfig();
	let activeRuntimeConfig = activeWorkspacePath
		? await deps.loadRuntimeConfig(activeWorkspacePath)
		: globalRuntimeConfig;
	const workspacePathsById = new Map<string, string>(
		activeWorkspaceId && activeWorkspacePath ? [[activeWorkspaceId, activeWorkspacePath]] : [],
	);
	const projectTaskCountsByWorkspaceId = new Map<string, RuntimeProjectTaskCounts>();
	const terminalManagersByWorkspaceId = new Map<string, TerminalSessionManager>();
	const terminalManagerLoadPromises = new Map<string, Promise<TerminalSessionManager>>();
	// Live NKlein agent-session summaries per workspace, supplied by the hub (registry can't reach them directly).
	let nkleinSessionSummariesProvider: ((workspaceId: string) => readonly RuntimeTaskSessionSummary[]) | null = null;

	const rememberWorkspace = (workspaceId: string, repoPath: string): void => {
		workspacePathsById.set(workspaceId, repoPath);
	};

	const notifyTerminalManagerReady = (workspaceId: string, manager: TerminalSessionManager): void => {
		deps.onTerminalManagerReady?.(workspaceId, manager);
	};

	const getTerminalManagerForWorkspace = (workspaceId: string): TerminalSessionManager | null => {
		return terminalManagersByWorkspaceId.get(workspaceId) ?? null;
	};

	const ensureTerminalManagerForWorkspace = async (
		workspaceId: string,
		repoPath: string,
	): Promise<TerminalSessionManager> => {
		rememberWorkspace(workspaceId, repoPath);
		const existing = terminalManagersByWorkspaceId.get(workspaceId);
		if (existing) {
			notifyTerminalManagerReady(workspaceId, existing);
			return existing;
		}
		const pending = terminalManagerLoadPromises.get(workspaceId);
		if (pending) {
			const loaded = await pending;
			notifyTerminalManagerReady(workspaceId, loaded);
			return loaded;
		}
		const loading = (async () => {
			const manager = new TerminalSessionManager();
			try {
				const existingWorkspace = await loadWorkspaceState(repoPath);
				manager.hydrateFromRecord(existingWorkspace.sessions);
			} catch {
				// Workspace state will be created on demand.
			}
			terminalManagersByWorkspaceId.set(workspaceId, manager);
			return manager;
		})().finally(() => {
			terminalManagerLoadPromises.delete(workspaceId);
		});
		terminalManagerLoadPromises.set(workspaceId, loading);
		const loaded = await loading;
		notifyTerminalManagerReady(workspaceId, loaded);
		return loaded;
	};

	const setActiveWorkspace = async (workspaceId: string, repoPath: string): Promise<void> => {
		activeWorkspaceId = workspaceId;
		activeWorkspacePath = repoPath;
		rememberWorkspace(workspaceId, repoPath);
		await ensureTerminalManagerForWorkspace(workspaceId, repoPath);
		activeRuntimeConfig = await deps.loadRuntimeConfig(repoPath);
		globalRuntimeConfig = toGlobalRuntimeConfigState(activeRuntimeConfig);
	};

	const clearActiveWorkspace = (): void => {
		activeWorkspaceId = null;
		activeWorkspacePath = null;
		activeRuntimeConfig = globalRuntimeConfig;
	};

	const disposeWorkspace = (
		workspaceId: string,
		options?: DisposeWorkspaceRegistryOptions,
	): { terminalManager: TerminalSessionManager | null; workspacePath: string | null } => {
		const terminalManager = getTerminalManagerForWorkspace(workspaceId);
		if (terminalManager) {
			if (options?.stopTerminalSessions !== false) {
				terminalManager.markInterruptedAndStopAll();
			}
			terminalManagersByWorkspaceId.delete(workspaceId);
			terminalManagerLoadPromises.delete(workspaceId);
		}
		projectTaskCountsByWorkspaceId.delete(workspaceId);
		const workspacePath = workspacePathsById.get(workspaceId) ?? null;
		workspacePathsById.delete(workspaceId);
		return {
			terminalManager,
			workspacePath,
		};
	};

	const summarizeProjectTaskCounts = async (
		workspaceId: string,
		_repoPath: string,
	): Promise<RuntimeProjectTaskCounts> => {
		try {
			const board = await loadWorkspaceBoardById(workspaceId);
			const persistedCounts = countTasksByColumn(board);
			const terminalManager = getTerminalManagerForWorkspace(workspaceId);
			if (!terminalManager) {
				projectTaskCountsByWorkspaceId.set(workspaceId, persistedCounts);
				return persistedCounts;
			}
			const liveSessionsByTaskId: RuntimeWorkspaceStateResponse["sessions"] = {};
			for (const summary of terminalManager.listSummaries()) {
				liveSessionsByTaskId[summary.taskId] = summary;
			}
			const nextCounts = applyLiveSessionStateToProjectTaskCounts(persistedCounts, board, liveSessionsByTaskId);
			projectTaskCountsByWorkspaceId.set(workspaceId, nextCounts);
			return nextCounts;
		} catch {
			return projectTaskCountsByWorkspaceId.get(workspaceId) ?? createEmptyProjectTaskCounts();
		}
	};

	const buildWorkspaceStateSnapshot = async (
		workspaceId: string,
		workspacePath: string,
	): Promise<RuntimeWorkspaceStateResponse> => {
		const response = await loadWorkspaceState(workspacePath);
		const terminalManager = await ensureTerminalManagerForWorkspace(workspaceId, workspacePath);
		applyLiveSessionsToWorkspaceState(response, terminalManager.listSummaries());
		return response;
	};

	const summarizeProjectActiveSessions = (workspaceId: string): ActiveAgentSessionCounts => {
		// Union terminal/PTY sessions (legacy agents) with the live NKlein agent sessions (the hub-supplied provider) so
		// the badge counts the Docker-isolated NKlein agents too — they are NOT in the terminal manager. Dedup by taskId.
		const summariesByTaskId = new Map<string, RuntimeTaskSessionSummary>();
		for (const summary of getTerminalManagerForWorkspace(workspaceId)?.listSummaries() ?? []) {
			summariesByTaskId.set(summary.taskId, summary);
		}
		for (const summary of nkleinSessionSummariesProvider?.(workspaceId) ?? []) {
			summariesByTaskId.set(summary.taskId, summary);
		}
		return countActiveAgentSessions(summariesByTaskId.values());
	};

	// Project health detection (git/fs per project) is too expensive for the hot projects-payload path: under heavy
	// agent load it CONTENDS (the agent's frequent workspace writes) and `detectProjectHealthIssuesByWorkspaceId` was
	// measured at 30–55s, hanging every `projects.list` / WS broadcast (§5.AI root cause). Health issues change rarely
	// (project structure), so serve them from a stale-while-revalidate cache that refreshes in the BACKGROUND —
	// buildProjectsPayload never blocks on detection. The cache's refresh reads `latestHealthProjects`, which each
	// payload build updates to the current project set first (the only thing detection needs).
	const PROJECT_HEALTH_CACHE_TTL_MS = 30_000;
	let latestHealthProjects: readonly RuntimeWorkspaceIndexEntry[] = [];
	const projectHealthCache = createStaleWhileRevalidateCache<ProjectHealthIssuesByWorkspaceId>({
		initial: new Map(),
		ttlMs: PROJECT_HEALTH_CACHE_TTL_MS,
		// Cold cache: briefly await the first detection so an idle-startup payload carries health; capped so heavy load
		// never hangs the hot path (it returns the empty initial and the refresh lands on a later build).
		coldWaitMs: 2_000,
		refresh: () => detectProjectHealthIssuesByWorkspaceId({ projects: latestHealthProjects }),
	});

	const buildProjectsPayload = async (preferredCurrentProjectId: string | null) => {
		const projects = filterUnconfirmedSourceWorkspace(await listWorkspaceIndexEntries());
		latestHealthProjects = projects;
		const healthIssuesByWorkspaceId = await projectHealthCache.get();
		const fallbackProjectId =
			projects.find((project) => project.workspaceId === activeWorkspaceId)?.workspaceId ??
			projects[0]?.workspaceId ??
			null;
		const resolvedCurrentProjectId =
			(preferredCurrentProjectId &&
				projects.some((project) => project.workspaceId === preferredCurrentProjectId) &&
				preferredCurrentProjectId) ||
			fallbackProjectId;
		const projectSummaries = await Promise.all(
			projects.map(async (project) => {
				const taskCounts = await summarizeProjectTaskCounts(project.workspaceId, project.repoPath);
				return toProjectSummary({
					workspaceId: project.workspaceId,
					repoPath: project.repoPath,
					taskCounts,
					activeSessions: summarizeProjectActiveSessions(project.workspaceId),
					gitRepositoryCreatedByKanban: project.gitRepositoryCreatedByKanban,
					displayName: project.displayName,
					healthIssues: healthIssuesByWorkspaceId.get(project.workspaceId) ?? [],
				});
			}),
		);
		return {
			currentProjectId: resolvedCurrentProjectId,
			projects: projectSummaries,
		};
	};

	const resolveWorkspaceForStream = async (
		requestedWorkspaceId: string | null,
		options?: {
			onRemovedWorkspace?: (workspace: RemovedWorkspaceNotice) => void;
		},
	): Promise<ResolvedWorkspaceStreamTarget> => {
		const allProjects = filterUnconfirmedSourceWorkspace(await listWorkspaceIndexEntries());
		const existingProjects: RuntimeWorkspaceIndexEntry[] = [];
		const removedProjects: RuntimeWorkspaceIndexEntry[] = [];

		for (const project of allProjects) {
			let removalMessage: string | null = null;
			if (!(await deps.pathIsDirectory(project.repoPath))) {
				removalMessage = `Project no longer exists on disk and was removed: ${project.repoPath}`;
			} else if (!deps.hasGitRepository(project.repoPath)) {
				removalMessage = `Project is not a git repository and was removed: ${project.repoPath}`;
			}

			if (!removalMessage) {
				existingProjects.push(project);
				continue;
			}

			removedProjects.push(project);
			await removeWorkspaceIndexEntry(project.workspaceId);
			await removeWorkspaceStateFiles(project.workspaceId);
			disposeWorkspace(project.workspaceId);
			options?.onRemovedWorkspace?.({
				workspaceId: project.workspaceId,
				repoPath: project.repoPath,
				message: removalMessage,
			});
		}

		const removedRequestedWorkspacePath = requestedWorkspaceId
			? (removedProjects.find((project) => project.workspaceId === requestedWorkspaceId)?.repoPath ?? null)
			: null;

		const activeWorkspaceMissing = !existingProjects.some((project) => project.workspaceId === activeWorkspaceId);
		if (activeWorkspaceMissing) {
			if (existingProjects[0]) {
				await setActiveWorkspace(existingProjects[0].workspaceId, existingProjects[0].repoPath);
			} else {
				clearActiveWorkspace();
			}
		}

		if (requestedWorkspaceId) {
			const requestedWorkspace = existingProjects.find((project) => project.workspaceId === requestedWorkspaceId);
			if (requestedWorkspace) {
				if (
					activeWorkspaceId !== requestedWorkspace.workspaceId ||
					activeWorkspacePath !== requestedWorkspace.repoPath
				) {
					await setActiveWorkspace(requestedWorkspace.workspaceId, requestedWorkspace.repoPath);
				}
				return {
					workspaceId: requestedWorkspace.workspaceId,
					workspacePath: requestedWorkspace.repoPath,
					removedRequestedWorkspacePath,
					didPruneProjects: removedProjects.length > 0,
				};
			}
		}

		const fallbackWorkspace =
			existingProjects.find((project) => project.workspaceId === activeWorkspaceId) ?? existingProjects[0] ?? null;
		if (!fallbackWorkspace) {
			return {
				workspaceId: null,
				workspacePath: null,
				removedRequestedWorkspacePath,
				didPruneProjects: removedProjects.length > 0,
			};
		}
		return {
			workspaceId: fallbackWorkspace.workspaceId,
			workspacePath: fallbackWorkspace.repoPath,
			removedRequestedWorkspacePath,
			didPruneProjects: removedProjects.length > 0,
		};
	};

	return {
		getActiveWorkspaceId: () => activeWorkspaceId,
		getActiveWorkspacePath: () => activeWorkspacePath,
		getWorkspacePathById: (workspaceId: string) => workspacePathsById.get(workspaceId) ?? null,
		rememberWorkspace,
		getActiveRuntimeConfig: () => activeRuntimeConfig,
		setActiveRuntimeConfig: (config: RuntimeConfigState) => {
			globalRuntimeConfig = toGlobalRuntimeConfigState(config);
			activeRuntimeConfig = activeWorkspaceId ? config : globalRuntimeConfig;
		},
		loadScopedRuntimeConfig: async (scope: WorkspaceRegistryScope) => {
			if (scope.workspaceId === activeWorkspaceId) {
				return activeRuntimeConfig;
			}
			return await deps.loadRuntimeConfig(scope.workspacePath);
		},
		getTerminalManagerForWorkspace,
		ensureTerminalManagerForWorkspace,
		setActiveWorkspace,
		clearActiveWorkspace,
		disposeWorkspace,
		summarizeProjectTaskCounts,
		createProjectSummary: toProjectSummary,
		setNKleinSessionSummariesProvider: (provider) => {
			nkleinSessionSummariesProvider = provider;
		},
		buildWorkspaceStateSnapshot,
		buildProjectsPayload,
		resolveWorkspaceForStream,
		listManagedWorkspaces: () => {
			return Array.from(terminalManagersByWorkspaceId.entries()).map(([workspaceId, terminalManager]) => ({
				workspaceId,
				workspacePath: workspacePathsById.get(workspaceId) ?? null,
				terminalManager,
			}));
		},
	};
}
