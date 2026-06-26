import { z } from "zod";

export type { PlanGapKind } from "./plan-gap-kind.js";

import { runtimeTaskWorkspaceInfoRequestSchema } from "./projects-api-contract.js";
import { runtimeTaskSessionSummarySchema } from "./task-session-api-contract.js";

// Board contract domain (task images, generated-from-plan, card review, focus chains, cards/columns/deps/data) (§5.X #2).
export * from "./board-api-contract.js";
// Board-independent unified chat (todo §5.M) lives in its own contract module; re-exported here so the single
// `@runtime-contract` alias (and `@/runtime/types` in the web-ui) surfaces the chat wire types too.
export * from "./chat-api-contract.js";
// Runtime config + agents contract domain (agent definition + sandbox status, config response/save) (§5.X #2).
export * from "./config-api-contract.js";
// Git sync contract domain (repo info, fetch/pull/push sync, checkout, discard) (§5.X #2).
export * from "./git-sync-api-contract.js";
// NKlein MCP contract domain (server config, settings response/save, auth-status, oauth) (§5.X #2).
export * from "./nklein-mcp-api-contract.js";
// NKlein misc-ops domain (core-py health, merge history, advisor, dogfood, smoke-eval, task-evidence) (§5.X #2).
export * from "./nklein-ops-api-contract.js";
// NKlein account/provider/model-registry domain (oauth/provider-settings/account/catalog/models/registry/code-intel) (§5.X #2).
export * from "./nklein-provider-api-contract.js";
// NKlein provider-mutation + auth domain (capability, add/update provider, oauth-login, device-auth, settings-save) (§5.X #2).
export * from "./nklein-provider-mutations-api-contract.js";
// NKlein plan-artifacts contract domain (artifact summary/list/apply/reject, record-plan-gap, expand-plan-task) (§5.X #2).
export * from "./plan-artifacts-api-contract.js";
// Projects + dev-test contract domain (projects/dev-test/directory/remove/migration/worktree/task-scope/shortcuts) (§5.X #2).
export * from "./projects-api-contract.js";
// Runtime/agent configuration primitives (core enums, NKlein/swarm settings, model-roles, agent rulesets) (§5.X #2).
export * from "./runtime-config-api-contract.js";
// Runtime state-stream domain (mcp-auth-status + team-progress event + all WS state-stream messages + union) (§5.X #2).
export * from "./stream-events-api-contract.js";
// Task-chat contract domain (chat message/list/send/reload/abort/cancel + protected-test approval) (§5.X #2).
export * from "./task-chat-api-contract.js";
// Task lifecycle + control domain (acceptance, worktree-merge, start/stop/pause/swarm-stop, diagnostics, input) (§5.X #2).
export * from "./task-lifecycle-api-contract.js";
// Task-session contract domain (state/mode/usage/context-budget/model-perf-role/summary, hook activity) (§5.X #2).
export * from "./task-session-api-contract.js";
// Telemetry stats contract domain (model-performance + knowledge-tool-usage stats) (§5.X #2).
export * from "./telemetry-stats-api-contract.js";
// Workspace file-operation contracts (status / change / changes / fuzzy search) live in their own module (§5.X #2).
export * from "./workspace-files-api-contract.js";
// Workspace + project state contract domain (workspace-state, projects, task/workspace metadata) (§5.X #2).
export * from "./workspace-projects-api-contract.js";

export const runtimeSlashCommandSchema = z.object({
	name: z.string(),
	instructions: z.string(),
	description: z.string().optional(),
});
export type RuntimeSlashCommand = z.infer<typeof runtimeSlashCommandSchema>;

export const runtimeSlashCommandsResponseSchema = z.object({
	commands: z.array(runtimeSlashCommandSchema),
});
export type RuntimeSlashCommandsResponse = z.infer<typeof runtimeSlashCommandsResponseSchema>;

export { ACCEPTANCE_FAILURE_LABELS, acceptanceFailureCategoryLabel } from "./acceptance-failure-taxonomy.js";
// Re-export the ruleset value helpers so the web-ui (which reaches this module via the @runtime-contract alias)
// can render tier pickers without importing the runtime core directly.
export {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_DELIVERY_TIER_INFO,
	AGENT_RULESET_ROLES,
	DEFAULT_AGENT_RULESETS_CONFIG,
} from "./agent-rulesets.js";

export const runtimeCommandRunRequestSchema = z.object({
	command: z.string(),
});
export type RuntimeCommandRunRequest = z.infer<typeof runtimeCommandRunRequestSchema>;

export const runtimeCommandRunResponseSchema = z.object({
	exitCode: z.number(),
	stdout: z.string(),
	stderr: z.string(),
	combinedOutput: z.string(),
	durationMs: z.number(),
});
export type RuntimeCommandRunResponse = z.infer<typeof runtimeCommandRunResponseSchema>;

export const runtimeTaskContextImportSourceSchema = z.enum(["github_issue", "github_pr_diff"]);
export type RuntimeTaskContextImportSource = z.infer<typeof runtimeTaskContextImportSourceSchema>;

export const runtimeTaskContextImportRequestSchema = z.object({
	source: runtimeTaskContextImportSourceSchema,
	target: z.string(),
});
export type RuntimeTaskContextImportRequest = z.infer<typeof runtimeTaskContextImportRequestSchema>;

export const runtimeTaskContextImportResponseSchema = z.object({
	ok: z.boolean(),
	sourceLabel: z.string().nullable(),
	title: z.string().nullable().optional(),
	content: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskContextImportResponse = z.infer<typeof runtimeTaskContextImportResponseSchema>;

export const runtimeOpenFileRequestSchema = z.object({
	filePath: z.string(),
});
export type RuntimeOpenFileRequest = z.infer<typeof runtimeOpenFileRequestSchema>;

export const runtimeOpenFileResponseSchema = z.object({
	ok: z.boolean(),
});
export type RuntimeOpenFileResponse = z.infer<typeof runtimeOpenFileResponseSchema>;

export const runtimeDebugResetAllStateResponseSchema = z.object({
	ok: z.boolean(),
	clearedPaths: z.array(z.string()),
});
export type RuntimeDebugResetAllStateResponse = z.infer<typeof runtimeDebugResetAllStateResponseSchema>;

export const runtimeUpdateStatusResponseSchema = z.object({
	currentVersion: z.string(),
	latestVersion: z.string().nullable(),
	updateAvailable: z.boolean(),
	updateTiming: z.enum(["startup", "shutdown"]).nullable(),
	installCommand: z.string().nullable(),
});
export type RuntimeUpdateStatusResponse = z.infer<typeof runtimeUpdateStatusResponseSchema>;

export const runtimeRunUpdateResponseSchema = z.object({
	status: z.enum([
		"updated",
		"already_up_to_date",
		"cache_refreshed",
		"unsupported_installation",
		"check_failed",
		"update_failed",
	]),
	currentVersion: z.string(),
	latestVersion: z.string().nullable(),
	message: z.string(),
});
export type RuntimeRunUpdateResponse = z.infer<typeof runtimeRunUpdateResponseSchema>;

export const runtimeShellSessionStartRequestSchema = z.object({
	taskId: z.string(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	workspaceTaskId: z.string().optional(),
	baseRef: z.string(),
});
export type RuntimeShellSessionStartRequest = z.infer<typeof runtimeShellSessionStartRequestSchema>;

export const runtimeShellSessionStartResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	shellBinary: z.string().nullable().optional(),
	error: z.string().optional(),
});
export type RuntimeShellSessionStartResponse = z.infer<typeof runtimeShellSessionStartResponseSchema>;

export const runtimeTerminalWsResizeMessageSchema = z.object({
	type: z.literal("resize"),
	cols: z.number().int().positive(),
	rows: z.number().int().positive(),
	pixelWidth: z.number().int().positive().optional(),
	pixelHeight: z.number().int().positive().optional(),
});
export type RuntimeTerminalWsResizeMessage = z.infer<typeof runtimeTerminalWsResizeMessageSchema>;

export const runtimeTerminalWsStopMessageSchema = z.object({
	type: z.literal("stop"),
});
export type RuntimeTerminalWsStopMessage = z.infer<typeof runtimeTerminalWsStopMessageSchema>;

export const runtimeTerminalWsOutputAckMessageSchema = z.object({
	type: z.literal("output_ack"),
	bytes: z.number().int().nonnegative(),
});
export type RuntimeTerminalWsOutputAckMessage = z.infer<typeof runtimeTerminalWsOutputAckMessageSchema>;

export const runtimeTerminalWsRestoreCompleteMessageSchema = z.object({
	type: z.literal("restore_complete"),
});
export type RuntimeTerminalWsRestoreCompleteMessage = z.infer<typeof runtimeTerminalWsRestoreCompleteMessageSchema>;

export const runtimeTerminalWsClientMessageSchema = z.discriminatedUnion("type", [
	runtimeTerminalWsResizeMessageSchema,
	runtimeTerminalWsStopMessageSchema,
	runtimeTerminalWsOutputAckMessageSchema,
	runtimeTerminalWsRestoreCompleteMessageSchema,
]);
export type RuntimeTerminalWsClientMessage = z.infer<typeof runtimeTerminalWsClientMessageSchema>;

export const runtimeTerminalWsStateMessageSchema = z.object({
	type: z.literal("state"),
	summary: runtimeTaskSessionSummarySchema,
});
export type RuntimeTerminalWsStateMessage = z.infer<typeof runtimeTerminalWsStateMessageSchema>;

export const runtimeTerminalWsErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type RuntimeTerminalWsErrorMessage = z.infer<typeof runtimeTerminalWsErrorMessageSchema>;

export const runtimeTerminalWsExitMessageSchema = z.object({
	type: z.literal("exit"),
	code: z.number().nullable(),
});
export type RuntimeTerminalWsExitMessage = z.infer<typeof runtimeTerminalWsExitMessageSchema>;

export const runtimeTerminalWsRestoreMessageSchema = z.object({
	type: z.literal("restore"),
	snapshot: z.string(),
	cols: z.number().int().positive().nullable().optional(),
	rows: z.number().int().positive().nullable().optional(),
});
export type RuntimeTerminalWsRestoreMessage = z.infer<typeof runtimeTerminalWsRestoreMessageSchema>;

export const runtimeTerminalWsServerMessageSchema = z.discriminatedUnion("type", [
	runtimeTerminalWsStateMessageSchema,
	runtimeTerminalWsErrorMessageSchema,
	runtimeTerminalWsExitMessageSchema,
	runtimeTerminalWsRestoreMessageSchema,
]);
export type RuntimeTerminalWsServerMessage = z.infer<typeof runtimeTerminalWsServerMessageSchema>;

export const runtimeGitCommitSchema = z.object({
	hash: z.string(),
	shortHash: z.string(),
	authorName: z.string(),
	authorEmail: z.string(),
	date: z.string(),
	message: z.string(),
	parentHashes: z.array(z.string()),
	relation: z.enum(["selected", "upstream", "shared"]).optional(),
});
export type RuntimeGitCommit = z.infer<typeof runtimeGitCommitSchema>;

export const runtimeGitRefSchema = z.object({
	name: z.string(),
	type: z.enum(["branch", "remote", "detached"]),
	hash: z.string(),
	isHead: z.boolean(),
	upstreamName: z.string().optional(),
	ahead: z.number().optional(),
	behind: z.number().optional(),
});
export type RuntimeGitRef = z.infer<typeof runtimeGitRefSchema>;

export const runtimeGitLogRequestSchema = z.object({
	ref: z.string().nullable().optional(),
	refs: z.array(z.string()).optional(),
	maxCount: z.number().int().positive().optional(),
	skip: z.number().int().nonnegative().optional(),
	taskScope: runtimeTaskWorkspaceInfoRequestSchema.nullable().optional(),
});
export type RuntimeGitLogRequest = z.infer<typeof runtimeGitLogRequestSchema>;

export const runtimeGitLogResponseSchema = z.object({
	ok: z.boolean(),
	commits: z.array(runtimeGitCommitSchema),
	totalCount: z.number(),
	error: z.string().optional(),
});
export type RuntimeGitLogResponse = z.infer<typeof runtimeGitLogResponseSchema>;

export const runtimeGitCommitDiffFileSchema = z.object({
	path: z.string(),
	previousPath: z.string().optional(),
	status: z.enum(["modified", "added", "deleted", "renamed"]),
	additions: z.number(),
	deletions: z.number(),
	patch: z.string(),
});
export type RuntimeGitCommitDiffFile = z.infer<typeof runtimeGitCommitDiffFileSchema>;

export const runtimeGitCommitDiffRequestSchema = z.object({
	commitHash: z.string(),
	taskScope: runtimeTaskWorkspaceInfoRequestSchema.nullable().optional(),
});
export type RuntimeGitCommitDiffRequest = z.infer<typeof runtimeGitCommitDiffRequestSchema>;

export const runtimeGitCommitDiffResponseSchema = z.object({
	ok: z.boolean(),
	commitHash: z.string(),
	files: z.array(runtimeGitCommitDiffFileSchema),
	error: z.string().optional(),
});
export type RuntimeGitCommitDiffResponse = z.infer<typeof runtimeGitCommitDiffResponseSchema>;

export const runtimeGitRefsResponseSchema = z.object({
	ok: z.boolean(),
	refs: z.array(runtimeGitRefSchema),
	error: z.string().optional(),
});
export type RuntimeGitRefsResponse = z.infer<typeof runtimeGitRefsResponseSchema>;
