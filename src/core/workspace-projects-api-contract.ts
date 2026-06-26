import { z } from "zod";
import { runtimeBoardDataSchema } from "./board-api-contract.js";
import { runtimeGitRepositoryInfoSchema, runtimeGitSyncSummarySchema } from "./git-sync-api-contract.js";
import { runtimeTaskSessionSummarySchema } from "./task-session-api-contract.js";

// Workspace + project state contract domain: the workspace-state response/save/conflict/notify, project
// task-counts / health / summary, and task-workspace + workspace metadata. Split out of api-contract.ts
// (§5.X #2). Imports `z` + board-data (board), git repo-info/sync-summary (git-sync), and the task-session
// summary — never the barrel (no load-order cycle).

export const runtimeWorkspaceStateResponseSchema = z.object({
	repoPath: z.string(),
	statePath: z.string(),
	git: runtimeGitRepositoryInfoSchema,
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema),
	revision: z.number(),
});
export type RuntimeWorkspaceStateResponse = z.infer<typeof runtimeWorkspaceStateResponseSchema>;

export const runtimeWorkspaceStateSaveRequestSchema = z.object({
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema).optional(),
	expectedRevision: z.number().int().nonnegative().optional(),
});
export type RuntimeWorkspaceStateSaveRequest = z.infer<typeof runtimeWorkspaceStateSaveRequestSchema>;

export const runtimeWorkspaceStateConflictResponseSchema = z.object({
	error: z.string(),
	currentRevision: z.number(),
});
export type RuntimeWorkspaceStateConflictResponse = z.infer<typeof runtimeWorkspaceStateConflictResponseSchema>;

export const runtimeWorkspaceStateNotifyResponseSchema = z.object({
	ok: z.boolean(),
});
export type RuntimeWorkspaceStateNotifyResponse = z.infer<typeof runtimeWorkspaceStateNotifyResponseSchema>;

export const runtimeProjectTaskCountsSchema = z.object({
	backlog: z.number(),
	planning: z.number().default(0),
	in_progress: z.number(),
	review: z.number(),
	completed: z.number(),
	trash: z.number(),
});
export type RuntimeProjectTaskCounts = z.infer<typeof runtimeProjectTaskCountsSchema>;

export const runtimeProjectHealthIssueSchema = z.object({
	kind: z.enum([
		"task_worktree_project",
		"missing_parent_workspace",
		"pending_plan_artifacts",
		"lost_session_pending_artifacts",
	]),
	severity: z.enum(["warning", "error"]),
	title: z.string(),
	message: z.string(),
	taskId: z.string().nullable(),
	parentWorkspaceId: z.string().nullable(),
	parentWorkspacePath: z.string().nullable(),
	artifactCount: z.number().int().nonnegative(),
	canRemove: z.boolean(),
	canMigrateArtifacts: z.boolean(),
});
export type RuntimeProjectHealthIssue = z.infer<typeof runtimeProjectHealthIssueSchema>;

export const runtimeProjectSummarySchema = z.object({
	id: z.string(),
	path: z.string(),
	name: z.string(),
	taskCounts: runtimeProjectTaskCountsSchema,
	gitRepositoryCreatedByKanban: z.boolean().optional(),
	healthIssues: z.array(runtimeProjectHealthIssueSchema).optional(),
});
export type RuntimeProjectSummary = z.infer<typeof runtimeProjectSummarySchema>;

export const runtimeTaskWorkspaceMetadataSchema = z.object({
	taskId: z.string(),
	path: z.string(),
	exists: z.boolean(),
	baseRef: z.string(),
	branch: z.string().nullable(),
	isDetached: z.boolean(),
	headCommit: z.string().nullable(),
	changedFiles: z.number().nullable(),
	additions: z.number().nullable(),
	deletions: z.number().nullable(),
	stateVersion: z.number().int().nonnegative(),
});
export type RuntimeTaskWorkspaceMetadata = z.infer<typeof runtimeTaskWorkspaceMetadataSchema>;

export const runtimeWorkspaceMetadataSchema = z.object({
	homeGitSummary: runtimeGitSyncSummarySchema.nullable(),
	homeGitStateVersion: z.number().int().nonnegative(),
	taskWorkspaces: z.array(runtimeTaskWorkspaceMetadataSchema),
});
export type RuntimeWorkspaceMetadata = z.infer<typeof runtimeWorkspaceMetadataSchema>;
