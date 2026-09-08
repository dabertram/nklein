import { z } from "zod";

// NKlein misc-ops contract domain — small backend-operation endpoint contracts that do not each warrant a
// module: core-py sidecar health, merge-history record/response, the second-opinion advisor
// (kind/request/build/send), dogfood backlog, smoke-eval, and task-evidence. Split out of api-contract.ts
// (§5.X #2). A leaf (imports only `z`).

// Python core (`core-py`) sidecar health for the Settings health line (todo §5.H). `enabled` reflects the
// NKLEIN_CORE_PY opt-out flag; `reachable` is a live `GET /health` probe; `sidecarUrl` carries the host:port.
export const runtimeKleinCorePyHealthResponseSchema = z.object({
	enabled: z.boolean(),
	reachable: z.boolean(),
	sidecarUrl: z.string(),
	/** GGUF embedding models resident in the core (absolute paths; [] until an index batch loads one / core is down). */
	loadedModels: z.array(z.string()).default([]),
});
export type RuntimeKleinCorePyHealthResponse = z.infer<typeof runtimeKleinCorePyHealthResponseSchema>;

// Board-level merge history (todo §5.G) — durable record of each dependency-ordered auto-merge pass.
export const runtimeMergeHistoryRecordSchema = z.object({
	recordedAt: z.number(),
	taskId: z.string(),
	ok: z.boolean(),
	mergedTaskIds: z.array(z.string()),
	skippedTaskIds: z.array(z.string()),
	conflictedPaths: z.array(z.string()),
	reason: z.string().nullable(),
});
export type RuntimeMergeHistoryRecord = z.infer<typeof runtimeMergeHistoryRecordSchema>;
export const runtimeMergeHistoryResponseSchema = z.object({
	records: z.array(runtimeMergeHistoryRecordSchema),
});
export type RuntimeMergeHistoryResponse = z.infer<typeof runtimeMergeHistoryResponseSchema>;

// Explicit re-decompose (David 2026-09-04: "a feature that allows user to explicitly trigger further decompose
// for either full project unfinished cards .. or single cards"). The autonomous review rung spawns
// `redecompose-<parent>` cards only when a park exhausts the remedy ladder; this is the OPERATOR's handle on
// the same machinery: file a decompose card (full board context, generation stamped) for one card or for every
// unfinished card, and start it through the guarded start path.
export const runtimeRedecomposeRequestSchema = z.object({
	scope: z.enum(["card", "project_unfinished"]),
	/** Required for scope=card; ignored for project_unfinished. */
	taskId: z.string().min(1).optional(),
});
export type RuntimeRedecomposeRequest = z.infer<typeof runtimeRedecomposeRequestSchema>;
export const runtimeRedecomposeResponseSchema = z.object({
	filed: z.array(
		z.object({
			taskId: z.string(),
			redecomposeTaskId: z.string(),
			title: z.string(),
			/** Whether the decompose card's session was started (false ⇒ it sits in the backlog for the next sweep). */
			started: z.boolean(),
		}),
	),
	skipped: z.array(z.object({ taskId: z.string(), reason: z.string() })),
});
export type RuntimeRedecomposeResponse = z.infer<typeof runtimeRedecomposeResponseSchema>;

// Board schedule facts (David 2026-09-04: "make the dag show observed and estimated durations and eta
// timestamps .. highlight critical path"). ONE ledger read per board: per task, the observed attempt time and
// the difficulty the runtime estimated — the DAG derives estimates, the critical path and ETAs from these.
export const runtimeBoardScheduleTaskSchema = z.object({
	taskId: z.string(),
	/** Terminal attempts recorded for the task. */
	attempts: z.number().int().nonnegative(),
	/** Sum of attempt wall time (completedAt − startedAt) across attempts; null when no attempt carried both. */
	observedMs: z.number().nonnegative().nullable(),
	firstStartedAt: z.number().nullable(),
	lastCompletedAt: z.number().nullable(),
	/** §5.AB difficulty label from the latest attempt that carried one (trivial … very-hard). */
	difficulty: z.string().nullable(),
	lastOutcome: z.string().nullable(),
});
export type RuntimeBoardScheduleTask = z.infer<typeof runtimeBoardScheduleTaskSchema>;
export const runtimeBoardScheduleResponseSchema = z.object({
	generatedAt: z.number(),
	tasks: z.array(runtimeBoardScheduleTaskSchema),
});
export type RuntimeBoardScheduleResponse = z.infer<typeof runtimeBoardScheduleResponseSchema>;

// Un-park a review (2026-09-05): a card parked "for a human decision" (no-verdict / review-loop / integration
// gate) had NO operator handle at all — the only way forward was a manual stop→start worker redrive, which
// re-does the work instead of re-running the judgment. This clears the park and re-dispatches the review.
export const runtimeUnparkReviewRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeUnparkReviewRequest = z.infer<typeof runtimeUnparkReviewRequestSchema>;
export const runtimeUnparkReviewResponseSchema = z.object({
	ok: z.boolean(),
	/** What the park said, for the operator's record. */
	previousParkedReason: z.string().nullable(),
	/** Whether the review was re-dispatched immediately (false ⇒ the watchdog's rescue picks it up). */
	dispatched: z.boolean(),
	error: z.string().nullable(),
});
export type RuntimeUnparkReviewResponse = z.infer<typeof runtimeUnparkReviewResponseSchema>;

// Model-liveness dead marks (P0.AUDIT0904 leg 11, 2026-09-08): a marked model is excluded from routing for up to
// four hours, and until now nothing exposed that fact or let an operator undo it — a model that recovered early sat
// out its whole TTL invisibly. These read and clear the process-wide ledger (`src/core/model-liveness-ledger.ts`).
export const runtimeModelDeadMarkSchema = z.object({
	modelId: z.string(),
	/** The endpoint the model was proven dead ON — marks are keyed by (model, endpoint). */
	endpoint: z.string(),
	reason: z.enum(["absent_from_listing", "listed_but_dead"]),
	markedAtMs: z.number(),
	expiresAtMs: z.number(),
});
export type RuntimeModelDeadMark = z.infer<typeof runtimeModelDeadMarkSchema>;
export const runtimeListModelDeadMarksResponseSchema = z.object({
	marks: z.array(runtimeModelDeadMarkSchema),
});
export type RuntimeListModelDeadMarksResponse = z.infer<typeof runtimeListModelDeadMarksResponseSchema>;
export const runtimeClearModelDeadMarkRequestSchema = z.object({
	modelId: z.string().min(1),
	/** Omitted ⇒ re-admit the model on EVERY endpoint; given ⇒ only that host. */
	endpoint: z.string().min(1).nullable().optional(),
});
export type RuntimeClearModelDeadMarkRequest = z.infer<typeof runtimeClearModelDeadMarkRequestSchema>;
export const runtimeClearModelDeadMarkResponseSchema = z.object({
	ok: z.boolean(),
	/** How many marks the clear removed (0 ⇒ nothing was marked). */
	cleared: z.number(),
	error: z.string().nullable(),
});
export type RuntimeClearModelDeadMarkResponse = z.infer<typeof runtimeClearModelDeadMarkResponseSchema>;

export const runtimeNKleinAdvisorKindSchema = z.enum([
	"model_freshness",
	"mcp_discovery",
	"config_explainer",
	"log_analysis",
	"task_failure",
]);
export type RuntimeNKleinAdvisorKind = z.infer<typeof runtimeNKleinAdvisorKindSchema>;

export const runtimeNKleinAdvisorRequestSchema = z.object({
	kind: runtimeNKleinAdvisorKindSchema,
	title: z.string(),
	prompt: z.string(),
	requiresWebResearch: z.boolean(),
	recommendedSources: z.array(z.string()),
});
export type RuntimeNKleinAdvisorRequest = z.infer<typeof runtimeNKleinAdvisorRequestSchema>;

export const runtimeNKleinAdvisorBuildRequestSchema = z.object({
	kind: runtimeNKleinAdvisorKindSchema,
	repoSummary: z.string().optional(),
	modelRegistrySummary: z.string().optional(),
	runtimeConfigSummary: z.string().optional(),
	telemetrySummary: z.string().optional(),
	taskSummary: z.string().optional(),
	userQuestion: z.string().optional(),
});
export type RuntimeNKleinAdvisorBuildRequest = z.infer<typeof runtimeNKleinAdvisorBuildRequestSchema>;

export const runtimeNKleinAdvisorSendRequestSchema = z.object({
	prompt: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
});
export type RuntimeNKleinAdvisorSendRequest = z.infer<typeof runtimeNKleinAdvisorSendRequestSchema>;

export const runtimeNKleinAdvisorSendResponseSchema = z.object({
	providerId: z.string(),
	modelId: z.string(),
	output: z.string(),
	sentAt: z.number().int().nonnegative(),
	receivedAt: z.number().int().nonnegative(),
});
export type RuntimeNKleinAdvisorSendResponse = z.infer<typeof runtimeNKleinAdvisorSendResponseSchema>;

// F3.34 — explicit, egress-gated research for one unknown/failing LOCAL model. This is deliberately separate from
// the generic advisor contract: invoking it is the operator's egress action, and its result is review-only data. There
// is no "apply" flag or model-lifecycle action anywhere in this wire shape.
export const runtimeNKleinModelResearchRequestSchema = z.object({
	targetProviderId: z.string().min(1),
	targetModelId: z.string().min(1),
	targetEndpoint: z.string().nullable().optional(),
	failureSummary: z.string().max(2_000).optional(),
	/** A loaded local model used only to synthesize the gathered primary-source evidence. */
	advisorProviderId: z.string().min(1),
	advisorModelId: z.string().min(1),
});
export type RuntimeNKleinModelResearchRequest = z.infer<typeof runtimeNKleinModelResearchRequestSchema>;

export const runtimeNKleinModelResearchAreaSchema = z.enum([
	"api_switches",
	"tool_dialect",
	"reasoning_controls",
	"context_quant_quirks",
	"fit",
]);
export type RuntimeNKleinModelResearchArea = z.infer<typeof runtimeNKleinModelResearchAreaSchema>;

export const runtimeNKleinModelResearchEvidenceSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	url: z.string().url(),
	excerpt: z.string(),
});
export type RuntimeNKleinModelResearchEvidence = z.infer<typeof runtimeNKleinModelResearchEvidenceSchema>;

const citedResearchValue = <T extends z.ZodTypeAny>(value: T) =>
	z.object({ value, sourceIds: z.array(z.string().min(1)).min(1) });

export const runtimeNKleinModelResearchFindingSchema = z.object({
	area: runtimeNKleinModelResearchAreaSchema,
	claim: z.string().min(1),
	sourceIds: z.array(z.string().min(1)).min(1),
});
export type RuntimeNKleinModelResearchFinding = z.infer<typeof runtimeNKleinModelResearchFindingSchema>;

export const runtimeNKleinModelResearchProposalSchema = z.object({
	/** Exact-id overlay draft. Family-wide regex generalization requires later human review. */
	family: z.string().min(1),
	match: z.string().min(1),
	toolUse: citedResearchValue(
		z.enum(["TOOL_NATIVE", "TOOL_CAPABLE", "TOOL_WEAK", "TOOL_UNSUITABLE", "UNKNOWN"]),
	).nullable(),
	kind: citedResearchValue(
		z.enum(["instruct", "agentic", "code", "reasoning", "chat", "roleplay", "unknown"]),
	).nullable(),
	chaining: citedResearchValue(z.enum(["native", "via_force", "single_only", "fails", "unknown"])).nullable(),
	structuredOutput: citedResearchValue(
		z.enum(["json_schema", "json_schema_deadend", "native_tool_call", "unknown"]),
	).nullable(),
	note: z.string(),
	sources: z.array(z.string().url()),
	basis: z.literal("research"),
	verified: z.literal(false),
	findings: z.array(runtimeNKleinModelResearchFindingSchema),
	unknowns: z.array(z.string()),
	warnings: z.array(z.string()),
});
export type RuntimeNKleinModelResearchProposal = z.infer<typeof runtimeNKleinModelResearchProposalSchema>;

export const runtimeNKleinModelResearchResponseSchema = z.object({
	status: z.literal("provisional"),
	targetProviderId: z.string(),
	targetModelId: z.string(),
	targetEndpoint: z.string().nullable(),
	advisorProviderId: z.string(),
	advisorModelId: z.string(),
	researchedAt: z.number().int().nonnegative(),
	queries: z.array(z.string()),
	evidence: z.array(runtimeNKleinModelResearchEvidenceSchema),
	proposal: runtimeNKleinModelResearchProposalSchema,
	/** Load-bearing safety promise surfaced to every client. */
	autoApplied: z.literal(false),
});
export type RuntimeNKleinModelResearchResponse = z.infer<typeof runtimeNKleinModelResearchResponseSchema>;

export const runtimeNKleinDogfoodBacklogRequestSchema = z.object({
	suggestion: z.string().optional(),
	slug: z.string().optional(),
});
export type RuntimeNKleinDogfoodBacklogRequest = z.infer<typeof runtimeNKleinDogfoodBacklogRequestSchema>;

export const runtimeNKleinDogfoodBacklogResponseSchema = z.object({
	rootPath: z.string(),
	specPath: z.string(),
	planPath: z.string(),
	questionsPath: z.string(),
	decisionsPath: z.string(),
	revisionsPath: z.string(),
	summaryPath: z.string(),
	taskGraphPath: z.string(),
	slug: z.string(),
	taskCount: z.number().int().nonnegative(),
	nextCommand: z.string(),
});
export type RuntimeNKleinDogfoodBacklogResponse = z.infer<typeof runtimeNKleinDogfoodBacklogResponseSchema>;

export const runtimeNKleinSmokeEvalResponseSchema = z.object({
	workspacePath: z.string(),
	evidenceBundlePath: z.string(),
	acceptanceCommand: z.string(),
	passed: z.boolean(),
	exitCode: z.number().int().nullable(),
	output: z.string(),
	providerId: z.string(),
	modelId: z.string(),
	endpoint: z.string().nullable(),
});
export type RuntimeNKleinSmokeEvalResponse = z.infer<typeof runtimeNKleinSmokeEvalResponseSchema>;

// §5.AB "Evaluate connected models" (todo 6544) — the on-demand Settings trigger runs the eval corpus against
// every ALREADY-LOADED model (no loading ⇒ no host overload) and persists per-cell fitness. One summary per model.
export const runtimeModelEvalSummarySchema = z.object({
	modelId: z.string(),
	/** The structured-output strategy the evaluator used ("native_tool_call" | "content_json"). */
	strategy: z.string(),
	/** Mean 0..1 over SCORED attempts. */
	meanScore: z.number(),
	scoredAttempts: z.number().int().nonnegative(),
	totalAttempts: z.number().int().nonnegative(),
	byRole: z.array(
		z.object({
			role: z.string(),
			qualityScore: z.number(),
			reliability: z.number(),
			maxDifficultyCleared: z.number(),
			samples: z.number().int().nonnegative(),
		}),
	),
});
export type RuntimeModelEvalSummary = z.infer<typeof runtimeModelEvalSummarySchema>;

export const runtimeEvaluateConnectedModelsResponseSchema = z.object({
	evaluatedAt: z.number(),
	/** The local chat endpoint the loaded models were reached through (null if none configured). */
	endpoint: z.string().nullable(),
	repeats: z.number().int().positive(),
	models: z.array(runtimeModelEvalSummarySchema),
	/** Set when nothing ran (no loaded models / unreachable endpoint) — surfaced to the user verbatim. */
	skippedReason: z.string().nullable(),
});
export type RuntimeEvaluateConnectedModelsResponse = z.infer<typeof runtimeEvaluateConnectedModelsResponseSchema>;

export const runtimeTaskEvidenceRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeTaskEvidenceRequest = z.infer<typeof runtimeTaskEvidenceRequestSchema>;

export const runtimeTaskEvidenceCaptureStatusSchema = z.enum([
	"result_branch",
	"no_changes",
	"capture_failed",
	"capture_pending",
	"no_capture",
	"evidence_failed",
	"diff_failed",
]);
export type RuntimeTaskEvidenceCaptureStatus = z.infer<typeof runtimeTaskEvidenceCaptureStatusSchema>;

export const runtimeTaskEvidenceActionSchema = z.enum([
	"inspect_result",
	"redrive_task",
	"inspect_failure_and_redrive",
	"wait_for_capture",
	"start_or_redrive_task",
	"retry_evidence",
]);
export type RuntimeTaskEvidenceAction = z.infer<typeof runtimeTaskEvidenceActionSchema>;

const runtimeTaskEvidenceCaptureCommon = {
	message: z.string().min(1),
	/** The primary or derived task id whose durable result ref was inspected. */
	resultBranchTaskId: z.string().min(1),
};

/**
 * A discriminated capture contract: every status carries exactly the action/commit shape callers may rely on. This
 * prevents a nominal `result_branch` with no commit (or a pending capture that accidentally tells the UI to inspect a
 * diff) from crossing the API boundary.
 */
export const runtimeTaskEvidenceCaptureSchema = z.discriminatedUnion("status", [
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("result_branch"),
		action: z.literal("inspect_result"),
		resultCommit: z.string().min(1),
	}),
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("no_changes"),
		action: z.literal("redrive_task"),
		resultCommit: z.null(),
	}),
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("capture_failed"),
		action: z.literal("inspect_failure_and_redrive"),
		resultCommit: z.null(),
	}),
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("capture_pending"),
		action: z.literal("wait_for_capture"),
		resultCommit: z.null(),
	}),
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("no_capture"),
		action: z.literal("start_or_redrive_task"),
		resultCommit: z.null(),
	}),
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("evidence_failed"),
		action: z.literal("retry_evidence"),
		resultCommit: z.null(),
	}),
	z.object({
		...runtimeTaskEvidenceCaptureCommon,
		status: z.literal("diff_failed"),
		action: z.literal("retry_evidence"),
		resultCommit: z.string().min(1),
	}),
]);
export type RuntimeTaskEvidenceCapture = z.infer<typeof runtimeTaskEvidenceCaptureSchema>;

export const runtimeTaskEvidenceResponseSchema = z.object({
	bundlePath: z.string(),
	summaryPath: z.string(),
	capture: runtimeTaskEvidenceCaptureSchema,
	files: z.object({
		summary: z.string(),
		telemetry: z.string(),
		configSnapshot: z.string(),
		evalResult: z.string(),
		diffPatch: z.string().nullable(),
		transcripts: z.array(z.string()),
	}),
	summaryText: z.string(),
	diffPatchText: z.string().nullable(),
	promptBlock: z.string(),
});
export type RuntimeTaskEvidenceResponse = z.infer<typeof runtimeTaskEvidenceResponseSchema>;
