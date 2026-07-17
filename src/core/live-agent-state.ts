/**
 * F12.51 differentiated live agent-state taxonomy — PURE core.
 *
 * AMBIGUOUS state is the #1 parallel-agent supervision failure: "waiting-for-approval" (blocked on the OPERATOR) and
 * "idle at prompt" (nothing needed) look identical, and a silently dead run looks like a working one. This classifier
 * refines the coarse operator health states (`operator-task-state.ts` healthy/stuck/risky/done) into the six
 * SUPERVISION states — what is this agent doing right now, and is it MY turn or ITS turn:
 *
 *   working · blocked-on-dependency · waiting-for-approval · stuck · idle · done
 *
 * The working→stuck auto-flip reuses the §5.AG liveness windows (`run-attention-signals.ts`), scaled by the task's
 * difficulty tier — a hard task is EXPECTED to go quiet longer than an easy one before "quiet" means "stuck". Pure +
 * deterministic: every signal and the clock are injected; the UI derives the inputs from data it already receives.
 */

import {
	assessRunLiveness,
	DEFAULT_RUN_LIVENESS_THRESHOLDS,
	type RunLivenessThresholds,
} from "./run-attention-signals";

export type LiveAgentState = "working" | "blocked_on_dependency" | "waiting_for_approval" | "stuck" | "idle" | "done";

export interface LiveAgentStateSignals {
	/** The session lifecycle state as the summary reports it (running/queued/paused/awaiting_review/failed/…). */
	readonly sessionState:
		| "idle"
		| "queued"
		| "running"
		| "paused"
		| "awaiting_review"
		| "failed"
		| "interrupted"
		| null;
	/** The board lane the card sits in. */
	readonly columnId: "backlog" | "planning" | "ready" | "in_progress" | "review" | "completed" | "trash";
	/** An operator decision is pending: approval ack, held delivery, clarifying question, or an escalation/park. */
	readonly waitingForOperator: boolean;
	/** The card has at least one OPEN upstream dependency (derive via `openDependencyBlockers`). */
	readonly blockedOnDependency: boolean;
	/** Injected clock (ms since epoch). */
	readonly nowMs: number;
	/** Last forward activity (output/tool/hook) timestamp; null when nothing observed yet. */
	readonly lastActivityAtMs: number | null;
	/** Heartbeat status as the summary reports it; null when no heartbeat channel. */
	readonly heartbeatStatus: "healthy" | "stale" | "lost" | null;
	/** Difficulty tier when estimated — scales how long "quiet" stays "working" before flipping to stuck. */
	readonly difficultyTier: "easy" | "medium" | "hard" | null;
}

export interface LiveAgentStateVerdict {
	readonly state: LiveAgentState;
	/** One short operator-facing sentence naming WHY — whose turn it is and what would unblock. */
	readonly reason: string;
}

/**
 * Difficulty-scaled liveness windows for the working→stuck flip: an easy task quiet for 5 minutes is stuck; a hard
 * one is EXPECTED to think/build that long, so its stall window stretches (2×/4× the default; heartbeat-loss window
 * is difficulty-independent — a dead process is dead regardless of task size).
 */
export function livenessThresholdsForDifficulty(tier: "easy" | "medium" | "hard" | null): RunLivenessThresholds {
	const scale = tier === "hard" ? 4 : tier === "medium" ? 2 : 1;
	return {
		...DEFAULT_RUN_LIVENESS_THRESHOLDS,
		stalledAfterMs: DEFAULT_RUN_LIVENESS_THRESHOLDS.stalledAfterMs * scale,
	};
}

/**
 * The upstream task ids that still block a card: its dependency edges whose source task is not yet in a terminal
 * lane. Feed the result's non-emptiness into `classifyLiveAgentState` as `blockedOnDependency`.
 */
export function openDependencyBlockers(
	taskId: string,
	dependencies: readonly { fromTaskId: string; toTaskId: string }[],
	columnByTaskId: ReadonlyMap<string, string>,
): string[] {
	return dependencies
		.filter((edge) => edge.toTaskId === taskId)
		.map((edge) => edge.fromTaskId)
		.filter((upstreamId) => {
			const column = columnByTaskId.get(upstreamId);
			// An unknown upstream (deleted card) does not block; completed/trash lanes are settled.
			return column !== undefined && column !== "completed" && column !== "trash";
		});
}

/**
 * Classify the six-state supervision taxonomy. Precedence answers "whose turn is it": done (nobody's) →
 * waiting-for-approval (the OPERATOR's — the one state that must never masquerade as idle) → stuck on a dead/stalled
 * run (the operator should intervene) → blocked-on-dependency (another AGENT's) → working/idle (the agent's own).
 */
export function classifyLiveAgentState(signals: LiveAgentStateSignals): LiveAgentStateVerdict {
	if (
		signals.columnId === "completed" ||
		signals.columnId === "review" ||
		signals.sessionState === "awaiting_review"
	) {
		return {
			state: "done",
			reason: signals.columnId === "completed" ? "Completed." : "Finished — awaiting human review.",
		};
	}
	if (signals.waitingForOperator) {
		return { state: "waiting_for_approval", reason: "Blocked on YOU — an approval or answer is pending." };
	}
	if (signals.sessionState === "failed" || signals.sessionState === "interrupted") {
		return { state: "stuck", reason: `Run ${signals.sessionState} — needs a restart or triage.` };
	}
	if (signals.sessionState === "running") {
		const liveness = assessRunLiveness(
			{
				nowMs: signals.nowMs,
				lastActivityAtMs: signals.lastActivityAtMs,
				// The summary's own heartbeat classification is authoritative when present.
				lastHeartbeatAtMs: signals.heartbeatStatus === "lost" ? 0 : signals.nowMs,
				expectsHeartbeat: signals.heartbeatStatus !== null,
			},
			livenessThresholdsForDifficulty(signals.difficultyTier),
		);
		if (liveness === "silent" || liveness === "stalled") {
			return {
				state: "stuck",
				reason:
					liveness === "silent"
						? "Heartbeat lost — the run may be dead."
						: "No forward progress past the expected window for this task size.",
			};
		}
		return { state: "working", reason: "Actively progressing." };
	}
	if (signals.blockedOnDependency) {
		return { state: "blocked_on_dependency", reason: "Waiting on an upstream task to finish." };
	}
	if (signals.sessionState === "queued") {
		return { state: "idle", reason: "Queued — waiting for sandbox capacity." };
	}
	if (signals.sessionState === "paused") {
		return { state: "idle", reason: "Paused — resume when ready." };
	}
	return { state: "idle", reason: "Nothing running — ready for its next turn." };
}
