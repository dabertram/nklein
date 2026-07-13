import type {
	RuntimeBoardData,
	RuntimeProjectHealthIssue,
	RuntimeProjectSummary,
	RuntimeProjectTaskCounts,
} from "../core/api-contract";
import type { TerminalSessionManager } from "../terminal/session-manager";

interface DisposeWorkspaceOptions {
	stopTerminalSessions?: boolean;
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
		displayName?: string | null;
		autoResumeEnabled?: boolean;
		healthIssues?: RuntimeProjectHealthIssue[];
	}) => RuntimeProjectSummary;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void> | void;
	getTerminalManagerForWorkspace: (workspaceId: string) => TerminalSessionManager | null;
	disposeWorkspace: (
		workspaceId: string,
		options?: DisposeWorkspaceOptions,
	) => { terminalManager: TerminalSessionManager | null; workspacePath: string | null };
	collectProjectTaskIdsForRemoval: (board: RuntimeBoardData) => Set<string>;
	warn: (message: string) => void;
	buildProjectsPayload: (preferredCurrentProjectId: string | null) => Promise<{
		currentProjectId: string | null;
		projects: RuntimeProjectSummary[];
	}>;
	pickDirectoryPathFromSystemDialog: () => string | null;
	serverCwd: string;
	/**
	 * Resolve the git root of !Klein's OWN source checkout for the self-improvement guard — defaults to the install
	 * location (where this module's code lives, via `import.meta.url`), independent of `serverCwd`. Injectable so tests
	 * can point it at a fixture repo. Returns null for a packaged (non-git) install — nothing to guard.
	 */
	resolveKleinSourceRepoPath?: () => Promise<string | null>;
	/**
	 * When true the server is bound to a non-loopback interface (--host mode)
	 * and path access must be confined to `allowedBrowseRoots`.
	 */
	isRemoteMode: boolean;
	/**
	 * The ordered set of allowed filesystem roots for remote-mode browsing and
	 * project creation.  Computed by `resolveRemoteBrowseRoots` in
	 * `runtime-server.ts` and passed in so the API layer stays pure/testable.
	 * Ignored when `isRemoteMode` is false.
	 */
	allowedBrowseRoots: readonly string[];
}
