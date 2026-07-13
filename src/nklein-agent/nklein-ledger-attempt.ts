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
	/** Non-null when the run ended on a bounded turn/stream/tool timeout (§5.C). */
	timeoutReason: string | null;
	/** Per-tool-call detail from the persisted transcript (`extractTerminalToolCalls`); omit for the coarse seam. */
	toolCalls?: AttemptToolCall[];
	knowledge?: AttemptKnowledgeUsage | null;
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
		contextTokens: input.promptTokens,
		tokensPerSec,
		outcome,
		qualityOk: outcome === "success",
		salvage: input.timeoutReason,
		toolCalls: input.toolCalls,
		knowledge: input.knowledge ?? null,
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
