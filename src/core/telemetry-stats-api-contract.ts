import { z } from "zod";
import {
	runtimeContextBudgetBreakdownSchema,
	runtimeModelPerformanceRoleSchema,
	runtimeTaskSessionReviewReasonSchema,
	runtimeTaskSessionStateSchema,
	runtimeTaskSessionUsageSchema,
} from "./task-session-api-contract.js";

// Telemetry stats contract domain: model-performance (outcome / observation / aggregate / stats-response) and
// knowledge-tool-usage (category / outcome / observation / aggregate + decomposition-knowledge signal/aggregate +
// stats-response). Split out of api-contract.ts (§5.X #2), re-exported through the `@runtime-contract` barrel.
// Imports `z` + the session-telemetry primitives it builds on from task-session-api-contract.ts (never the barrel).

export const runtimeModelPerformanceOutcomeSchema = z.enum([
	"completed",
	"awaiting_review",
	"failed",
	"interrupted",
	"queued",
	"running",
	"idle",
	"unknown",
]);
export type RuntimeModelPerformanceOutcome = z.infer<typeof runtimeModelPerformanceOutcomeSchema>;

export const runtimeModelPerformanceObservationSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	recordedAt: z.number().int().nonnegative(),
	appVersion: z.string(),
	workspaceId: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	workspacePath: z.string().nullable(),
	projectName: z.string().nullable(),
	taskId: z.string(),
	taskTitle: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	roleSource: z.enum(["card", "model_roles", "default", "unknown"]),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	endpoint: z.string().nullable(),
	sharedEndpointId: z.string().nullable(),
	outcome: runtimeModelPerformanceOutcomeSchema,
	sessionState: runtimeTaskSessionStateSchema,
	reviewReason: runtimeTaskSessionReviewReasonSchema,
	exitCode: z.number().nullable(),
	warningMessage: z.string().nullable(),
	startedAt: z.number().nullable(),
	updatedAt: z.number().int().nonnegative(),
	lastOutputAt: z.number().nullable(),
	lastTokenAt: z.number().nullable(),
	lastHeartbeatAt: z.number().nullable(),
	heartbeatStatus: z.enum(["healthy", "stale", "lost"]).nullable(),
	wallTimeMs: z.number().int().nonnegative().nullable(),
	timeToFirstTokenMs: z.number().int().nonnegative().nullable(),
	timeToLastOutputMs: z.number().int().nonnegative().nullable(),
	usage: runtimeTaskSessionUsageSchema.nullable(),
	contextBudgetBreakdown: runtimeContextBudgetBreakdownSchema.nullable(),
	contextPressure: z.number().nonnegative().nullable(),
	latestHookEvent: z.string().nullable(),
	latestHookToolName: z.string().nullable(),
});
export type RuntimeModelPerformanceObservation = z.infer<typeof runtimeModelPerformanceObservationSchema>;

export const runtimeModelPerformanceAggregateSchema = z.object({
	key: z.string(),
	scope: z.enum(["overall", "project", "version", "model"]),
	appVersion: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	projectName: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	// Canonical endpoint for the `model` scope (provider + normalized model + canonical endpoint identity,
	// todo §5.Q); null for the role/project/version scopes which collapse across endpoints.
	endpoint: z.string().nullable(),
	runs: z.number().int().nonnegative(),
	completedRuns: z.number().int().nonnegative(),
	failedRuns: z.number().int().nonnegative(),
	interruptedRuns: z.number().int().nonnegative(),
	awaitingReviewRuns: z.number().int().nonnegative(),
	successRate: z.number().nonnegative(),
	averageWallTimeMs: z.number().nonnegative().nullable(),
	averageTimeToFirstTokenMs: z.number().nonnegative().nullable(),
	averageInputTokens: z.number().nonnegative().nullable(),
	averageOutputTokens: z.number().nonnegative().nullable(),
	averageContextPressure: z.number().nonnegative().nullable(),
	lastObservedAt: z.number().int().nonnegative(),
});
export type RuntimeModelPerformanceAggregate = z.infer<typeof runtimeModelPerformanceAggregateSchema>;

export const runtimeModelPerformanceStatsResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	observations: z.array(runtimeModelPerformanceObservationSchema),
	aggregates: z.array(runtimeModelPerformanceAggregateSchema),
});
export type RuntimeModelPerformanceStatsResponse = z.infer<typeof runtimeModelPerformanceStatsResponseSchema>;

// §5.AL fitness browser: the read-only per-(model × role × difficulty) fitness cells + the failing-LLM projection.
// A lean wire mirror of the store's FitnessRow (decoupled from the internal schema); `successRate`/`belowBar` are
// server-derived (see `buildFitnessTableView`). Worst-first order.
export const runtimeFitnessRowSchema = z.object({
	modelKey: z.string(),
	role: z.string(),
	difficultyTier: z.enum(["easy", "medium", "hard"]),
	sampleCount: z.number().int().nonnegative(),
	successCount: z.number().int().nonnegative(),
	successRate: z.number().min(0).max(1),
	confidenceLowerBound: z.number().min(0).max(1).default(0),
	confidenceBand: z.enum(["none", "low", "medium", "high"]).default("none"),
	retryBudget: z.number().int().nonnegative(),
	failureModes: z.array(z.object({ kind: z.string(), count: z.number().int().nonnegative() })),
	meanWallTimeMs: z.number().nonnegative().nullable(),
	tokensPerSec: z.number().nonnegative().nullable(),
	updatedAt: z.number().nullable(),
	/** In the failing-LLM projection: well-sampled AND under the success bar. */
	belowBar: z.boolean(),
});
export type RuntimeFitnessRow = z.infer<typeof runtimeFitnessRowSchema>;

// §5.AL/§10c#11 selector badge: models whose RUNTIME verdict is degraded (medium+ confidence only), with a
// compact operator label ("stalled 3× · tool-weak"). Badge-only surface — no confirm-flow (David 2026-07-12).
export const runtimeModelVerdictBadgeSchema = z.object({
	modelId: z.string(),
	verdict: z.enum(["TOOL_WEAK", "TOOL_UNSUITABLE"]),
	label: z.string(),
	sampleCount: z.number().int().nonnegative(),
});
export type RuntimeModelVerdictBadge = z.infer<typeof runtimeModelVerdictBadgeSchema>;

export const runtimeModelVerdictBadgesResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	badges: z.array(runtimeModelVerdictBadgeSchema),
});
export type RuntimeModelVerdictBadgesResponse = z.infer<typeof runtimeModelVerdictBadgesResponseSchema>;

export const runtimeFitnessTableResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	rows: z.array(runtimeFitnessRowSchema),
});
export type RuntimeFitnessTableResponse = z.infer<typeof runtimeFitnessTableResponseSchema>;

export const runtimeKnowledgeToolCategorySchema = z.enum([
	"architecture_knowledge",
	"external_fetch",
	"code_index",
	"codebase_retrieval",
	"file_discovery",
	"file_read",
	"planning_control",
	"other",
]);
export type RuntimeKnowledgeToolCategory = z.infer<typeof runtimeKnowledgeToolCategorySchema>;

export const runtimeKnowledgeToolOutcomeSchema = z.enum(["started", "succeeded", "failed"]);
export type RuntimeKnowledgeToolOutcome = z.infer<typeof runtimeKnowledgeToolOutcomeSchema>;

export const runtimeKnowledgeToolUsageObservationSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	recordedAt: z.number().int().nonnegative(),
	appVersion: z.string(),
	workspaceId: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	workspacePath: z.string().nullable(),
	projectName: z.string().nullable(),
	taskId: z.string(),
	taskTitle: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	roleSource: z.enum(["card", "model_roles", "default", "unknown"]),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	toolName: z.string(),
	toolCategory: runtimeKnowledgeToolCategorySchema,
	outcome: runtimeKnowledgeToolOutcomeSchema,
	hookEventName: z.string(),
	toolInputSummary: z.string().nullable(),
	activityText: z.string().nullable(),
	lastHookAt: z.number().int().nonnegative().nullable(),
});
export type RuntimeKnowledgeToolUsageObservation = z.infer<typeof runtimeKnowledgeToolUsageObservationSchema>;

export const runtimeKnowledgeToolUsageAggregateSchema = z.object({
	key: z.string(),
	scope: z.enum(["overall", "project", "version"]),
	appVersion: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	projectName: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	toolName: z.string(),
	toolCategory: runtimeKnowledgeToolCategorySchema,
	calls: z.number().int().nonnegative(),
	startedCalls: z.number().int().nonnegative(),
	succeededCalls: z.number().int().nonnegative(),
	failedCalls: z.number().int().nonnegative(),
	successRate: z.number().nonnegative(),
	lastObservedAt: z.number().int().nonnegative(),
});
export type RuntimeKnowledgeToolUsageAggregate = z.infer<typeof runtimeKnowledgeToolUsageAggregateSchema>;

/**
 * §5.B decomposition-quality signal: per planning session, whether the architect consulted knowledge tools
 * (codebase retrieval / code index / architecture knowledge) *before* the decomposition landed — not just a
 * raw usage count.
 */
export const runtimeDecompositionKnowledgeSignalSchema = z.object({
	taskId: z.string(),
	appVersion: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	projectName: z.string().nullable(),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	decomposedAt: z.number().int().nonnegative(),
	applied: z.boolean(),
	usedKnowledgeTools: z.boolean(),
	knowledgeCategoriesBefore: z.array(runtimeKnowledgeToolCategorySchema),
});
export type RuntimeDecompositionKnowledgeSignal = z.infer<typeof runtimeDecompositionKnowledgeSignalSchema>;

export const runtimeDecompositionKnowledgeAggregateSchema = z.object({
	key: z.string(),
	scope: z.enum(["overall", "project", "version"]),
	appVersion: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	projectName: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	decompositions: z.number().int().nonnegative(),
	withKnowledgeTools: z.number().int().nonnegative(),
	withoutKnowledgeTools: z.number().int().nonnegative(),
	knowledgeUsageRate: z.number().nonnegative(),
	lastDecomposedAt: z.number().int().nonnegative(),
});
export type RuntimeDecompositionKnowledgeUsageAggregate = z.infer<typeof runtimeDecompositionKnowledgeAggregateSchema>;

export const runtimeKnowledgeToolUsageStatsResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	observations: z.array(runtimeKnowledgeToolUsageObservationSchema),
	aggregates: z.array(runtimeKnowledgeToolUsageAggregateSchema),
	// §5.B; defaulted so older persisted/partial responses parse cleanly.
	decompositionKnowledgeSignals: z.array(runtimeDecompositionKnowledgeSignalSchema).default([]),
	decompositionKnowledgeAggregates: z.array(runtimeDecompositionKnowledgeAggregateSchema).default([]),
});
export type RuntimeKnowledgeToolUsageStatsResponse = z.infer<typeof runtimeKnowledgeToolUsageStatsResponseSchema>;

/** §5.AA learned model behavior (the ModelBehaviorProfile fold), projected read-only for the Settings telemetry
 *  surface: how reliable each model has proven, its dominant failure mode, and the learned preferences the recovery
 *  ladder seeds from (tool-call format · prompt-variant family · complexity ceiling · the §5.AD quality knee). */
export const runtimeModelBehaviorProfileViewSchema = z.object({
	modelId: z.string(),
	samples: z.number().int().nonnegative(),
	successes: z.number().int().nonnegative(),
	successRate: z.number(),
	avgRetries: z.number(),
	dominantFailureMode: z.string().nullable(),
	preferredToolCallFormat: z.string().nullable(),
	preferredPromptVariantFamily: z.string().nullable(),
	complexityCeiling: z.number().nullable(),
	qualityEffectiveContextTokens: z.number().nullable(),
	qualityDegradedAtTokens: z.number().nullable(),
	updatedAt: z.number(),
});
export type RuntimeModelBehaviorProfileView = z.infer<typeof runtimeModelBehaviorProfileViewSchema>;

export const runtimeModelBehaviorProfilesResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	profiles: z.array(runtimeModelBehaviorProfileViewSchema),
});
export type RuntimeModelBehaviorProfilesResponse = z.infer<typeof runtimeModelBehaviorProfilesResponseSchema>;

/**
 * Read-only ledger-analytics surface for the operator telemetry UI — three projections over the agent attempt ledger
 * that already back the `dev retrieval-usefulness` / `dev knowledge-outcomes` / `dev opportunistic-value` CLIs:
 *   • retrieval: is online retrieval earning its keep (helped/hurt + helpful-rate + prune ratio + citation breadth)?
 *   • knowledge: does consulting knowledge tools (and carrying knowledge debt) change per-model success (the LIFT)?
 *   • opportunistic: did idle opportunistic work pay off (per-kind realized-value rates)?
 * Mirrors the core summary shapes (retrieval-ledger-projection / agent-attempt-ledger / opportunistic-work-value); the
 * router validates against this so the browser stays honest about missing/partial evidence (nullable lifts).
 */
export const runtimeRetrievalUsefulnessViewSchema = z.object({
	total: z.number().int().nonnegative(),
	helped: z.number().int().nonnegative(),
	hurt: z.number().int().nonnegative(),
	neutral: z.number().int().nonnegative(),
	unknown: z.number().int().nonnegative(),
	helpfulRate: z.number(),
	meanDistractorPruneRatio: z.number().nullable(),
	totalCitations: z.number().int().nonnegative(),
	distinctCitedSources: z.number().int().nonnegative(),
});

export const runtimeKnowledgeOutcomeRowSchema = z.object({
	modelId: z.string(),
	role: z.string(),
	attemptsWithKnowledge: z.number().int().nonnegative(),
	successesWithKnowledge: z.number().int().nonnegative(),
	attemptsWithoutKnowledge: z.number().int().nonnegative(),
	successesWithoutKnowledge: z.number().int().nonnegative(),
	knowledgeLift: z.number().nullable(),
});

export const runtimeKnowledgeDebtOutcomeSchema = z.object({
	attemptsWithDebt: z.number().int().nonnegative(),
	successesWithDebt: z.number().int().nonnegative(),
	attemptsWithoutDebt: z.number().int().nonnegative(),
	successesWithoutDebt: z.number().int().nonnegative(),
	debtLift: z.number().nullable(),
});

export const runtimeOpportunisticValueRowSchema = z.object({
	kind: z.string(),
	dispatched: z.number().int().nonnegative(),
	realized: z.number().int().nonnegative(),
	noValue: z.number().int().nonnegative(),
	errored: z.number().int().nonnegative(),
	realizedRate: z.number(),
});

export const runtimeLedgerAnalyticsResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	retrieval: runtimeRetrievalUsefulnessViewSchema,
	knowledgeByModel: z.array(runtimeKnowledgeOutcomeRowSchema),
	knowledgeDebt: runtimeKnowledgeDebtOutcomeSchema,
	opportunistic: z.array(runtimeOpportunisticValueRowSchema),
});
export type RuntimeLedgerAnalyticsResponse = z.infer<typeof runtimeLedgerAnalyticsResponseSchema>;

/**
 * Read-only memory-corpus health for the operator telemetry UI — the F5.2 freshness audit (behind the
 * `dev memory-audit` CLI) over the on-disk basic-memory notes the knowledge tools read from: stale / orphaned /
 * broken-link / duplicate-title counts + a bounded sample of findings (kind + note title + specifics only — never the
 * note body). Empty-safe: a missing/unreadable corpus yields zeros. `available` is false when no corpus was found so the
 * UI can distinguish "clean" from "not present".
 */
export const runtimeMemoryAuditFindingSchema = z.object({
	kind: z.enum(["stale", "orphaned", "broken_link", "duplicate_title"]),
	noteTitle: z.string(),
	detail: z.string(),
});

export const runtimeMemoryAuditResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	available: z.boolean(),
	notesAudited: z.number().int().nonnegative(),
	summary: z.object({
		stale: z.number().int().nonnegative(),
		orphaned: z.number().int().nonnegative(),
		broken_link: z.number().int().nonnegative(),
		duplicate_title: z.number().int().nonnegative(),
	}),
	topFindings: z.array(runtimeMemoryAuditFindingSchema),
});
export type RuntimeMemoryAuditResponse = z.infer<typeof runtimeMemoryAuditResponseSchema>;

/**
 * F1.35b (§5.AI) — the background-eval RAIL controls/status surface. Read-only status snapshot (`composeRailStatus`)
 * plus the two operator mutations (control command + cadence/cap tunables), all returning the fresh snapshot. The
 * `state` is `disabled` unless the operator enabled the rail; `active`/`idle` distinguish "a background eval is running"
 * from "enabled but nothing running right now". `activeLeases`/`lastTick` populate only when the runtime hosts the F1.31
 * service (the `NKLEIN_EVAL_RAIL` boot flag); otherwise the surface shows the persisted intent + tunables with an empty
 * live section — the operator can still configure the rail before enabling it on a capable runtime.
 */
const runtimeRailLeaseSchema = z.object({
	runId: z.string(),
	project: z.string(),
	workspaceId: z.string().nullable(),
	startedAt: z.number().int(),
	deadlineAt: z.number().int(),
});
const runtimeRailTickOutcomeSchema = z.object({
	at: z.number().int(),
	reason: z.string(),
	admittedProject: z.string().nullable(),
	reapedCount: z.number().int().nonnegative(),
});
export const runtimeRailStatusResponseSchema = z.object({
	state: z.enum(["disabled", "paused", "active", "idle"]),
	pauseReason: z.string().nullable(),
	cadenceMs: z.number().int().positive(),
	maxConcurrentEvals: z.number().int().positive(),
	timeoutProfile: z.string().nullable(),
	activeLeases: z.array(runtimeRailLeaseSchema),
	lastTick: z
		.object({ at: z.number().int(), reason: z.string(), reapedCount: z.number().int().nonnegative() })
		.nullable(),
	lastTickError: z.string().nullable(),
	cleanupErrors: z.array(z.string()),
	recentOutcomes: z.array(runtimeRailTickOutcomeSchema),
});
export type RuntimeRailStatusResponse = z.infer<typeof runtimeRailStatusResponseSchema>;

export const runtimeRailControlRequestSchema = z.object({
	kind: z.enum(["enable", "disable", "pause", "resume"]),
	reason: z.string().nullable().optional(),
});
export type RuntimeRailControlRequest = z.infer<typeof runtimeRailControlRequestSchema>;

export const runtimeRailTunablesRequestSchema = z.object({
	cadenceMs: z.number().int().positive().optional(),
	maxConcurrentEvals: z.number().int().positive().optional(),
});
export type RuntimeRailTunablesRequest = z.infer<typeof runtimeRailTunablesRequestSchema>;

/**
 * F1.40 — per-card and per-project TIME tracking (read-only telemetry). Age (total wall-clock) + active time (union of
 * attempt spans, "!Klein actually working") + LLM processing time (total across attempts, and successful-only). All
 * projected from the attempt ledger + board card timestamps — no new recording seam. Workspace-scoped.
 */
export const runtimeTimeTrackingMetricsSchema = z.object({
	ageTotalMs: z.number().nonnegative(),
	activeMs: z.number().nonnegative(),
	llmTotalMs: z.number().nonnegative(),
	llmSuccessfulMs: z.number().nonnegative(),
});
export type RuntimeTimeTrackingMetrics = z.infer<typeof runtimeTimeTrackingMetricsSchema>;

export const runtimeTimeTrackingResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	project: runtimeTimeTrackingMetricsSchema,
	cards: z.array(z.object({ taskId: z.string(), title: z.string(), metrics: runtimeTimeTrackingMetricsSchema })),
});
export type RuntimeTimeTrackingResponse = z.infer<typeof runtimeTimeTrackingResponseSchema>;

/**
 * Model-tuning recommendations — a read-only UI surface consolidating three learned per-model budgets already exposed
 * on the CLI (`dev context-recommendations` / `dev answer-budgets` / `dev retry-budgets`): the context cap that keeps
 * latency healthy (F4.9), the typical answer size to budget output tokens for (F4.10), and how many same-model retries
 * are worth attempting before a failure mode stops recovering (F3.30). All projected from the attempt ledger +
 * model-performance observations — no new recording seam. Each field is nullable when evidence is too thin to judge.
 */
export const runtimeModelTuningRowSchema = z.object({
	modelId: z.string(),
	contextCapTokens: z.number().int().positive().nullable(),
	answerBudgetTokens: z.number().int().positive().nullable(),
	retryBudget: z.number().int().nonnegative().nullable(),
	answerBudgetConfident: z.boolean(),
	sampleCount: z.number().int().nonnegative(),
});
export type RuntimeModelTuningRow = z.infer<typeof runtimeModelTuningRowSchema>;

export const runtimeModelTuningResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	models: z.array(runtimeModelTuningRowSchema),
});
export type RuntimeModelTuningResponse = z.infer<typeof runtimeModelTuningResponseSchema>;
