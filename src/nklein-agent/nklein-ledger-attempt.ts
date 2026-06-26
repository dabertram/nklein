/**
 * Maps a terminal task run (the §5.C run-summary chokepoint) into an Agent Attempt Ledger event (§5.AF) — the first
 * live WRITER of the ledger. Pure + testable; the session service calls `buildTerminalAttemptEvent` and appends the
 * result best-effort, so every terminal task run becomes one durable `attempt` event the §5.Z matrix / §5.AA profile
 * can project from (`summarizeModelOutcomes`), instead of model outcomes evaporating into per-domain stores.
 *
 * Coarse by design at this seam: we have the model, the terminal outcome, the role, the timing, and the token usage —
 * not the per-tool-call detail (that needs the message history; a richer writer can layer on later). That's enough for
 * the per-model outcome/success-rate/speed projections the adaptive arc reads.
 */

import { createHash } from "node:crypto";
import { type AgentAttemptEvent, buildAttemptEvent } from "../core/agent-attempt-ledger";
import type { ModelOutcomeKind } from "../core/model-behavior-profile";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry";

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
	});
}
