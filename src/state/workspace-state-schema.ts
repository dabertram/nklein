import { z } from "zod";
import { runtimeTaskSessionSummarySchema, runtimeWorkspaceStateSaveRequestSchema } from "../core/api-contract";
import {
	getCanonicalTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	getWorkspaceDirectoryPath,
	getWorkspacesRootPath,
} from "./workspace-state-paths";

// Re-exported for API compatibility — the workspace on-disk layout + path helpers now live in their own module (§5.U).
export {
	getCanonicalTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	getWorkspaceDirectoryPath,
	getWorkspacesRootPath,
};

export const INDEX_VERSION = 1;
export const WORKSPACE_ID_COLLISION_SUFFIX_LENGTH = 4;

export interface WorkspaceIndexEntry {
	workspaceId: string;
	repoPath: string;
	gitRepositoryCreatedByKanban?: boolean;
	displayName?: string;
	selfProjectConfirmed?: boolean;
}

export interface RuntimeWorkspaceIndexEntry {
	workspaceId: string;
	repoPath: string;
	gitRepositoryCreatedByKanban: boolean;
	displayName: string | null;
	selfProjectConfirmed: boolean;
}

export interface WorkspaceIndexFile {
	version: number;
	entries: Record<string, WorkspaceIndexEntry>;
	repoPathToId: Record<string, string>;
}

export interface WorkspaceStateMeta {
	revision: number;
	updatedAt: number;
}

export interface WorkspaceLocalIdentity {
	version: 1;
	workspaceId: string;
	repoPath: string;
	updatedAt: number;
}

export const workspaceLocalIdentitySchema = z.object({
	version: z.literal(1),
	workspaceId: z.string().min(1, "Workspace ID cannot be empty."),
	repoPath: z.string().min(1, "Workspace repository path cannot be empty."),
	updatedAt: z.number(),
});

export const workspaceStateMetaSchema = z.object({
	revision: z.number().int().nonnegative(),
	updatedAt: z.number(),
});

export const workspaceIndexEntrySchema = z.object({
	workspaceId: z.string().min(1, "Workspace ID cannot be empty."),
	repoPath: z.string().min(1, "Workspace repository path cannot be empty."),
	gitRepositoryCreatedByKanban: z.boolean().optional(),
	displayName: z.string().optional(),
	selfProjectConfirmed: z.boolean().optional(),
});

export const workspaceIndexFileSchema = z
	.object({
		version: z.literal(INDEX_VERSION),
		entries: z.record(z.string(), workspaceIndexEntrySchema),
		repoPathToId: z.record(z.string(), z.string().min(1, "Workspace ID cannot be empty.")),
	})
	.superRefine((index, context) => {
		for (const [workspaceId, entry] of Object.entries(index.entries)) {
			if (entry.workspaceId !== workspaceId) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["entries", workspaceId, "workspaceId"],
					message: `Workspace ID must match entry key "${workspaceId}".`,
				});
			}
			const mappedWorkspaceId = index.repoPathToId[entry.repoPath];
			if (mappedWorkspaceId !== workspaceId) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["entries", workspaceId, "repoPath"],
					message: `Missing repoPathToId mapping for "${entry.repoPath}" to "${workspaceId}".`,
				});
			}
		}

		for (const [repoPath, workspaceId] of Object.entries(index.repoPathToId)) {
			const entry = index.entries[workspaceId];
			if (!entry) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["repoPathToId", repoPath],
					message: `Mapped workspace "${workspaceId}" does not exist in entries.`,
				});
				continue;
			}
			if (entry.repoPath !== repoPath) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["repoPathToId", repoPath],
					message: `Mapped repoPath does not match workspace entry path "${entry.repoPath}".`,
				});
			}
		}
	});

export const workspaceSessionsSchema = z
	.record(z.string(), runtimeTaskSessionSummarySchema)
	.superRefine((sessions, context) => {
		for (const [taskId, session] of Object.entries(sessions)) {
			if (session.taskId !== taskId) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [taskId, "taskId"],
					message: `Session taskId must match record key "${taskId}".`,
				});
			}
		}
	});

export const internalWorkspaceStateSaveRequestSchema = runtimeWorkspaceStateSaveRequestSchema.extend({
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema).optional(),
});
