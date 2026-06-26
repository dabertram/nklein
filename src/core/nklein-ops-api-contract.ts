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

export const runtimeTaskEvidenceRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeTaskEvidenceRequest = z.infer<typeof runtimeTaskEvidenceRequestSchema>;

export const runtimeTaskEvidenceResponseSchema = z.object({
	bundlePath: z.string(),
	summaryPath: z.string(),
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
