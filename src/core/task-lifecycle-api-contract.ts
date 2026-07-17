import { z } from "zod";
import { ACCEPTANCE_FAILURE_CATEGORIES } from "./acceptance-failure-taxonomy.js";
import { runtimeTaskImageSchema } from "./board-api-contract.js";
import { runtimeAgentIdSchema, runtimeTaskNKleinSettingsSchema } from "./runtime-config-api-contract.js";
import {
	runtimeModelPerformanceRoleSchema,
	runtimeTaskSessionModeSchema,
	runtimeTaskSessionSummarySchema,
} from "./task-session-api-contract.js";

// Task lifecycle + control contract domain: acceptance verify, worktree merge (request / step / response),
// session start / stop, pause, swarm-stop, diagnostics (request / event / run-summary / response), and session
// input. Split out of api-contract.ts (§5.X #2). Imports z + acceptance-failure categories + config primitives +
// task-session + board — never the barrel.

// F1.6 — the operator-facing focus-chain AUDIT history: the durable per-step transitions the F1.5 ledger events
// recorded, projected for one task (newest last). `from: null` = the step first appeared.
export const runtimeFocusChainTransitionSchema = z.object({
	stepText: z.string(),
	from: z.string().nullable(),
	to: z.string(),
	recordedAt: z.number(),
});
export type RuntimeFocusChainTransition = z.infer<typeof runtimeFocusChainTransitionSchema>;

export const runtimeFocusChainHistoryRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeFocusChainHistoryRequest = z.infer<typeof runtimeFocusChainHistoryRequestSchema>;

export const runtimeFocusChainHistoryResponseSchema = z.object({
	transitions: z.array(runtimeFocusChainTransitionSchema),
});
export type RuntimeFocusChainHistoryResponse = z.infer<typeof runtimeFocusChainHistoryResponseSchema>;

// F12.55 — the per-card plain-language action trail (projection of the attempt ledger; presentation of
// `buildCardActionTrail`). Reversibility drives the panel's color-coding; `hypothesis` is the agent's own stated
// intent and is ALWAYS framed as a working hypothesis, never as evidence (CoT-faithfulness).
export const runtimeTaskActionTrailRequestSchema = z.object({
	taskId: z.string().min(1),
	/** Newest-tail cap; the trail is chronological and the last entries are the current story. */
	limit: z.number().int().positive().max(500).optional(),
});
export type RuntimeTaskActionTrailRequest = z.infer<typeof runtimeTaskActionTrailRequestSchema>;

export const runtimeTaskActionTrailEntrySchema = z.object({
	at: z.number().nullable(),
	kind: z.enum(["action", "retrieval", "transition", "attempt_end"]),
	text: z.string(),
	files: z.array(z.string()),
	reversibility: z.enum(["read_only", "reversible", "irreversible"]),
	hypothesis: z.string().nullable(),
});
export type RuntimeTaskActionTrailEntry = z.infer<typeof runtimeTaskActionTrailEntrySchema>;

export const runtimeTaskActionTrailResponseSchema = z.object({
	entries: z.array(runtimeTaskActionTrailEntrySchema),
	/** Total entries before the tail cap — honest when the panel shows a truncated story. */
	totalEntries: z.number().int().nonnegative(),
});
export type RuntimeTaskActionTrailResponse = z.infer<typeof runtimeTaskActionTrailResponseSchema>;

export const runtimeTaskAcceptanceVerifyRequestSchema = z.object({
	taskId: z.string().min(1),
	timeoutMs: z.number().int().positive().optional(),
});
export type RuntimeTaskAcceptanceVerifyRequest = z.infer<typeof runtimeTaskAcceptanceVerifyRequestSchema>;

export const runtimeTaskAcceptanceResultSchema = z.object({
	present: z.boolean(),
	command: z.string().nullable(),
	passed: z.boolean().nullable(),
	exitCode: z.number().nullable(),
	output: z.string(),
	durationMs: z.number().int().nonnegative(),
	failureCategory: z.enum(ACCEPTANCE_FAILURE_CATEGORIES).nullable().default(null),
	failureHint: z.string().nullable().default(null),
});
export type RuntimeTaskAcceptanceResult = z.infer<typeof runtimeTaskAcceptanceResultSchema>;

export const runtimeTaskAcceptanceVerifyResponseSchema = z.object({
	ok: z.boolean(),
	taskId: z.string(),
	taskWorkspacePath: z.string().nullable(),
	acceptance: runtimeTaskAcceptanceResultSchema,
	message: z.string(),
});
export type RuntimeTaskAcceptanceVerifyResponse = z.infer<typeof runtimeTaskAcceptanceVerifyResponseSchema>;

export const runtimeTaskWorktreeMergeRequestSchema = z.object({
	taskId: z.string().min(1).optional(),
	column: z.enum(["review", "completed"]).default("review"),
});
export type RuntimeTaskWorktreeMergeRequest = z.infer<typeof runtimeTaskWorktreeMergeRequestSchema>;

const runtimeTaskWorktreeMergeSuccessStepSchema = z.object({
	type: z.enum(["merged", "skipped"]),
	taskId: z.string(),
	headCommit: z.string(),
	reason: z.string(),
});
const runtimeTaskWorktreeMergeConflictStepSchema = z.object({
	type: z.literal("conflict"),
	taskId: z.string(),
	headCommit: z.string(),
	conflictedPaths: z.array(z.string()),
	message: z.string(),
});
const runtimeTaskWorktreeMergeBlockedStepSchema = z.object({
	type: z.literal("blocked"),
	taskId: z.string().nullable(),
	reason: z.string(),
});
export const runtimeTaskWorktreeMergeStepSchema = z.discriminatedUnion("type", [
	runtimeTaskWorktreeMergeSuccessStepSchema,
	runtimeTaskWorktreeMergeConflictStepSchema,
	runtimeTaskWorktreeMergeBlockedStepSchema,
]);
export type RuntimeTaskWorktreeMergeStep = z.infer<typeof runtimeTaskWorktreeMergeStepSchema>;

export const runtimeTaskWorktreeMergeResponseSchema = z.object({
	ok: z.boolean(),
	column: z.enum(["review", "completed"]),
	mergedTaskIds: z.array(z.string()),
	skippedTaskIds: z.array(z.string()),
	steps: z.array(runtimeTaskWorktreeMergeStepSchema),
	conflict: runtimeTaskWorktreeMergeConflictStepSchema.nullable(),
	blocked: runtimeTaskWorktreeMergeBlockedStepSchema.nullable(),
	message: z.string(),
});
export type RuntimeTaskWorktreeMergeResponse = z.infer<typeof runtimeTaskWorktreeMergeResponseSchema>;

export const runtimeTaskSessionStartRequestSchema = z.object({
	taskId: z.string(),
	prompt: z.string(),
	/** Display title from the !Klein task card. Propagated to SDK session metadata as a convenience copy. */
	taskTitle: z.string().optional(),
	images: z.array(runtimeTaskImageSchema).optional(),
	filesLikelyTouched: z.array(z.string()).optional(),
	// F1.9b: the card's work-package bounds — the tool-approval write gate enforces them glob-aware.
	writeScope: z.array(z.string()).optional(),
	forbiddenPaths: z.array(z.string()).optional(),
	startInPlanMode: z.boolean().optional(),
	mode: runtimeTaskSessionModeSchema.optional(),
	resumeFromTrash: z.boolean().optional(),
	baseRef: z.string(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	agentId: runtimeAgentIdSchema.optional(),
	nkleinSettings: runtimeTaskNKleinSettingsSchema.optional(),
	queueOnEndpointBusy: z.boolean().optional(),
});
export type RuntimeTaskSessionStartRequest = z.infer<typeof runtimeTaskSessionStartRequestSchema>;

export const runtimeTaskSessionStartResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
	errorCode: z
		.enum([
			"needs_decomposition",
			"routing_escalation",
			"cloud_provider_disabled",
			"endpoint_busy",
			"swarm_stopped",
			"agent_sandbox_unavailable",
			"concurrency_limit",
			"model_not_loaded",
			"pinned_model_unavailable",
		])
		.optional(),
	modelNotLoaded: z
		.object({
			requestedModelId: z.string(),
			loadedModelIds: z.array(z.string()),
		})
		.optional(),
	retryAfterMs: z.number().int().nonnegative().nullable().optional(),
	queued: z.boolean().optional(),
	/**
	 * §5.AB "why this model for this task" — an operator-readable explanation of the model-selection decision (the task
	 * difficulty + context need, each candidate's registry vs ledger-blended capability, why each was kept/ruled out, and
	 * which won). Present on a started/blocked routing decision; absent on early gate failures. Backward-compatible.
	 */
	selectionReason: z.string().optional(),
});
export type RuntimeTaskSessionStartResponse = z.infer<typeof runtimeTaskSessionStartResponseSchema>;

export const runtimeTaskSessionStopRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskSessionStopRequest = z.infer<typeof runtimeTaskSessionStopRequestSchema>;

export const runtimeTaskSessionStopResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionStopResponse = z.infer<typeof runtimeTaskSessionStopResponseSchema>;

export const runtimeTaskPauseRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskPauseRequest = z.infer<typeof runtimeTaskPauseRequestSchema>;

export const runtimeTaskPauseResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	pausedTaskIds: z.array(z.string()),
	error: z.string().optional(),
});
export type RuntimeTaskPauseResponse = z.infer<typeof runtimeTaskPauseResponseSchema>;

export const runtimeSwarmStopSignalSchema = z.object({
	stopped: z.literal(true),
	reason: z.string(),
	createdAt: z.number(),
});
export type RuntimeSwarmStopSignal = z.infer<typeof runtimeSwarmStopSignalSchema>;

export const runtimeSwarmStopRequestSchema = z.object({
	reason: z.string().optional(),
});
export type RuntimeSwarmStopRequest = z.infer<typeof runtimeSwarmStopRequestSchema>;

export const runtimeSwarmStopResponseSchema = z.object({
	ok: z.boolean(),
	signal: runtimeSwarmStopSignalSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeSwarmStopResponse = z.infer<typeof runtimeSwarmStopResponseSchema>;

export const runtimeTaskDiagnosticsRequestSchema = z.object({
	taskId: z.string(),
	limit: z.number().int().positive().max(100).optional(),
});
export type RuntimeTaskDiagnosticsRequest = z.infer<typeof runtimeTaskDiagnosticsRequestSchema>;

export const runtimeTaskDiagnosticEventSchema = z.object({
	schemaVersion: z.literal(1),
	signal: z.enum([
		"runtime_error",
		"provider_error",
		"tool_error",
		"context_overflow",
		"verification_failed",
		"slow_turn",
		"budget_wall",
		"repeated_read",
		"tool_argument_error",
		"task_abandoned",
		"task_escalated",
		"decomposition_rejected",
		"plan_gap",
		"eval_score",
		"model_stalled",
		"custom",
	]),
	severity: z.enum(["debug", "info", "warning", "error"]),
	message: z.string(),
	taskId: z.string().nullable().optional(),
	runId: z.string().nullable().optional(),
	providerId: z.string().nullable().optional(),
	modelId: z.string().nullable().optional(),
	workspacePath: z.string().nullable().optional(),
	workspacePathHash: z.string().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.number(),
});
export type RuntimeTaskDiagnosticEvent = z.infer<typeof runtimeTaskDiagnosticEventSchema>;

export const runtimeTaskRunSummarySchema = z.object({
	schemaVersion: z.literal(1),
	taskId: z.string(),
	workspacePath: z.string().nullable(),
	state: z.enum(["awaiting_review", "failed", "interrupted"]),
	reviewReason: z.string().nullable(),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	endpoint: z.string().nullable(),
	lastActivity: z.string().nullable(),
	warningMessage: z.string().nullable(),
	exitCode: z.number().nullable(),
	startedAt: z.number().nullable(),
	endedAt: z.number(),
	promptTokens: z.number().nullable(),
	completionTokens: z.number().nullable(),
	totalTokens: z.number().nullable(),
	timeoutReason: z.string().nullable(),
	timeoutSource: z.enum(["global_config", "role_override", "autonomous_default"]).nullable(),
	// Coarse agent role of the run (todo §5.C), so timeout outcomes can be broken down by role. Optional for
	// backward-compatibility with run-summary records written before this field existed.
	role: runtimeModelPerformanceRoleSchema.optional(),
	// Dev-test scenario id (todo §5.C), parsed from a `devtest-<scenario>-<ts>` task id, for by-scenario timeout
	// breakdowns during robustness sweeps (§5.O). Null/absent for ordinary (non-dev-test) runs.
	scenario: z.string().nullable().optional(),
	patchCaptureStatus: z.string().nullable(),
});
export type RuntimeTaskRunSummary = z.infer<typeof runtimeTaskRunSummarySchema>;

export const runtimeTaskDiagnosticsResponseSchema = z.object({
	ok: z.boolean(),
	events: z.array(runtimeTaskDiagnosticEventSchema),
	runSummaries: z.array(runtimeTaskRunSummarySchema).optional(),
	error: z.string().optional(),
});
export type RuntimeTaskDiagnosticsResponse = z.infer<typeof runtimeTaskDiagnosticsResponseSchema>;

export const runtimeTaskSessionInputRequestSchema = z.object({
	taskId: z.string(),
	text: z.string(),
	appendNewline: z.boolean().optional(),
	/**
	 * F12.56 mid-task steering: how to deliver into a RUNNING session. "steer" jumps the pending-prompt queue so the
	 * note lands before the very next model iteration ("use the v2 API" mid-run); "queue" (default) appends behind
	 * earlier pending input. Ignored when the session is not running.
	 */
	delivery: z.enum(["queue", "steer"]).optional(),
});
export type RuntimeTaskSessionInputRequest = z.infer<typeof runtimeTaskSessionInputRequestSchema>;

export const runtimeTaskSessionInputResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionInputResponse = z.infer<typeof runtimeTaskSessionInputResponseSchema>;
