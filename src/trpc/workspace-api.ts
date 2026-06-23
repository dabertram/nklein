import { TRPCError } from "@trpc/server";
import type {
	RuntimeGitCheckoutResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeWorkspaceChangesMode,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { parseGitCheckoutRequest, parseWorktreeDeleteRequest } from "../core/api-validation";
import type { NKleinTaskSessionService } from "../nklein-sdk/nklein-task-session-service";
import { saveWorkspaceState, WorkspaceStateConflictError } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import {
	createEmptyWorkspaceChangesResponse,
	getWorkspaceChanges,
	getWorkspaceChangesBetweenRefs,
} from "../workspace/get-workspace-changes";
import { getCommitDiff, getGitLog, getGitRefs } from "../workspace/git-history";
import { discardGitChanges, getGitSyncSummary, runGitCheckoutAction, runGitSyncAction } from "../workspace/git-sync";
import { searchWorkspaceFiles } from "../workspace/search-workspace-files";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { deleteTaskWorktree } from "../workspace/task-worktree";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateWorkspaceApiDependencies {
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	getScopedNKleinTaskSessionService: (scope: {
		workspaceId: string;
		workspacePath: string;
	}) => Promise<NKleinTaskSessionService>;
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void> | void;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void> | void;
	buildWorkspaceStateSnapshot: (workspaceId: string, workspacePath: string) => Promise<RuntimeWorkspaceStateResponse>;
}

function normalizeOptionalTaskWorkspaceScopeInput(
	input: { taskId: string; baseRef: string } | null,
): { taskId: string; baseRef: string } | null {
	if (!input) {
		return null;
	}
	const taskId = input.taskId.trim();
	const baseRef = input.baseRef.trim();
	if (!taskId || !baseRef) {
		throw new Error("baseRef query parameter requires taskId.");
	}
	return {
		taskId,
		baseRef,
	};
}

function normalizeRequiredTaskWorkspaceScopeInput(input: {
	taskId: string;
	baseRef: string;
	mode?: RuntimeWorkspaceChangesMode;
}): {
	taskId: string;
	baseRef: string;
	mode: RuntimeWorkspaceChangesMode;
} {
	const taskId = input.taskId.trim();
	const baseRef = input.baseRef.trim();
	if (!taskId) {
		throw new Error("Missing taskId query parameter.");
	}
	if (!baseRef) {
		throw new Error("Missing baseRef query parameter.");
	}
	const mode: RuntimeWorkspaceChangesMode = input.mode ?? "working_copy";
	return {
		taskId,
		baseRef,
		mode,
	};
}

function createEmptyGitSummaryErrorResponse(error: unknown): RuntimeGitSummaryResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		summary: {
			currentBranch: null,
			upstreamBranch: null,
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			aheadCount: 0,
			behindCount: 0,
		},
		error: message,
	};
}

function createEmptyGitSyncErrorResponse(action: RuntimeGitSyncAction, error: unknown): RuntimeGitSyncResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		action,
		summary: {
			currentBranch: null,
			upstreamBranch: null,
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			aheadCount: 0,
			behindCount: 0,
		},
		output: "",
		error: message,
	};
}

function createEmptyGitCheckoutErrorResponse(error: unknown): RuntimeGitCheckoutResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		branch: "",
		summary: {
			currentBranch: null,
			upstreamBranch: null,
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			aheadCount: 0,
			behindCount: 0,
		},
		output: "",
		error: message,
	};
}

function createEmptyGitDiscardErrorResponse(error: unknown): RuntimeGitDiscardResponse {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		summary: {
			currentBranch: null,
			upstreamBranch: null,
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			aheadCount: 0,
			behindCount: 0,
		},
		output: "",
		error: message,
	};
}

export function createWorkspaceApi(deps: CreateWorkspaceApiDependencies): RuntimeTrpcContext["workspaceApi"] {
	return {
		loadGitSummary: async (workspaceScope) => {
			try {
				// The only host-resolvable summary is the project repo's — a task has no per-task host worktree
				// (worktrees retired, §5.A); its result-branch delta is surfaced through workspace metadata instead.
				const summary = await getGitSyncSummary(workspaceScope.workspacePath);
				return {
					ok: true,
					summary,
				} satisfies RuntimeGitSummaryResponse;
			} catch (error) {
				return createEmptyGitSummaryErrorResponse(error);
			}
		},
		runGitSyncAction: async (workspaceScope, input) => {
			try {
				return await runGitSyncAction({
					cwd: workspaceScope.workspacePath,
					action: input.action,
				});
			} catch (error) {
				return createEmptyGitSyncErrorResponse(input.action, error);
			}
		},
		checkoutGitBranch: async (workspaceScope, input) => {
			try {
				const body = parseGitCheckoutRequest(input);
				const response = await runGitCheckoutAction({
					cwd: workspaceScope.workspacePath,
					branch: body.branch,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitCheckoutErrorResponse(error);
			}
		},
		discardGitChanges: async (workspaceScope) => {
			try {
				// Discard operates on the project repo working tree. A task has no per-task host worktree to reset
				// (worktrees retired, §5.A); abandoning a task's result is a separate result-branch operation.
				const response = await discardGitChanges({
					cwd: workspaceScope.workspacePath,
				});
				if (response.ok) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
			} catch (error) {
				return createEmptyGitDiscardErrorResponse(error);
			}
		},
		loadChanges: async (workspaceScope, input) => {
			const normalizedInput = normalizeRequiredTaskWorkspaceScopeInput(input);
			const taskResultCommit = await resolveTaskResultBranchCommit({
				repoPath: workspaceScope.workspacePath,
				taskId: normalizedInput.taskId,
			});
			if (taskResultCommit) {
				return await getWorkspaceChangesBetweenRefs({
					cwd: workspaceScope.workspacePath,
					fromRef: normalizedInput.baseRef,
					toRef: taskResultCommit,
				});
			}
			// No result branch yet: the task's work lives in its Docker sandbox (or it hasn't started). The host
			// working tree is untouched during a sandbox run, so there are no host-visible task changes to diff —
			// completed tasks surface their delta via the result branch above (the worktree subsystem is retired,
			// §5.A, and the legacy per-turn host-checkpoint diff went with it).
			return await createEmptyWorkspaceChangesResponse(workspaceScope.workspacePath);
		},
		deleteWorktree: async (workspaceScope, input) => {
			// Retained for `cleanupTaskWorkspace` (replay/trash) and to clean up any legacy on-disk worktrees from
			// pre-§5.A builds; a no-op for native NKlein tasks, which never create a host worktree.
			const body = parseWorktreeDeleteRequest(input);
			return await deleteTaskWorktree({
				repoPath: workspaceScope.workspacePath,
				taskId: body.taskId,
				preserveChanges: body.preserveChanges,
			});
		},
		searchFiles: async (workspaceScope, input) => {
			const query = input.query.trim();
			const limit = input.limit;
			const files = await searchWorkspaceFiles(workspaceScope.workspacePath, query, limit);
			return {
				query,
				files,
			} satisfies RuntimeWorkspaceFileSearchResponse;
		},
		loadState: async (workspaceScope) => {
			const state = await deps.buildWorkspaceStateSnapshot(workspaceScope.workspaceId, workspaceScope.workspacePath);
			const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
			for (const summary of nkleinTaskSessionService.listSummaries()) {
				state.sessions[summary.taskId] = summary;
			}
			return state;
		},
		notifyStateUpdated: async (workspaceScope) => {
			void deps.broadcastRuntimeWorkspaceStateUpdated(workspaceScope.workspaceId, workspaceScope.workspacePath);
			void deps.broadcastRuntimeProjectsUpdated(workspaceScope.workspaceId);
			return {
				ok: true,
			};
		},
		saveState: async (workspaceScope, input) => {
			try {
				const response = await saveWorkspaceState(workspaceScope.workspacePath, {
					board: input.board,
					...(input.sessions ? { sessions: input.sessions } : {}),
					expectedRevision: input.expectedRevision,
				});
				void deps.broadcastRuntimeWorkspaceStateUpdated(workspaceScope.workspaceId, workspaceScope.workspacePath);
				void deps.broadcastRuntimeProjectsUpdated(workspaceScope.workspaceId);
				return response;
			} catch (error) {
				if (error instanceof WorkspaceStateConflictError) {
					throw new TRPCError({
						code: "CONFLICT",
						message: error.message,
						cause: {
							currentRevision: error.currentRevision,
						},
					});
				}
				throw error;
			}
		},
		loadWorkspaceChanges: async (workspaceScope) => {
			return await getWorkspaceChanges(workspaceScope.workspacePath);
		},
		loadGitLog: async (workspaceScope, input) => {
			const taskScope = normalizeOptionalTaskWorkspaceScopeInput(input.taskScope ?? null);
			// A task's inspectable history is its `nklein/tasks/<task>` result branch, whose commits live in the
			// project repo's shared object DB — so we log that commit from the project repo path, never a host
			// worktree (worktree subsystem retired, §5.A). With no result branch yet, fall back to the requested ref.
			const taskResultCommit = taskScope
				? await resolveTaskResultBranchCommit({ repoPath: workspaceScope.workspacePath, taskId: taskScope.taskId })
				: null;
			return await getGitLog({
				cwd: workspaceScope.workspacePath,
				ref: taskResultCommit ?? input.ref ?? null,
				refs: input.refs ?? null,
				maxCount: input.maxCount,
				skip: input.skip,
			});
		},
		loadGitRefs: async (workspaceScope) => {
			// Refs are repo-wide — the task's `nklein/tasks/<task>` result branch is itself a ref in the project
			// repo — so task-scoped refs come straight from the project repo path, with no host worktree (§5.A).
			return await getGitRefs(workspaceScope.workspacePath);
		},
		loadCommitDiff: async (workspaceScope, input) => {
			// Commit objects are shared across the repo (the task result commit lives in the project repo's object
			// DB via its `nklein/tasks/<task>` branch), so diffs resolve against the project repo path — no worktree.
			return await getCommitDiff({
				cwd: workspaceScope.workspacePath,
				commitHash: input.commitHash,
			});
		},
	};
}
