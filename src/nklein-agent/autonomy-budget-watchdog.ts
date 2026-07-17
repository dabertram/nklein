/**
 * Autonomy-budget watchdog collaborator (todo §5.X Phase 1 M3).
 *
 * Owns all per-task state and decision logic for the three autonomous-run guardrails that fire
 * at every {@link https://developer.mozilla.org/en-US/docs/Web | turn checkpoint}:
 *
 *  1. **Operator pause** — the board or card was paused; park the task immediately so it stops
 *     running.
 *
 *  2. **Max autonomous turns** — the task has consumed its turn budget; park for review.
 *
 *  3. **Repeated no-diff checkpoints** — consecutive checkpoints produced the same commit hash
 *     (the agent is spinning without making progress); park for review after N repeats.
 *
 *  4. **Max autonomous wall time** — the task has been running longer than the wall-time limit;
 *     park for review.
 *
 * The actual I/O side effects (aborting the SDK session, emitting system messages, updating the
 * summary state) stay in the session service and are injected via
 * {@link AutonomyBudgetWatchdogCallbacks}. Only per-task state tracking and the park/no-park
 * decision live here.
 *
 * Call sites in the session service:
 *  - `watchdog.check(taskId, checkpoint, entry)` — from `enforceAutonomyBudgets`; returns the
 *    decision (park type + args), or `null` to continue.
 *  - `watchdog.resetTask(taskId)` — on task start/restart/stop/abort/clear (clears per-task
 *    no-diff state).
 *  - `watchdog.dispose()` — on service dispose (clears the Map).
 */

import type {
	RuntimeSwarmGuardrails,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { assessRunawayBudget, type RunawayBudgetSignals, type RunawayBudgetVerdict } from "../core/runaway-budget-stop";
import { normalizeFinalAnswer } from "./nklein-response-loop-detection";
import type { NKleinTaskSessionEntry } from "./nklein-session-state";
import { now } from "./nklein-session-state";

/**
 * Park after this many consecutive review checkpoints that BOTH produced no new diff commit AND re-emitted the same
 * no-tool final answer — a model that has finished the work then loops re-printing an identical "Done!" final message
 * (§5.AA, from the qwen3.5-9b sweep). This is a faster, more-specific trigger than the plain no-diff guard
 * (`maxRepeatedNoDiffCheckpoints`, default 20): identical-message-AND-no-progress is an unambiguous stuck signal, so
 * parking it at 3 captures the already-done work for review promptly instead of waiting out the slow no-diff/wall-time
 * budget. Requiring no-new-commit too means a genuinely-progressing task (new commits) is never parked on message text.
 */
const NKLEIN_MAX_REPEATED_FINAL_ANSWERS = 3;

// ---------------------------------------------------------------------------
// Internal state shape
// ---------------------------------------------------------------------------

interface NKleinTaskNoDiffState {
	commit: string;
	count: number;
}

interface NKleinTaskRepeatedFinalAnswerState {
	normalized: string;
	commit: string;
	count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an elapsed duration in milliseconds as a human-readable string.
 * Mirrors `formatWallTimeDuration` from the original session service.
 */
export function formatWallTimeDuration(durationMs: number): string {
	const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) {
		return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
	}
	if (minutes === 0) {
		return `${hours} hour${hours === 1 ? "" : "s"}`;
	}
	return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Callbacks interface
// ---------------------------------------------------------------------------

/**
 * Callbacks the session service provides to let the watchdog perform the two park I/O side
 * effects without importing or knowing about the full service.
 */
export interface AutonomyBudgetWatchdogCallbacks {
	/**
	 * The live swarm guardrail limits. Read fresh each check so a live config update
	 * (via `setSwarmGuardrails`) takes effect immediately.
	 */
	getSwarmGuardrails(): RuntimeSwarmGuardrails;
	/**
	 * True when the task (or the entire board) is currently paused by the operator.
	 */
	isTaskPaused(taskId: string): boolean;
	/**
	 * Park the task as an operator-initiated pause (reversible; does NOT set `reviewReason`).
	 * Returns the updated (paused) summary.
	 */
	parkTaskForPause(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary;
	/**
	 * Park the task for autonomy-budget exhaustion (sets `reviewReason: "attention"`).
	 * Returns the updated (parked) summary.
	 */
	parkTaskForAutonomyBudget(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary;
	/**
	 * F12.40 (record-only): the card's LIVE run-cumulative token spend + the board-wide live total, from the
	 * live-usage registry; null before the first model call (or when the registry is unwired in a fake).
	 */
	getLiveUsageSignals?(taskId: string): { cardTokens: number; boardTokens: number } | null;
	/**
	 * F12.40 (record-only): sink for a tripped runaway-budget verdict. The breaker OBSERVES here — the SDK's
	 * cumulative-input basis is several times larger than the F12.58 card-effort metric the default caps were
	 * calibrated on, so the park flip is data-gated on what this records.
	 */
	onRunawayBudgetSignal?(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		verdict: RunawayBudgetVerdict;
		signals: RunawayBudgetSignals;
	}): void;
}

// ---------------------------------------------------------------------------
// Collaborator class
// ---------------------------------------------------------------------------

/**
 * Collaborator that owns the per-task no-diff checkpoint state Map and all associated
 * autonomous-run guardrail decision logic. Constructed once by the session service and held
 * for its lifetime.
 */
export class AutonomyBudgetWatchdog {
	private readonly noDiffCheckpointByTaskId = new Map<string, NKleinTaskNoDiffState>();
	private readonly repeatedFinalAnswerByTaskId = new Map<string, NKleinTaskRepeatedFinalAnswerState>();
	/** F12.40: tasks whose runaway-budget trip was already recorded this run (one observation per task per run). */
	private readonly runawayFlaggedTaskIds = new Set<string>();

	constructor(private readonly callbacks: AutonomyBudgetWatchdogCallbacks) {}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Run all autonomy-budget guardrails for `taskId` at `checkpoint`. Returns the parked
	 * summary if any guardrail trips, or `null` to let the task continue running.
	 *
	 * Mirrors `enforceAutonomyBudgets(taskId, checkpoint)` from the original session service.
	 */
	check(
		taskId: string,
		checkpoint: RuntimeTaskTurnCheckpoint,
		entry: NKleinTaskSessionEntry,
	): RuntimeTaskSessionSummary | null {
		if (isHomeAgentSessionId(taskId)) {
			return null;
		}
		if (entry.summary.reviewReason === "attention") {
			return null;
		}
		const guardrails = this.callbacks.getSwarmGuardrails();

		// 1. Operator pause
		if (this.callbacks.isTaskPaused(taskId)) {
			return this.callbacks.parkTaskForPause({
				taskId,
				entry,
				message: "Paused — will resume when the board/card is resumed.",
				metadata: {
					guardrail: "operator_pause",
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 2. Max autonomous turns
		if (checkpoint.turn >= guardrails.maxAutonomousTurnsPerTask) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${checkpoint.turn} autonomous turns so the swarm cannot run indefinitely. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "max_autonomous_turns",
					turn: checkpoint.turn,
					limit: guardrails.maxAutonomousTurnsPerTask,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 3. Repeated no-diff checkpoints
		const noDiffState = this.recordNoDiffCheckpoint(taskId, checkpoint);
		if (noDiffState.count >= guardrails.maxRepeatedNoDiffCheckpoints) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${noDiffState.count} consecutive checkpoints produced no new diff commit. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "repeated_no_diff_checkpoints",
					count: noDiffState.count,
					limit: guardrails.maxRepeatedNoDiffCheckpoints,
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 4. Repeated identical final answer with no new diff — a finished model looping its "Done!" final message
		//    (§5.AA). A faster, more-specific trigger than #3: identical-final-text AND no-progress parks at
		//    NKLEIN_MAX_REPEATED_FINAL_ANSWERS (3) so the already-done work is captured for review promptly instead of
		//    waiting out the slow no-diff/wall-time budget. (Checked after #3 so a plain no-diff loop with VARYING text
		//    still parks via #3; this only fires the faster path when the final text is identical too.)
		const finalAnswerState = this.recordRepeatedFinalAnswer(taskId, checkpoint, entry);
		if (finalAnswerState && finalAnswerState.count >= NKLEIN_MAX_REPEATED_FINAL_ANSWERS) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after it re-emitted the same final message ${finalAnswerState.count} times with no new changes — the work looks finished but the agent kept repeating itself instead of stopping. Review the result, then send a new instruction if more is needed.`,
				metadata: {
					guardrail: "repeated_final_answer",
					count: finalAnswerState.count,
					limit: NKLEIN_MAX_REPEATED_FINAL_ANSWERS,
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 5. Max autonomous wall time
		const startedAt = entry.summary.startedAt;
		const elapsedMs =
			typeof startedAt === "number" && Number.isFinite(startedAt) && startedAt > 0 ? now() - startedAt : null;
		if (elapsedMs !== null && elapsedMs >= guardrails.maxAutonomousWallTimeMs) {
			return this.callbacks.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${formatWallTimeDuration(elapsedMs)} of autonomous wall time so the swarm cannot run indefinitely. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "max_autonomous_wall_time",
					elapsedMs,
					limitMs: guardrails.maxAutonomousWallTimeMs,
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}

		// 6. F12.40 runaway-budget breaker — RECORD-ONLY. Consulted last so a real park always wins the turn; a
		//    tripped ceiling records one observation per task per run instead of parking (the cumulative-usage
		//    basis needs live calibration before the caps can be trusted to stop healthy work).
		if (
			this.callbacks.getLiveUsageSignals &&
			this.callbacks.onRunawayBudgetSignal &&
			!this.runawayFlaggedTaskIds.has(taskId)
		) {
			const live = this.callbacks.getLiveUsageSignals(taskId);
			if (live) {
				const signals: RunawayBudgetSignals = {
					cardTokens: live.cardTokens,
					cardTurns: checkpoint.turn,
					boardTokens: live.boardTokens,
				};
				const verdict = assessRunawayBudget(signals);
				if (verdict.stop) {
					this.runawayFlaggedTaskIds.add(taskId);
					this.callbacks.onRunawayBudgetSignal({ taskId, entry, verdict, signals });
				}
			}
		}

		return null;
	}

	/**
	 * Reset all watchdog state for a single task. Called on task start, restart, stop, abort,
	 * and clear so stale no-diff counts do not carry over to a fresh session.
	 */
	resetTask(taskId: string): void {
		this.noDiffCheckpointByTaskId.delete(taskId);
		this.repeatedFinalAnswerByTaskId.delete(taskId);
		this.runawayFlaggedTaskIds.delete(taskId);
	}

	/**
	 * Dispose all watchdog state. Called once when the session service is torn down.
	 */
	dispose(): void {
		this.noDiffCheckpointByTaskId.clear();
		this.repeatedFinalAnswerByTaskId.clear();
		this.runawayFlaggedTaskIds.clear();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private recordNoDiffCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): NKleinTaskNoDiffState {
		const commit = checkpoint.commit.trim();
		if (!commit) {
			this.noDiffCheckpointByTaskId.delete(taskId);
			return { commit: "", count: 0 };
		}
		const previous = this.noDiffCheckpointByTaskId.get(taskId);
		const nextState = previous?.commit === commit ? { commit, count: previous.count + 1 } : { commit, count: 1 };
		this.noDiffCheckpointByTaskId.set(taskId, nextState);
		return nextState;
	}

	/**
	 * Track the consecutive run of review checkpoints that re-emit the SAME (whitespace-normalized) no-tool final
	 * message at the SAME commit (no new diff). Returns the current run state, or `null` when this checkpoint has no
	 * final message (not a final-answer turn) — which also clears the per-task run. A new commit OR a different final
	 * message resets the count to 1, so only a genuinely stuck "finished, repeating itself" loop accumulates (§5.AA).
	 */
	private recordRepeatedFinalAnswer(
		taskId: string,
		checkpoint: RuntimeTaskTurnCheckpoint,
		entry: NKleinTaskSessionEntry,
	): NKleinTaskRepeatedFinalAnswerState | null {
		const normalized = normalizeFinalAnswer(entry.summary.latestHookActivity?.finalMessage ?? "");
		if (!normalized) {
			this.repeatedFinalAnswerByTaskId.delete(taskId);
			return null;
		}
		const commit = checkpoint.commit.trim();
		const previous = this.repeatedFinalAnswerByTaskId.get(taskId);
		const isRepeat = previous?.normalized === normalized && previous?.commit === commit;
		const nextState: NKleinTaskRepeatedFinalAnswerState = isRepeat
			? { normalized, commit, count: previous.count + 1 }
			: { normalized, commit, count: 1 };
		this.repeatedFinalAnswerByTaskId.set(taskId, nextState);
		return nextState;
	}
}
