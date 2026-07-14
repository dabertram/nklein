import { z } from "zod";
import { runtimeAgentIdWithLegacyMigrationSchema } from "./runtime-config-api-contract.js";

// Task-session contract domain: session state / mode / review-reason, hook activity, turn checkpoints, usage +
// context-budget breakdown, the model-performance role enum, and the per-card session summary. Split out of
// api-contract.ts (§5.X #2), re-exported through the `@runtime-contract` barrel. Imports only `z` +
// runtimeAgentIdSchema (from the config-primitives module) — never the barrel (no load-order cycle).

export const runtimeTaskSessionStateSchema = z.enum([
	"idle",
	"queued",
	"running",
	"paused",
	"awaiting_review",
	"failed",
	"interrupted",
]);
export type RuntimeTaskSessionState = z.infer<typeof runtimeTaskSessionStateSchema>;

export const runtimeTaskSessionModeSchema = z.enum(["act", "plan"]);
export type RuntimeTaskSessionMode = z.infer<typeof runtimeTaskSessionModeSchema>;

export const runtimeTaskSessionReviewReasonSchema = z
	// `protected_write` (F2.17b): a delivery HELD because the result touched a protected/out-of-bounds path (the
	// F1.9b work-package boundary gate) — distinct from a generic `interrupted` stop, so the operator inbox can
	// surface it as its own protected-write source.
	.enum(["attention", "exit", "error", "interrupted", "hook", "protected_write"])
	.nullable();
export type RuntimeTaskSessionReviewReason = z.infer<typeof runtimeTaskSessionReviewReasonSchema>;

export const runtimeTaskHookActivitySchema = z.object({
	activityText: z.string().nullable().default(null),
	toolName: z.string().nullable().default(null),
	toolInputSummary: z.string().nullable().default(null),
	// Lossless full-input fingerprint for the repeated-identical-tool-call guard (todo §5.O hardening) —
	// distinct from the lossy human-facing `toolInputSummary`. Optional: only the two `tool_call` activity
	// sites set it; absent/undefined everywhere else (and the guard falls back to the summary for back-compat).
	toolInputFingerprint: z.string().nullable().optional(),
	finalMessage: z.string().nullable().default(null),
	hookEventName: z.string().nullable().default(null),
	notificationType: z.string().nullable().default(null),
	source: z.string().nullable().default(null),
});
export type RuntimeTaskHookActivity = z.infer<typeof runtimeTaskHookActivitySchema>;

export const runtimeTaskTurnCheckpointSchema = z.object({
	turn: z.number().int().positive(),
	ref: z.string(),
	commit: z.string(),
	createdAt: z.number(),
});
export type RuntimeTaskTurnCheckpoint = z.infer<typeof runtimeTaskTurnCheckpointSchema>;

export const runtimeTaskSessionUsageSchema = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative().optional(),
	cacheWriteTokens: z.number().int().nonnegative().optional(),
});
export type RuntimeTaskSessionUsage = z.infer<typeof runtimeTaskSessionUsageSchema>;

export const runtimeContextBudgetBreakdownSchema = z.object({
	systemPromptTokens: z.number().int().nonnegative(),
	toolSchemaTokens: z.number().int().nonnegative(),
	taskPromptTokens: z.number().int().nonnegative(),
	userMessageTokens: z.number().int().nonnegative(),
	includedFileContentTokens: z.number().int().nonnegative(),
	otherHistoryTokens: z.number().int().nonnegative(),
	reservedPromptOverheadTokens: z.number().int().nonnegative(),
	reservedOutputTokens: z.number().int().nonnegative(),
	usedWorkingTokens: z.number().int().nonnegative(),
	freeWorkingTokens: z.number().int().nonnegative(),
	effectiveContextWindow: z.number().int().positive(),
	projectedTokens: z.number().int().nonnegative(),
});
export type RuntimeContextBudgetBreakdown = z.infer<typeof runtimeContextBudgetBreakdownSchema>;

export const runtimeModelPerformanceRoleSchema = z.enum(["architect", "worker", "reviewer", "unknown"]);
export type RuntimeModelPerformanceRole = z.infer<typeof runtimeModelPerformanceRoleSchema>;

export const runtimeTaskSessionSummarySchema = z.object({
	taskId: z.string(),
	state: runtimeTaskSessionStateSchema,
	mode: runtimeTaskSessionModeSchema.nullable().optional(),
	// Resolved launch role (todo §5.G/§5.U): reviewer for a `<taskId>::review` session, architect for an
	// explicit decomposition, worker otherwise. Stamped at start so the cockpit/telemetry don't re-infer it.
	role: runtimeModelPerformanceRoleSchema.nullable().optional(),
	agentId: runtimeAgentIdWithLegacyMigrationSchema.nullable(),
	workspacePath: z.string().nullable(),
	pid: z.number().nullable(),
	startedAt: z.number().nullable(),
	updatedAt: z.number(),
	lastOutputAt: z.number().nullable(),
	paused: z.boolean().optional(),
	lastTokenAt: z.number().nullable().optional(),
	lastHeartbeatAt: z.number().nullable().optional(),
	heartbeatStatus: z.enum(["healthy", "stale", "lost"]).nullable().optional(),
	providerId: z.string().nullable().optional(),
	modelId: z.string().nullable().optional(),
	/**
	 * §5.BG: the STABLE publisher model key (`descriptor.modelKey`) for the task, stamped when it's a locally-loaded
	 * model. Distinct from `modelId` (the renamable LM Studio runtime id used to CALL the endpoint). Telemetry (fitness,
	 * model behavior) keys off this so renaming an instance can't fragment its measured history. Absent (⇒ fall back to
	 * `modelId`) for cloud / not-loaded models and on legacy persisted summaries.
	 */
	modelKey: z.string().nullable().optional(),
	endpoint: z.string().nullable().optional(),
	sharedEndpointId: z.string().nullable().optional(),
	reviewReason: runtimeTaskSessionReviewReasonSchema,
	exitCode: z.number().nullable(),
	lastHookAt: z.number().nullable().default(null),
	latestHookActivity: runtimeTaskHookActivitySchema.nullable().default(null),
	warningMessage: z.string().nullable().optional(),
	latestUsage: runtimeTaskSessionUsageSchema.nullable().optional(),
	contextBudgetBreakdown: runtimeContextBudgetBreakdownSchema.nullable().optional(),
	latestTurnCheckpoint: runtimeTaskTurnCheckpointSchema.nullable().optional(),
	previousTurnCheckpoint: runtimeTaskTurnCheckpointSchema.nullable().optional(),
});
export type RuntimeTaskSessionSummary = z.infer<typeof runtimeTaskSessionSummarySchema>;

/** Live-agent session activity for the at-a-glance per-project sidebar badge (watchability across parallel projects). */
export interface ActiveAgentSessionCounts {
	/** Sessions executing on the model right now. */
	running: number;
	/** Sessions waiting for sandbox/model capacity (visualizes the per-model concurrency bottleneck, §5.W). */
	queued: number;
}

/**
 * Count the live-agent sessions that represent in-flight LLM work: `running` (on the model now) + `queued` (waiting for
 * capacity). Pure so the per-project activity badge — which lets the user see parallel work across projects WITHOUT
 * switching into each board — is derived from one tested rule. Other states (paused/awaiting_review/idle/failed/
 * interrupted) are not "active work".
 */
export function countActiveAgentSessions(
	summaries: Iterable<Pick<RuntimeTaskSessionSummary, "state">>,
): ActiveAgentSessionCounts {
	let running = 0;
	let queued = 0;
	for (const summary of summaries) {
		if (summary.state === "running") {
			running += 1;
		} else if (summary.state === "queued") {
			queued += 1;
		}
	}
	return { running, queued };
}

/**
 * Count the sessions PARKED FOR THE OPERATOR — `awaiting_review` with `reviewReason: "attention"` (the needs-you
 * surface: autonomy-budget parks, the §12 turn-loop guard's boundary question, review-loop parks). Pure so consumers
 * (the dev-test monitor's `needs_attention` outcome, badges) derive "waiting on a human answer" from one tested rule.
 * Distinct from `awaiting_review` with exit/error/interrupted/hook reasons, which are not operator questions.
 */
export function countAttentionParkedSessions(
	summaries: Iterable<Pick<RuntimeTaskSessionSummary, "state" | "reviewReason">>,
): number {
	let parked = 0;
	for (const summary of summaries) {
		if (summary.state === "awaiting_review" && summary.reviewReason === "attention") {
			parked += 1;
		}
	}
	return parked;
}
