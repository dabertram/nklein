import { z } from "zod";
import { runtimeBoardCardSchema } from "./board-api-contract.js";
import { runtimeProjectSummarySchema } from "./workspace-projects-api-contract.js";

// Projects + dev-test contract domain: projects-response, project add/remove, dev-test project
// scenario/preset/request/registry/response, self-improvement project, dev-test cleanup, directory picker +
// listing, artifact migration, worktree delete, the task-workspace-info (task-scope) request/response, and
// project shortcuts. Split out of api-contract.ts (§5.X #2). Imports z + board-card (board) + project-summary
// (workspace-projects) — never the barrel.

export const runtimeProjectsResponseSchema = z.object({
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
});
export type RuntimeProjectsResponse = z.infer<typeof runtimeProjectsResponseSchema>;

export const runtimeProjectAddRequestSchema = z
	.object({
		path: z.string().optional(),
		gitUrl: z.string().optional(),
		ref: z.string().optional(),
		projectName: z.string().optional(),
		createDirectory: z.boolean().optional(),
		initializeGit: z.boolean().optional(),
		confirmSelfProject: z.boolean().optional(),
		allowTaskWorktreeProject: z.boolean().optional(),
	})
	.refine((data) => data.path || data.gitUrl, { message: "Either path or gitUrl is required" });
export type RuntimeProjectAddRequest = z.infer<typeof runtimeProjectAddRequestSchema>;

export const runtimeProjectAddResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	requiresGitInitialization: z.boolean().optional(),
	requiresSelfProjectConfirmation: z.boolean().optional(),
	requiresTaskWorktreeProjectConfirmation: z.boolean().optional(),
	error: z.string().optional(),
});
export type RuntimeProjectAddResponse = z.infer<typeof runtimeProjectAddResponseSchema>;

export const runtimeDevTestProjectScenarioSchema = z.object({
	id: z.string(),
	title: z.string(),
	prompt: z.string(),
	acceptanceCommand: z.string(),
	complexity: z.number().nullable(),
	filesLikelyTouched: z.array(z.string()),
});
export type RuntimeDevTestProjectScenario = z.infer<typeof runtimeDevTestProjectScenarioSchema>;

/**
 * The dev-test scenario presets — kept in lock-step with `NKleinDevTestProjectPreset`
 * ([nklein-dev-test-project.ts](../nklein-agent/nklein-dev-test-project.ts), the source of truth + implementation). The
 * DAG-shape presets (`wide_fanout`/`deep_chain`/`mixed_dag`/`many_small`, §5.O) were implemented in the module but were
 * missing here, so the runtime API rejected them — the C5/C6 challenge substrates couldn't be scouted (todo §5.AF scout,
 * 2026-06-28). A `node:*`-free contract can't import the agent type to assert the drift, so the module carries a
 * compile-time guard against THIS list instead.
 */
export const runtimeDevTestProjectPresetSchema = z.enum([
	"mid_task",
	"complex_dag",
	"audio_vst",
	"daw_foundation",
	"wide_fanout",
	"deep_chain",
	"mixed_dag",
	"many_small",
]);
export type RuntimeDevTestProjectPreset = z.infer<typeof runtimeDevTestProjectPresetSchema>;

export const runtimeDevTestProjectRequestSchema = z
	.object({
		preset: runtimeDevTestProjectPresetSchema.optional(),
		/** Registry project id — alternative to preset; start any folder-based registry project by id. */
		registryId: z.string().min(1).optional(),
	})
	.optional();
export type RuntimeDevTestProjectRequest = z.infer<typeof runtimeDevTestProjectRequestSchema>;

/** Lightweight summary of a single registry project — safe for the browser bundle (no node:* imports). */
export const runtimeDevTestRegistryEntrySchema = z.object({
	id: z.string(),
	title: z.string(),
	tier: z.string().optional(),
	tags: z.array(z.string()).optional(),
	complexity: z.number().optional(),
});
export type RuntimeDevTestRegistryEntry = z.infer<typeof runtimeDevTestRegistryEntrySchema>;

export const runtimeDevTestProjectRegistryResponseSchema = z.object({
	entries: z.array(runtimeDevTestRegistryEntrySchema),
});
export type RuntimeDevTestProjectRegistryResponse = z.infer<typeof runtimeDevTestProjectRegistryResponseSchema>;

export const runtimeDevTestProjectResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	task: runtimeBoardCardSchema.nullable(),
	tasks: z.array(runtimeBoardCardSchema).default([]),
	scenario: runtimeDevTestProjectScenarioSchema.nullable(),
	workspacePath: z.string().nullable(),
	evidenceRootPath: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeDevTestProjectResponse = z.infer<typeof runtimeDevTestProjectResponseSchema>;

export const runtimeSelfImprovementProjectRequestSchema = z
	.object({
		notes: z.string().optional(),
		evidenceBundlePath: z.string().optional(),
		confirmSelfProject: z.boolean().optional(),
	})
	.optional();
export type RuntimeSelfImprovementProjectRequest = z.infer<typeof runtimeSelfImprovementProjectRequestSchema>;

export const runtimeSelfImprovementProjectResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	task: runtimeBoardCardSchema.nullable(),
	workspacePath: z.string().nullable(),
	source: z.literal("current_dev_checkout").nullable(),
	requiresSelfProjectConfirmation: z.boolean().optional(),
	error: z.string().optional(),
});
export type RuntimeSelfImprovementProjectResponse = z.infer<typeof runtimeSelfImprovementProjectResponseSchema>;

export const runtimeDevTestCleanupResponseSchema = z.object({
	ok: z.boolean(),
	removedProjects: z.number(),
	errors: z.array(z.string()).default([]),
	error: z.string().optional(),
});
export type RuntimeDevTestCleanupResponse = z.infer<typeof runtimeDevTestCleanupResponseSchema>;

export const runtimeProjectDirectoryPickerResponseSchema = z.object({
	ok: z.boolean(),
	path: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeProjectDirectoryPickerResponse = z.infer<typeof runtimeProjectDirectoryPickerResponseSchema>;

export const runtimeDirectoryListEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	isGitRepository: z.boolean(),
});
export type RuntimeDirectoryListEntry = z.infer<typeof runtimeDirectoryListEntrySchema>;

export const runtimeDirectoryListRequestSchema = z.object({
	path: z.string().optional(),
});
export type RuntimeDirectoryListRequest = z.infer<typeof runtimeDirectoryListRequestSchema>;

export const runtimeDirectoryListResponseSchema = z.object({
	ok: z.boolean(),
	currentPath: z.string(),
	parentPath: z.string().nullable(),
	rootPath: z.string(),
	entries: z.array(runtimeDirectoryListEntrySchema),
	error: z.string().optional(),
});
export type RuntimeDirectoryListResponse = z.infer<typeof runtimeDirectoryListResponseSchema>;

export const runtimeProjectRemoveRequestSchema = z.object({
	projectId: z.string(),
	deleteGitRepository: z.boolean().optional(),
});
export type RuntimeProjectRemoveRequest = z.infer<typeof runtimeProjectRemoveRequestSchema>;

export const runtimeProjectRemoveResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeProjectRemoveResponse = z.infer<typeof runtimeProjectRemoveResponseSchema>;

export const runtimeProjectAutoResumeRequestSchema = z.object({
	projectId: z.string().min(1),
	enabled: z.boolean(),
});
export type RuntimeProjectAutoResumeRequest = z.infer<typeof runtimeProjectAutoResumeRequestSchema>;

export const runtimeProjectAutoResumeResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeProjectAutoResumeResponse = z.infer<typeof runtimeProjectAutoResumeResponseSchema>;

export const runtimeProjectArtifactMigrationRequestSchema = z.object({
	projectId: z.string().min(1),
});
export type RuntimeProjectArtifactMigrationRequest = z.infer<typeof runtimeProjectArtifactMigrationRequestSchema>;

export const runtimeProjectArtifactMigrationResponseSchema = z.object({
	ok: z.boolean(),
	migratedArtifacts: z.number().int().nonnegative(),
	skippedArtifacts: z.number().int().nonnegative(),
	parentWorkspaceId: z.string().nullable(),
	parentWorkspacePath: z.string().nullable(),
	errors: z.array(z.string()).default([]),
	error: z.string().optional(),
});
export type RuntimeProjectArtifactMigrationResponse = z.infer<typeof runtimeProjectArtifactMigrationResponseSchema>;

// Trash/replay artifact cleanup (P0.9b — replaces the retired `deleteWorktree` surface): discards a task's durable
// artifacts (result branch, speculative candidate branch, trashed patch snapshots). No host worktree is involved.
export const runtimeTaskArtifactsDeleteRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskArtifactsDeleteRequest = z.infer<typeof runtimeTaskArtifactsDeleteRequestSchema>;

export const runtimeTaskArtifactsDeleteResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeTaskArtifactsDeleteResponse = z.infer<typeof runtimeTaskArtifactsDeleteResponseSchema>;

export const runtimeTaskWorkspaceInfoRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
});
export type RuntimeTaskWorkspaceInfoRequest = z.infer<typeof runtimeTaskWorkspaceInfoRequestSchema>;

export const runtimeTaskWorkspaceInfoResponseSchema = z.object({
	taskId: z.string(),
	path: z.string(),
	exists: z.boolean(),
	baseRef: z.string(),
	branch: z.string().nullable(),
	isDetached: z.boolean(),
	headCommit: z.string().nullable(),
});
export type RuntimeTaskWorkspaceInfoResponse = z.infer<typeof runtimeTaskWorkspaceInfoResponseSchema>;

export const runtimeProjectShortcutSchema = z.object({
	label: z.string(),
	command: z.string(),
	icon: z.string().optional(),
});
export type RuntimeProjectShortcut = z.infer<typeof runtimeProjectShortcutSchema>;
