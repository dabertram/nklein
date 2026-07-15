import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import {
	buildAttemptProgressSnapshotsFromLedger,
	buildStucknessSignalsFromLedger,
} from "../core/agent-ledger-projections";
import { classifyAgentStuckness } from "../core/agent-stuckness";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { consecutiveNoProgressAttempts } from "../core/attempt-progress-tracker";
import { detectProcessRemediation, type RemediationFinding } from "../core/process-remediation";
import { buildProcessTrajectoryFromLedger } from "../core/process-remediation-ledger";
import { assessRunLiveness, type RunLivenessThresholds } from "../core/run-attention-signals";
import { deriveLivenessThresholds, type SpeedAwareLivenessInput } from "../core/speed-aware-liveness";
import { assessTaskTrouble, type TaskTroubleVerdict } from "../core/task-trouble-signal";

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
	 * F3.19 — when supplied, DERIVE power- + speed-aware thresholds from the running model's measured throughput +
	 * task shape (the caller builds this from the ledger's tok/s, the card difficulty, and the host power mode), so a
	 * slow-but-working local model in low power isn't falsely flagged. Absent ⇒ the generous fixed base (byte-identical).
	 */
	speedContext?: Omit<SpeedAwareLivenessInput, "base">;
}

/** Evaluate the unified trouble verdict for one RUNNING task from the ledger + its session summary. */
export function evaluateRunningTaskTrouble(input: RunningTaskTroubleInput): TaskTroubleVerdict {
	const { events, summary } = input;
	const thresholds =
		input.thresholds ??
		(input.speedContext
			? deriveLivenessThresholds({ ...input.speedContext, base: RUNNING_TASK_TROUBLE_LIVENESS_THRESHOLDS })
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
