/**
 * F12.107 — the ADW runner's wire contract (list definitions / start a run / poll run status). Server half in
 * src/server/adw-run-service.ts; the UI panel polls `getAdwRunStatus` while a run is live.
 */

import { z } from "zod";

export const runtimeAdwWorkflowSummarySchema = z.object({
	name: z.string().min(1),
	description: z.string().nullable(),
	stepCount: z.number().int().nonnegative(),
	agentStepCount: z.number().int().nonnegative(),
	invalid: z.string().nullable(),
});
export type RuntimeAdwWorkflowSummary = z.infer<typeof runtimeAdwWorkflowSummarySchema>;

export const runtimeAdwListWorkflowsResponseSchema = z.object({
	ok: z.boolean(),
	workflows: z.array(runtimeAdwWorkflowSummarySchema),
});
export type RuntimeAdwListWorkflowsResponse = z.infer<typeof runtimeAdwListWorkflowsResponseSchema>;

export const runtimeAdwRunRequestSchema = z.object({
	name: z.string().min(1),
	input: z.string().max(4_000).default(""),
});
export type RuntimeAdwRunRequest = z.infer<typeof runtimeAdwRunRequestSchema>;

export const runtimeAdwRunStartResponseSchema = z.object({
	ok: z.boolean(),
	runId: z.string().nullable(),
	error: z.string().nullable(),
});
export type RuntimeAdwRunStartResponse = z.infer<typeof runtimeAdwRunStartResponseSchema>;

export const runtimeAdwRunStatusRequestSchema = z.object({ runId: z.string().min(1) });
export type RuntimeAdwRunStatusRequest = z.infer<typeof runtimeAdwRunStatusRequestSchema>;

export const runtimeAdwRunStepStatusSchema = z.object({
	id: z.string(),
	kind: z.enum(["deterministic", "agent"]),
	status: z.enum(["pending", "running", "ok", "fail", "skipped"]),
	detail: z.string().nullable(),
	cardId: z.string().nullable(),
});
export type RuntimeAdwRunStepStatus = z.infer<typeof runtimeAdwRunStepStatusSchema>;

export const runtimeAdwRunSnapshotSchema = z.object({
	runId: z.string(),
	name: z.string(),
	input: z.string(),
	startedAt: z.number(),
	finishedAt: z.number().nullable(),
	verdict: z.enum(["running", "pass", "fail"]),
	steps: z.array(runtimeAdwRunStepStatusSchema),
	evidenceDir: z.string().nullable(),
	error: z.string().nullable(),
});
export type RuntimeAdwRunSnapshot = z.infer<typeof runtimeAdwRunSnapshotSchema>;

export const runtimeAdwRunStatusResponseSchema = z.object({
	ok: z.boolean(),
	run: runtimeAdwRunSnapshotSchema.nullable(),
});
export type RuntimeAdwRunStatusResponse = z.infer<typeof runtimeAdwRunStatusResponseSchema>;
