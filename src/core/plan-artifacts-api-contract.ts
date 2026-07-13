import { z } from "zod";
import { planGapKindSchema } from "./plan-gap-kind.js";
import { runtimeWorkspaceStateResponseSchema } from "./workspace-projects-api-contract.js";

// NKlein plan-artifacts contract domain: plan-artifact summary + list request/response, artifact action
// (apply / reject), the record-plan-gap request/response, and expand-plan-task (item / request / response).
// Split out of api-contract.ts (§5.X #2). Imports z + planGapKind (plan-gap-kind) + workspace-state-response
// (workspace-projects) — never the barrel.

export const runtimeNKleinPlanArtifactSummarySchema = z.object({
	artifactId: z.string(),
	artifactKind: z.enum(["decomposition", "buildout", "spec"]),
	planSlug: z.string(),
	title: z.string(),
	sourceTaskId: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	validationStatus: z.enum(["valid", "invalid", "pending"]),
	applicationStatus: z.enum(["pending", "applied", "rejected"]),
	taskCount: z.number().int().nonnegative(),
	dependencyCount: z.number().int().nonnegative(),
	specPath: z.string(),
	planPath: z.string(),
	summaryPath: z.string(),
	taskGraphPath: z.string(),
});
export type RuntimeNKleinPlanArtifactSummary = z.infer<typeof runtimeNKleinPlanArtifactSummarySchema>;

export const runtimeNKleinPlanArtifactsRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeNKleinPlanArtifactsRequest = z.infer<typeof runtimeNKleinPlanArtifactsRequestSchema>;

export const runtimeNKleinPlanArtifactsResponseSchema = z.object({
	artifacts: z.array(runtimeNKleinPlanArtifactSummarySchema),
});
export type RuntimeNKleinPlanArtifactsResponse = z.infer<typeof runtimeNKleinPlanArtifactsResponseSchema>;

// F1.3d — answer one open plan question (operator path). Resolution persists through the plan artifacts
// (questions.md rewrite + clarification_resolved revision) and resumes the exact card parked on the question.
export const runtimeAnswerPlanQuestionRequestSchema = z.object({
	planSlug: z.string().min(1),
	questionId: z.string().min(1),
	selectedOptionIds: z.array(z.string()).optional(),
	freeText: z.string().optional(),
});
export type RuntimeAnswerPlanQuestionRequest = z.infer<typeof runtimeAnswerPlanQuestionRequestSchema>;

export const runtimeAnswerPlanQuestionResponseSchema = z.object({
	ok: z.boolean(),
	/** The question's status after the answer (unchanged when the submission was empty). */
	questionStatus: z.enum(["open", "answered", "assumed-default"]).nullable(),
	/** The card that was parked on this question and has now been resumed, when any. */
	resumedTaskId: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeAnswerPlanQuestionResponse = z.infer<typeof runtimeAnswerPlanQuestionResponseSchema>;

export const runtimeNKleinPlanArtifactActionRequestSchema = z.object({
	artifactId: z.string().min(1),
});
export type RuntimeNKleinPlanArtifactActionRequest = z.infer<typeof runtimeNKleinPlanArtifactActionRequestSchema>;

export const runtimeNKleinPlanArtifactApplyResponseSchema = z.object({
	ok: z.boolean(),
	artifact: runtimeNKleinPlanArtifactSummarySchema,
	createdTaskCount: z.number().int().nonnegative(),
	createdDependencyCount: z.number().int().nonnegative(),
	message: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema,
});
export type RuntimeNKleinPlanArtifactApplyResponse = z.infer<typeof runtimeNKleinPlanArtifactApplyResponseSchema>;

export const runtimeNKleinPlanArtifactRejectResponseSchema = z.object({
	ok: z.boolean(),
	artifact: runtimeNKleinPlanArtifactSummarySchema,
	message: z.string(),
});
export type RuntimeNKleinPlanArtifactRejectResponse = z.infer<typeof runtimeNKleinPlanArtifactRejectResponseSchema>;

export const runtimeRecordNKleinPlanGapRequestSchema = z.object({
	taskId: z.string().min(1),
	kind: planGapKindSchema,
	description: z.string().min(1),
	evidence: z.string().optional(),
});
export type RuntimeRecordNKleinPlanGapRequest = z.infer<typeof runtimeRecordNKleinPlanGapRequestSchema>;

export const runtimeRecordNKleinPlanGapResponseSchema = z.object({
	ok: z.boolean(),
	taskId: z.string(),
	kind: planGapKindSchema,
	message: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema.optional(),
});
export type RuntimeRecordNKleinPlanGapResponse = z.infer<typeof runtimeRecordNKleinPlanGapResponseSchema>;

// ---------------------------------------------------------------------------
// expand-plan-task — split one plan task into replacement tasks (web-ui path 2b:
// user-authored replacements; agent-discovery can layer on later once the model
// writes proposed replacements as a discoverable artifact type).
// ---------------------------------------------------------------------------

export const runtimeExpandNKleinPlanTaskItemSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	prompt: z.string().min(1),
	dependsOn: z.array(z.string()).default([]),
	complexity: z.number().min(0).max(100).default(50),
	/** Shell command used to verify the task is done (required by the plan validator). */
	acceptanceCommand: z.string().min(1),
});
export type RuntimeExpandNKleinPlanTaskItem = z.infer<typeof runtimeExpandNKleinPlanTaskItemSchema>;

export const runtimeExpandNKleinPlanTaskRequestSchema = z.object({
	/** The board task ID whose plan task to replace. */
	taskId: z.string().min(1),
	/**
	 * The plan slug that contains the task. When omitted the server infers it
	 * from the taskId using the same heuristic as recordNKleinPlanGap.
	 */
	planSlug: z.string().optional(),
	/** The plan-task ID inside the task graph to replace (defaults to inferred from taskId). */
	planTaskId: z.string().optional(),
	/** The replacement tasks that will replace the target plan task. At least one required. */
	replacements: z.array(runtimeExpandNKleinPlanTaskItemSchema).min(1),
	/** Optional human-readable rationale written to the plan revisions log. */
	description: z.string().optional(),
});
export type RuntimeExpandNKleinPlanTaskRequest = z.infer<typeof runtimeExpandNKleinPlanTaskRequestSchema>;

export const runtimeExpandNKleinPlanTaskResponseSchema = z.object({
	ok: z.boolean(),
	taskId: z.string(),
	planSlug: z.string(),
	planTaskId: z.string(),
	replacementTaskIds: z.array(z.string()),
	entryTaskIds: z.array(z.string()),
	terminalTaskIds: z.array(z.string()),
	taskGraphPath: z.string(),
	revisionsPath: z.string(),
	message: z.string(),
});
export type RuntimeExpandNKleinPlanTaskResponse = z.infer<typeof runtimeExpandNKleinPlanTaskResponseSchema>;
