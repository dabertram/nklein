import { type AgentLedgerEvent, selectAttempts, summarizeModelSpeed } from "../core/agent-attempt-ledger";
import {
	buildAttemptProgressSnapshotsFromLedger,
	buildStucknessSignalsFromLedger,
} from "../core/agent-ledger-projections";
import { classifyAgentStuckness } from "../core/agent-stuckness";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { consecutiveNoProgressAttempts } from "../core/attempt-progress-tracker";
import type { PowerMode } from "../core/power-aware-timeout";
import { detectProcessRemediation, type RemediationFinding } from "../core/process-remediation";
import { buildProcessTrajectoryFromLedger } from "../core/process-remediation-ledger";
import { assessRunLiveness, type RunLivenessThresholds } from "../core/run-attention-signals";
import { deriveLivenessThresholds, type SpeedAwareLivenessInput } from "../core/speed-aware-liveness";
import { assessTaskTrouble, type TaskTroubleVerdict } from "../core/task-trouble-signal";

/** Rough expected turn output size per difficulty tier — the task-shape term of the F3.19 budget. */
const DIFFICULTY_OUTPUT_TOKENS: Readonly<Record<string, number>> = {
	trivial: 600,
	easy: 900,
	medium: 2000,
	hard: 4000,
	"very-hard": 6000,
};

/**
 * F3.19 — build the speed context for a running card from its own ledger: the model of its latest attempt, that model's
 * measured tok/s, and its difficulty → expected output tokens, paired with the host power mode. Null when the task has
 * no attempt yet (nothing to derive from ⇒ the caller keeps the fixed base). Pure over the injected events.
 */
export function buildCardSpeedContext(
	events: readonly AgentLedgerEvent[],
	taskId: string,
	powerMode: PowerMode,
): Omit<SpeedAwareLivenessInput, "base"> | null {
	const attempts = selectAttempts(events).filter((attempt) => attempt.taskId === taskId);
	const latest = attempts[attempts.length - 1];
	if (!latest) {
		return null;
	}
	const speed = summarizeModelSpeed(events).find((row) => row.modelId === latest.modelId);
	return {
		measuredTokensPerSec: speed?.avgTokensPerSec ?? null,
		expectedOutputTokens: DIFFICULTY_OUTPUT_TOKENS[latest.difficulty ?? "medium"] ?? 2000,
		powerMode,
	};
}

/**
 * F1.10 — the runtime's first-class STUCK/AT-RISK read for a RUNNING task: composes the unified trouble signal
 * (`assessTaskTrouble`) from live data — the §5.AF ledger's attempt stream (stuckness classification + the
 * no-progress streak + uncleared loops) and the session summary's activity ages (liveness) — so the board-liveness
 * watchdog can steer a grinding worker EARLY instead of waiting for the terminal rungs.
 *
 * This read only STEERS (a bounded mid-session nudge) and RECORDS (self-observation + ledger transition). It never
 * kills: the zero-token wedge sweep and the heartbeat watchdog own terminating dead runs, and the terminal-redrive
 * §5.AG Layer-1 ladder owns model switching. Thresholds are deliberately generous — local models on low-power hosts
 * legitimately think for minutes (never read slowness as stalling).
 */

/** Generous liveness thresholds for the trouble read (idle 2 min, stalled 10 min, silent 20 min). */
export const RUNNING_TASK_TROUBLE_LIVENESS_THRESHOLDS: RunLivenessThresholds = {
	idleAfterMs: 120_000,
	stalledAfterMs: 600_000,
	heartbeatLostAfterMs: 1_200_000,
};

export interface RunningTaskTroubleInput {
	events: readonly AgentLedgerEvent[];
	summary: RuntimeTaskSessionSummary;
	nowMs: number;
	/** Explicit thresholds win over everything (tests / overrides). */
	thresholds?: RunLivenessThresholds;
	/**
	 * F3.19 — an explicit speed context (mostly for tests). Usually prefer `powerMode`, which builds the context from
	 * this task's own ledger. Absent (and no `powerMode`) ⇒ the generous fixed base (byte-identical).
	 */
	speedContext?: Omit<SpeedAwareLivenessInput, "base">;
	/**
	 * F3.19 — the host power mode (the caller detects it once per watchdog tick). When set, the thresholds are derived
	 * from this task's own ledger (its model's measured tok/s + difficulty) scaled by power, so a slow-but-working
	 * local model in low power isn't falsely flagged. `low` alone already stretches every window.
	 */
	powerMode?: PowerMode;
}

/** Evaluate the unified trouble verdict for one RUNNING task from the ledger + its session summary. */
export function evaluateRunningTaskTrouble(input: RunningTaskTroubleInput): TaskTroubleVerdict {
	const { events, summary } = input;
	const speedContext =
		input.speedContext ?? (input.powerMode ? buildCardSpeedContext(events, summary.taskId, input.powerMode) : null);
	const thresholds =
		input.thresholds ??
		(speedContext
			? deriveLivenessThresholds({ ...speedContext, base: RUNNING_TASK_TROUBLE_LIVENESS_THRESHOLDS })
			: RUNNING_TASK_TROUBLE_LIVENESS_THRESHOLDS);
	const stucknessSignals = buildStucknessSignalsFromLedger(events, summary.taskId);
	const snapshots = buildAttemptProgressSnapshotsFromLedger(events, summary.taskId);
	const liveness = assessRunLiveness(
		{
			nowMs: input.nowMs,
			lastActivityAtMs: summary.lastOutputAt ?? null,
			lastHeartbeatAtMs: summary.lastHookAt ?? summary.lastOutputAt ?? null,
			// Only a session that actually started emitting is expected to beat — the pre-first-token window is the
			// zero-token wedge sweep's jurisdiction, not a liveness "silent".
			expectsHeartbeat: summary.state === "running" && summary.lastOutputAt !== null,
		},
		thresholds,
	);
	return assessTaskTrouble({
		stuckness: classifyAgentStuckness(stucknessSignals),
		liveness,
		consecutiveNoProgress: consecutiveNoProgressAttempts(snapshots),
		loopUncleared: stucknessSignals.loopUncleared,
	});
}

/**
 * PRM read for a RUNNING task (opencode-swarm port) — the MULTI-STEP trajectory faults `evaluateRunningTaskTrouble`
 * (single-agent stuckness/liveness) doesn't see: ping_pong / expansion_drift / context_thrash. Pure — projects the same
 * ledger `events` into a trajectory and runs the detector. Plan counts (for expansion_drift) are an optional caller
 * input the ledger attempts don't carry. RECORD-ONLY at the call site (never steers/kills), mirroring the observe-first
 * stance — the evidence accrues before any of these gate.
 */
export function evaluateRunningTaskRemediation(input: {
	events: readonly AgentLedgerEvent[];
	taskId: string;
	planCounts?: { initial: number; current: number };
}): RemediationFinding[] {
	const trajectory = buildProcessTrajectoryFromLedger(input.events, input.taskId, input.planCounts);
	return detectProcessRemediation(trajectory);
}

/**
 * The bounded mid-session steer for a troubled-but-alive run (cancel-then-send, one per task per episode kind).
 * `silent` returns null — a possibly-dead run gets recorded, not messaged (the killing rungs own it).
 */
export function buildTroubleSteeringMessage(verdict: TaskTroubleVerdict): string | null {
	if (!verdict.trouble || verdict.kind === "silent") {
		return null;
	}
	if (verdict.kind === "hard_stuck") {
		return (
			"!Klein progress check: your recent attempts keep failing the same way across different approaches — do not keep grinding. " +
			"Simplify: pick the SMALLEST version of the task you can complete correctly, finish it, and state explicitly what you could not do and why. " +
			"A partial, honest result beats another failed full attempt."
		);
	}
	return (
		"!Klein progress check: your last several attempts made no measurable forward progress (no new files changed, no checks passing, the same tool calls repeating). " +
		"Change the approach now: re-read the task's acceptance criteria, pick the one next concrete step that moves a check from failing to passing, and do only that. " +
		"Do not repeat the reads or commands you have already run."
	);
}
