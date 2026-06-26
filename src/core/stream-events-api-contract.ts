import { z } from "zod";
import { runtimeTaskChatMessageSchema } from "./task-chat-api-contract.js";
import { runtimeTaskSessionSummarySchema } from "./task-session-api-contract.js";
import {
	runtimeProjectSummarySchema,
	runtimeWorkspaceMetadataSchema,
	runtimeWorkspaceStateResponseSchema,
} from "./workspace-projects-api-contract.js";

// Runtime state-stream contract domain: the MCP server auth-status + NKlein team-progress event (both carried
// by the stream), and every WS state-stream message (snapshot / workspace-state / task-sessions / projects /
// metadata / ready-for-review / task-chat / cleared / team-progress / mcp-auth / session-context / error) + the
// discriminated-union message type. Split out of api-contract.ts (§5.X #2). Imports z + chat-message (task-chat)
// + project-summary / workspace metadata+state (workspace-projects) + task-session-summary — never the barrel.

export const runtimeNKleinMcpServerAuthStatusSchema = z.object({
	serverName: z.string(),
	oauthSupported: z.boolean(),
	oauthConfigured: z.boolean(),
	lastError: z.string().nullable(),
	lastAuthenticatedAt: z.number().nullable(),
});
export type RuntimeNKleinMcpServerAuthStatus = z.infer<typeof runtimeNKleinMcpServerAuthStatusSchema>;

export const runtimeNKleinTeamProgressEventSchema = z.object({
	taskId: z.string(),
	teamName: z.string().nullable(),
	eventType: z.string(),
	agentId: z.string().nullable(),
	role: z.string().nullable(),
	runId: z.string().nullable(),
	status: z.string().nullable(),
	message: z.string(),
	createdAt: z.number(),
});
export type RuntimeNKleinTeamProgressEvent = z.infer<typeof runtimeNKleinTeamProgressEventSchema>;

export const runtimeStateStreamSnapshotMessageSchema = z.object({
	type: z.literal("snapshot"),
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
	workspaceState: runtimeWorkspaceStateResponseSchema.nullable(),
	workspaceMetadata: runtimeWorkspaceMetadataSchema.nullable(),
	nkleinSessionContextVersion: z.number().int().nonnegative(),
});
export type RuntimeStateStreamSnapshotMessage = z.infer<typeof runtimeStateStreamSnapshotMessageSchema>;

export const runtimeStateStreamWorkspaceStateMessageSchema = z.object({
	type: z.literal("workspace_state_updated"),
	workspaceId: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema,
});
export type RuntimeStateStreamWorkspaceStateMessage = z.infer<typeof runtimeStateStreamWorkspaceStateMessageSchema>;

export const runtimeStateStreamTaskSessionsMessageSchema = z.object({
	type: z.literal("task_sessions_updated"),
	workspaceId: z.string(),
	summaries: z.array(runtimeTaskSessionSummarySchema),
});
export type RuntimeStateStreamTaskSessionsMessage = z.infer<typeof runtimeStateStreamTaskSessionsMessageSchema>;

export const runtimeStateStreamProjectsMessageSchema = z.object({
	type: z.literal("projects_updated"),
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
});
export type RuntimeStateStreamProjectsMessage = z.infer<typeof runtimeStateStreamProjectsMessageSchema>;

export const runtimeStateStreamWorkspaceMetadataMessageSchema = z.object({
	type: z.literal("workspace_metadata_updated"),
	workspaceId: z.string(),
	workspaceMetadata: runtimeWorkspaceMetadataSchema,
});
export type RuntimeStateStreamWorkspaceMetadataMessage = z.infer<
	typeof runtimeStateStreamWorkspaceMetadataMessageSchema
>;

export const runtimeStateStreamTaskReadyForReviewMessageSchema = z.object({
	type: z.literal("task_ready_for_review"),
	workspaceId: z.string(),
	taskId: z.string(),
	triggeredAt: z.number(),
});
export type RuntimeStateStreamTaskReadyForReviewMessage = z.infer<
	typeof runtimeStateStreamTaskReadyForReviewMessageSchema
>;

export const runtimeStateStreamTaskChatMessageSchema = z.object({
	type: z.literal("task_chat_message"),
	workspaceId: z.string(),
	taskId: z.string(),
	message: z.lazy(() => runtimeTaskChatMessageSchema),
});
export type RuntimeStateStreamTaskChatMessage = z.infer<typeof runtimeStateStreamTaskChatMessageSchema>;

export const runtimeStateStreamTaskChatClearedMessageSchema = z.object({
	type: z.literal("task_chat_cleared"),
	workspaceId: z.string(),
	taskId: z.string(),
});
export type RuntimeStateStreamTaskChatClearedMessage = z.infer<typeof runtimeStateStreamTaskChatClearedMessageSchema>;

export const runtimeStateStreamNKleinTeamProgressMessageSchema = z.object({
	type: z.literal("nklein_team_progress"),
	workspaceId: z.string(),
	taskId: z.string(),
	event: runtimeNKleinTeamProgressEventSchema,
});
export type RuntimeStateStreamNKleinTeamProgressMessage = z.infer<
	typeof runtimeStateStreamNKleinTeamProgressMessageSchema
>;

export const runtimeStateStreamMcpAuthUpdatedMessageSchema = z.object({
	type: z.literal("mcp_auth_updated"),
	statuses: z.array(runtimeNKleinMcpServerAuthStatusSchema),
});
export type RuntimeStateStreamMcpAuthUpdatedMessage = z.infer<typeof runtimeStateStreamMcpAuthUpdatedMessageSchema>;

export const runtimeStateStreamNKleinSessionContextUpdatedMessageSchema = z.object({
	type: z.literal("nklein_session_context_updated"),
	version: z.number().int().nonnegative(),
});
export type RuntimeStateStreamNKleinSessionContextUpdatedMessage = z.infer<
	typeof runtimeStateStreamNKleinSessionContextUpdatedMessageSchema
>;

export const runtimeStateStreamErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type RuntimeStateStreamErrorMessage = z.infer<typeof runtimeStateStreamErrorMessageSchema>;

export const runtimeStateStreamMessageSchema = z.discriminatedUnion("type", [
	runtimeStateStreamSnapshotMessageSchema,
	runtimeStateStreamWorkspaceStateMessageSchema,
	runtimeStateStreamTaskSessionsMessageSchema,
	runtimeStateStreamProjectsMessageSchema,
	runtimeStateStreamWorkspaceMetadataMessageSchema,
	runtimeStateStreamTaskReadyForReviewMessageSchema,
	runtimeStateStreamTaskChatMessageSchema,
	runtimeStateStreamTaskChatClearedMessageSchema,
	runtimeStateStreamNKleinTeamProgressMessageSchema,
	runtimeStateStreamMcpAuthUpdatedMessageSchema,
	runtimeStateStreamNKleinSessionContextUpdatedMessageSchema,
	runtimeStateStreamErrorMessageSchema,
]);
export type RuntimeStateStreamMessage = z.infer<typeof runtimeStateStreamMessageSchema>;
