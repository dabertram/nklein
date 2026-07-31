/**
 * Maps a terminal task run (the §5.C run-summary chokepoint) into an Agent Attempt Ledger event (§5.AF) — the first
 * live WRITER of the ledger. Pure + testable; the session service calls `buildTerminalAttemptEvent` and appends the
 * result best-effort, so every terminal task run becomes one durable `attempt` event the §5.Z matrix / §5.AA profile
 * can project from (`summarizeModelOutcomes`), instead of model outcomes evaporating into per-domain stores.
 *
 * Captures the model, the terminal outcome, the role, the timing, the token usage, and (when the caller supplies the
 * task's persisted transcript via `extractTerminalToolCalls`) the per-tool-call detail — enough for the per-model
 * outcome/success-rate/speed projections the adaptive arc reads, plus the per-tool usage/outcome breakdown.
 */

import { createHash } from "node:crypto";
import {
	type AgentAttemptEvent,
	type AttemptKnowledgeUsage,
	type AttemptToolCall,
	buildAttemptEvent,
} from "../core/agent-attempt-ledger";
import type { ModelOutcomeKind } from "../core/model-behavior-profile";
import { loadWorkspaceState } from "../state/workspace-state";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry";
import { readNKleinPlanArtifacts } from "./nklein-plan-artifacts";

/** A stable, host-path-free workspace key for the per-workspace ledger file (never the path itself — invariant #2). */
export function hashWorkspacePathForLedger(workspacePath: string | null): string {
	return createHash("sha256")
		.update(workspacePath?.trim() || "unknown")
		.digest("hex")
		.slice(0, 16);
}

/** Map a terminal session state (+ whether a timeout fired) to the §5.AA outcome taxonomy. */
export function mapTerminalStateToOutcome(
	state: "awaiting_review" | "failed" | "interrupted",
	hadTimeout: boolean,
): ModelOutcomeKind {
	if (state === "awaiting_review") {
		return "success";
	}
	if (hadTimeout) {
		return "timeout";
	}
	// An `interrupted` end with NO !Klein timeout is a no-output SDK/agent-loop `aborted` — a TRANSIENT, not a hard
	// failure (§5.AA, root-caused 2026-06-28: the same task completed on a longer retest). Classify it as `aborted` so
	// it doesn't pollute the model's hard-failure profile and is treated as retryable rather than parked.
	if (state === "interrupted") {
		return "aborted";
	}
	return "other_failure";
}

export interface TerminalAttemptInput {
	taskId: string;
	workspacePath: string | null;
	state: "awaiting_review" | "failed" | "interrupted";
	role: string | null;
	providerId: string | null;
	modelId: string | null;
	endpoint: string | null;
	startedAt: number | null;
	endedAt: number;
	promptTokens: number | null;
	completionTokens: number | null;
	/** N18: reasoning-only tokens, when the server reported them; null = not reported. */
	reasoningTokens?: number | null;
	/** Non-null when the run ended on a bounded turn/stream/tool timeout (§5.C). */
	timeoutReason: string | null;
	/** Per-tool-call detail from the persisted transcript (`extractTerminalToolCalls`); omit for the coarse seam. */
	toolCalls?: AttemptToolCall[];
	/** P21.14: total tool calls in the transcript at capture time (the delta watermark). Omit for the coarse seam. */
	transcriptToolCallCount?: number | null;
	/** F12.29: procedural-skill ids surfaced into the session prompt (for paired-trajectory auditing). */
	surfacedSkillIds?: readonly string[];
	knowledge?: AttemptKnowledgeUsage | null;
	focusStep?: string | null;
	// F1.14 completion — the fields the terminal write previously left at their defaults:
	/** The captured result branch ref (durable output pointer), when the run produced one. */
	resultBranch?: string | null;
	/** The session's configured context window (the budget the contextTokens usage is measured against). */
	contextBudgetTarget?: number | null;
	/** Rung index: how many attempts this task recorded BEFORE this one (0 = first try). */
	retriesBefore?: number;
	/** F1.21: taint labels the session accumulated (the delivery gate reads them from the ledger). */
	taintLabels?: readonly string[] | null;
	/** P21.15: tool names the model was OFFERED — the behaviour profile's toolCount dimension. */
	toolSetOffered?: readonly string[] | null;
	/** The recovery rung that produced this attempt (redrive_empty_patch, steer_no_progress, …); null = baseline. */
	promptStrategy?: string | null;
	/** F1.15a: the task's difficulty tier — the SAME derivation the §5.AB fitness fold uses (deriveTaskDifficultyTier). */
	difficulty?: string | null;
}

/**
 * P21.14 — reduce a task's FULL transcript tool calls to just THIS attempt's, using the watermark its
 * predecessors recorded. Pure.
 *
 * ── WHY THE WATERMARK COUNTS TOOL CALLS AND NOT MESSAGES ──
 * The obvious design slices the message list and extracts from the slice. It is wrong: `extractTerminalToolCalls`
 * pairs a `tool_use` with its `tool_result` by id **within the list it is given**, so a slice boundary falling
 * between the two leaves the call unresolved in one attempt and **silently drops the result in the next** — the
 * id has no match in the new slice's map. Extracting over the WHOLE transcript keeps every pair intact; the
 * delta is then taken on the already-correct call list.
 *
 * ── WHY A DURABLE WATERMARK AND NOT AN IN-PROCESS BOUNDARY ──
 * The duplication is restart-driven: a fresh process re-terminates tasks that already finished, and any in-memory
 * mark is empty exactly when it is needed. The watermark therefore lives on the attempt events themselves.
 *
 * ── LEGACY ──
 * Attempts written before the field carry `null`. Those are treated as 0 rather than guessed at, so the first
 * capture after this change re-records what today's code would have recorded — one more duplicate, once per task
 * — and every capture after it is a true delta. Reinterpreting a historical cumulative count as a delta would
 * silently rewrite the meaning of data already on disk.
 */
export function resolveAttemptToolCallDelta(input: {
	/** Tool calls extracted from the ENTIRE transcript, in order. */
	readonly allToolCalls: readonly AttemptToolCall[];
	/** Watermarks recorded by prior attempts of this task (`transcriptToolCallCount`), nulls included. */
	readonly priorWatermarks: readonly (number | null)[];
}): { toolCalls: AttemptToolCall[]; transcriptToolCallCount: number } {
	const consumed = input.priorWatermarks.reduce<number>(
		(highest, mark) => (typeof mark === "number" && Number.isFinite(mark) && mark > highest ? mark : highest),
		0,
	);
	// A watermark ABOVE the current call count means the transcript SHRANK (a compaction, or a fresh session
	// reusing the task id). Restart from 0 rather than clamping to the end: clamping slices past everything and
	// reports zero calls for the rest of the task's life, whereas starting over records one duplicate — the
	// recoverable direction, and the same fail-safe choice the legacy-null case makes.
	const start = consumed > input.allToolCalls.length ? 0 : Math.max(0, consumed);
	return {
		toolCalls: input.allToolCalls.slice(start).map((call) => ({ ...call })),
		transcriptToolCallCount: input.allToolCalls.length,
	};
}

/** Build the `attempt` ledger event for one terminal task run. Pure (no I/O); the caller appends it best-effort. */
export function buildTerminalAttemptEvent(input: TerminalAttemptInput): AgentAttemptEvent {
	const durationMs =
		input.startedAt !== null && input.endedAt > input.startedAt ? input.endedAt - input.startedAt : null;
	const tokensPerSec =
		durationMs !== null && durationMs > 0 && input.completionTokens !== null && input.completionTokens > 0
			? Math.round((input.completionTokens / (durationMs / 1000)) * 10) / 10
			: null;
	const outcome = mapTerminalStateToOutcome(input.state, input.timeoutReason !== null);
	return buildAttemptEvent({
		...(input.surfacedSkillIds && input.surfacedSkillIds.length > 0
			? { surfacedSkillIds: input.surfacedSkillIds }
			: {}),
		workflowId: input.taskId,
		taskId: input.taskId,
		workspacePathHash: hashWorkspacePathForLedger(input.workspacePath),
		role: input.role,
		attemptId: `${input.taskId}:${input.endedAt}`,
		modelId: buildNKleinModelRegistryKey({
			providerId: input.providerId ?? "",
			modelId: input.modelId ?? "",
			endpoint: input.endpoint ?? "",
		}),
		endpoint: input.endpoint,
		startedAt: input.startedAt,
		completedAt: input.endedAt,
		promptStrategy: input.promptStrategy ?? null,
		difficulty: input.difficulty ?? null,
		contextTokens: input.promptTokens,
		reasoningTokens: input.reasoningTokens ?? null,
		contextBudgetTarget: input.contextBudgetTarget ?? null,
		tokensPerSec,
		outcome,
		qualityOk: outcome === "success",
		retriesBefore: input.retriesBefore ?? 0,
		salvage: input.timeoutReason,
		toolCalls: input.toolCalls,
		transcriptToolCallCount: input.transcriptToolCallCount ?? null,
		...(input.toolSetOffered ? { toolSetOffered: [...input.toolSetOffered] } : {}),
		knowledge: input.knowledge ?? null,
		focusStep: input.focusStep ?? null,
		artifacts: input.resultBranch ? { resultBranch: input.resultBranch, patchRef: null, evidenceBundle: null } : null,
		...(input.taintLabels?.length ? { taintLabels: input.taintLabels } : {}),
	});
}

/**
 * F1.1 — was the task's originating plan card born with declared KNOWLEDGE DEBT? Resolved once per terminal run for
 * the ledger's knowledge summary: board card → `generatedFromPlan` → plan artifact task → non-empty `knowledgeDebt`.
 * Best-effort: null (unknown) on any miss — a non-plan-born card, a trashed plan, or an unreadable artifact must not
 * be counted as "no debt".
 */
export async function resolveTaskKnowledgeDebtPresent(
	workspacePath: string | null | undefined,
	taskId: string,
): Promise<boolean | null> {
	if (!workspacePath) {
		return null;
	}
	try {
		const state = await loadWorkspaceState(workspacePath);
		const card = state.board.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === taskId);
		const origin = card?.generatedFromPlan;
		if (!origin) {
			return null;
		}
		const artifacts = await readNKleinPlanArtifacts(workspacePath, origin.planSlug);
		const planTask = artifacts.taskGraph.tasks.find((task) => task.id === origin.planTaskId);
		if (!planTask) {
			return null;
		}
		return typeof planTask.knowledgeDebt === "string" && planTask.knowledgeDebt.trim().length > 0;
	} catch {
		return null;
	}
}
