import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import {
	type ContextOverflowTerminalRecoveryDecision,
	decideContextOverflowTerminalRecovery,
	isContextOverflowErrorTerminal,
} from "../core/context-overflow-recovery-policy";
import { isContextOverflowMessage } from "../core/context-overflow-signature";
import { isEnabledByDefaultEnv } from "../core/env-flag";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import { recordSelfObservation } from "../telemetry/self-observation-sink";

/** Retry-ladder rung this controller spends (labels the next attempt-ledger event, like the failover leg's carry). */
const CONTEXT_SHRINK_STRATEGY = "context_shrink";
const ERROR_PREVIEW_CHARS = 160;

export interface ContextOverflowTerminalControllerDeps {
	/** Whether the task's persisted history can still be compacted (a dry run of the reactive compactor). */
	canCompactHistory(taskId: string): Promise<boolean>;
	/**
	 * Re-drive the card through the normal input seam carrying the overflow error, so the send path runs the
	 * reactive compaction (stop → compact → restart on the same model) under model-turn admission with the ordinary
	 * result handling. The card stays parked exactly as before if this rejects (fail-closed).
	 */
	redriveAfterOverflow(taskId: string, errorMessage: string): Promise<unknown>;
	/** The next rung: the model-failover leg, handed the SAME terminal summary. */
	failOverToNextModel(taskId: string, summary: RuntimeTaskSessionSummary): void;
	/** Correlate the spent rung with the next terminal attempt ledger event. */
	noteStrategyApplied?: (taskId: string, strategy: string) => void;
}

export interface ContextOverflowTerminalController {
	/**
	 * P0.CTX500: claim an error terminal whose error is a context overflow. Returns `true` when this controller OWNS
	 * the transition (its async chain will compact-and-re-drive, or hand the summary to the failover leg itself);
	 * `false` when the terminal is not an overflow — the caller's ordinary terminal handling then proceeds.
	 */
	maybeRecoverTerminalOverflow(taskId: string, summary: RuntimeTaskSessionSummary): boolean;
	/** Drop per-task state (session forget/cleanup). */
	forgetTask(taskId: string): void;
}

/**
 * The overflow wording a terminal summary carries, from EITHER the summary warning or the retained hook final message
 * — `null` when neither is a context overflow.
 *
 * Both are read because `warningMessage` is a REWRITE seam: the event adapter's `run-failed` arm runs the raw error
 * through `resolveAgentErrorWarning`, which swaps a local-model-unavailable error for the operator-facing reload
 * guidance. Keying on the warning alone would therefore lose an overflow whose text was rewritten, while
 * `latestHookActivity.finalMessage` keeps the raw engine string on that same arm.
 */
export function readContextOverflowErrorMessage(summary: RuntimeTaskSessionSummary): string | null {
	for (const candidate of [summary.warningMessage, summary.latestHookActivity?.finalMessage]) {
		const text = candidate?.trim();
		if (text && isContextOverflowMessage(text)) {
			return text;
		}
	}
	return null;
}

/** The continue prompt the compacted same-model restart is re-driven with. */
export function buildContextOverflowRedrivePrompt(errorMessage: string): string {
	return (
		`The previous turn overflowed the model's context window (${errorMessage.slice(0, ERROR_PREVIEW_CHARS)}). ` +
		"!Klein compacted the earlier conversation history — continue the task from the current workspace state and " +
		"complete it; re-read only what you still need."
	);
}

/**
 * P0.CTX500 (live 2026-09-03, `s42-invariant-battery` on ornith-local-9b): an engine "Context size has been exceeded"
 * 500 parked the card. A mid-turn overflow never rejects the SDK send (the vendored AgentRuntime returns
 * `status: "failed"`), so the terminal summary is the only seam that sees it — and that seam knew only the model-
 * failover leg, which refused the wording as "not model-side". This controller sits AHEAD of that leg and runs the
 * pure {@link decideContextOverflowTerminalRecovery} ladder: compact-and-re-drive on the same model first, defer to
 * model failover when the history cannot shrink or the consecutive re-drive budget is spent, park last.
 *
 * DEFAULT-ON; kill-switch `NKLEIN_CONTEXT_OVERFLOW_REDRIVE=0/false/off`. Fail-closed: any error in the async chain
 * leaves the card parked in Review exactly as before. Derived (`::merge`, `::review`, `::spec`) and home-agent
 * sessions are excluded — their harnesses own the bounded turn/verdict lifecycle; they still get the in-turn
 * `context_shrink` rung from the shared classifier.
 */
export function createContextOverflowTerminalController(
	deps: ContextOverflowTerminalControllerDeps,
): ContextOverflowTerminalController {
	/** Consecutive same-model compaction re-drives per task; reset by any non-overflow terminal. */
	const redrivesUsedByTaskId = new Map<string, number>();
	const inFlightTaskIds = new Set<string>();

	function record(
		taskId: string,
		summary: RuntimeTaskSessionSummary,
		decision: ContextOverflowTerminalRecoveryDecision,
		severity: "info" | "warning",
		outcome: string,
	): void {
		recordSelfObservation({
			signal: "custom",
			severity,
			message: `Context-overflow terminal for ${taskId}: ${decision.reason} (${outcome})`,
			taskId,
			providerId: summary.providerId ?? undefined,
			modelId: summary.modelId ?? undefined,
			metadata: {
				category: "context_overflow_redrive",
				action: decision.action,
				outcome,
				redrivesUsed: redrivesUsedByTaskId.get(taskId) ?? 0,
				error: (readContextOverflowErrorMessage(summary) ?? "").slice(0, ERROR_PREVIEW_CHARS),
			},
		});
	}

	function forgetTask(taskId: string): void {
		redrivesUsedByTaskId.delete(taskId);
		inFlightTaskIds.delete(taskId);
	}

	function maybeRecoverTerminalOverflow(taskId: string, summary: RuntimeTaskSessionSummary): boolean {
		if (!isEnabledByDefaultEnv(process.env.NKLEIN_CONTEXT_OVERFLOW_REDRIVE)) {
			return false;
		}
		const errorMessage = readContextOverflowErrorMessage(summary);
		const terminal = { state: summary.state, reviewReason: summary.reviewReason, errorMessage };
		if (!isContextOverflowErrorTerminal(terminal)) {
			// Any other terminal (a healthy end, an attention park, a different error) ends the consecutive-overflow
			// streak: the next overflow on this card gets a fresh re-drive budget.
			if (summary.state === "awaiting_review" || summary.state === "failed" || summary.state === "interrupted") {
				redrivesUsedByTaskId.delete(taskId);
			}
			return false;
		}
		if (isHomeAgentSessionId(taskId) || isDerivedTaskSessionId(taskId) || inFlightTaskIds.has(taskId)) {
			return false;
		}
		if (!errorMessage) {
			return false;
		}
		inFlightTaskIds.add(taskId);
		void (async () => {
			try {
				const historyCompactable = await deps.canCompactHistory(taskId).catch(() => false);
				const decision = decideContextOverflowTerminalRecovery({
					...terminal,
					historyCompactable,
					compactionRedrivesUsed: redrivesUsedByTaskId.get(taskId) ?? 0,
				});
				if (decision.action === "compact_and_redrive") {
					redrivesUsedByTaskId.set(taskId, (redrivesUsedByTaskId.get(taskId) ?? 0) + 1);
					deps.noteStrategyApplied?.(taskId, CONTEXT_SHRINK_STRATEGY);
					record(taskId, summary, decision, "warning", "redriving");
					try {
						await deps.redriveAfterOverflow(taskId, errorMessage);
					} catch (error) {
						// Fail-closed: the card stays parked in Review exactly as before this controller existed.
						record(taskId, summary, decision, "warning", `redrive failed: ${String(error).slice(0, 200)}`);
					}
					return;
				}
				if (decision.action === "defer_to_model_failover") {
					record(taskId, summary, decision, "info", "handed to model failover");
					deps.failOverToNextModel(taskId, summary);
				}
			} catch {
				// Observability/decision plumbing must never alter the card's parked state.
			} finally {
				inFlightTaskIds.delete(taskId);
			}
		})();
		return true;
	}

	return { maybeRecoverTerminalOverflow, forgetTask };
}
