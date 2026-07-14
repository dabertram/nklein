/**
 * Process Remediation Model (pure) — ported from opencode-swarm's PRM and adapted to complement (not duplicate)
 * !Klein's existing per-card watchdog. `task-trouble-monitor.ts` (F1.10) already catches the SINGLE-agent trajectory
 * faults — repetition, no-progress/stuck, silence — from the ledger. PRM adds the three MULTI-STEP / MULTI-AGENT
 * patterns that a single-card liveness check can't see:
 *
 *  - `ping_pong`       — two agents hand a card back and forth without the artifact advancing (no diff between hops).
 *  - `expansion_drift` — the plan's task count keeps growing past its original scope mid-execution (scope creep).
 *  - `context_thrash`  — each step requests a strictly larger file set than the last (the agent is flailing for context).
 *
 * Pure + deterministic: the caller projects a {@link ProcessTrajectory} from the ledger/session state and hands it in;
 * this returns escalation-graded findings. Escalation mirrors PRM: L1 advisory (nudge), L2 alert (surface to operator),
 * L3 hard-stop (park the card). The effectful b-leaf maps an L3 finding to the existing park/steer machinery.
 */

export type RemediationPattern = "ping_pong" | "expansion_drift" | "context_thrash";

/** L1 advisory guidance · L2 operator alert · L3 hard stop (park). Higher = more severe. */
export type RemediationLevel = 1 | 2 | 3;

/** One step of an execution trajectory (projected from the ledger). */
export interface TrajectoryStep {
	/** Which agent/role acted (e.g. "coder", "reviewer") — drives ping-pong detection. */
	readonly agent: string;
	/** Whether the artifact advanced on this step (a diff landed / state changed). No-progress hops feed ping-pong. */
	readonly madeProgress: boolean;
	/** Distinct files this step requested/read — a growing set across steps feeds context-thrash. */
	readonly filesRequested: readonly string[];
}

export interface ProcessTrajectory {
	readonly steps: readonly TrajectoryStep[];
	/** The plan's task count when execution started (the scope baseline). */
	readonly initialPlanTaskCount: number;
	/** The plan's task count now (growth past the baseline feeds expansion-drift). */
	readonly currentPlanTaskCount: number;
}

export interface RemediationThresholds {
	/** Consecutive no-progress A↔B hand-offs before ping-pong fires (default 4 — two full round-trips). */
	readonly pingPongHops: number;
	/** Task-count growth over the baseline before expansion-drift fires (default 3 new tasks). */
	readonly expansionDriftTasks: number;
	/** Consecutive strictly-growing file-request steps before context-thrash fires (default 3). */
	readonly contextThrashSteps: number;
}

export const DEFAULT_REMEDIATION_THRESHOLDS: RemediationThresholds = {
	pingPongHops: 4,
	expansionDriftTasks: 3,
	contextThrashSteps: 3,
};

export interface RemediationFinding {
	readonly pattern: RemediationPattern;
	readonly level: RemediationLevel;
	readonly detail: string;
}

/**
 * The longest run (ending at the last step) of no-progress hops that strictly alternate between two agents. A genuine
 * A→B→A→B with nothing landing is the ping-pong signature; a same-agent repeat or any progress breaks the run.
 */
function longestPingPongRun(steps: readonly TrajectoryStep[]): number {
	let run = 0;
	for (let i = steps.length - 1; i >= 0; i -= 1) {
		const step = steps[i];
		if (step.madeProgress) {
			break;
		}
		if (i < steps.length - 1) {
			// The step just after must be a DIFFERENT agent (alternating), else the ping-pong chain is broken.
			if (steps[i + 1].agent === step.agent) {
				break;
			}
		}
		run += 1;
	}
	// A run of 1 is just one idle hop, not a ping-pong; require ≥2 to count as alternation.
	return run >= 2 ? run : 0;
}

/** The longest run (ending at the last step) where each step's file-request set is a strict superset of the previous. */
function longestGrowingContextRun(steps: readonly TrajectoryStep[]): number {
	let run = 1;
	let best = 1;
	for (let i = 1; i < steps.length; i += 1) {
		const prev = new Set(steps[i - 1].filesRequested);
		const curr = steps[i].filesRequested;
		const isStrictSuperset = curr.length > prev.size && [...prev].every((file) => curr.includes(file));
		if (isStrictSuperset) {
			run += 1;
			best = Math.max(best, run);
		} else {
			run = 1;
		}
	}
	return steps.length === 0 ? 0 : best;
}

/** Grade a count against a threshold: below ⇒ none; at ⇒ L1; +50% ⇒ L2; double ⇒ L3. */
function gradeLevel(value: number, threshold: number): RemediationLevel | null {
	if (value < threshold) {
		return null;
	}
	if (value >= threshold * 2) {
		return 3;
	}
	if (value >= Math.ceil(threshold * 1.5)) {
		return 2;
	}
	return 1;
}

export function detectProcessRemediation(
	trajectory: ProcessTrajectory,
	thresholds: RemediationThresholds = DEFAULT_REMEDIATION_THRESHOLDS,
): RemediationFinding[] {
	const findings: RemediationFinding[] = [];

	const pingPong = longestPingPongRun(trajectory.steps);
	const pingPongLevel = gradeLevel(pingPong, thresholds.pingPongHops);
	if (pingPongLevel !== null) {
		findings.push({
			pattern: "ping_pong",
			level: pingPongLevel,
			detail: `${pingPong} no-progress hand-offs alternating between agents (threshold ${thresholds.pingPongHops}).`,
		});
	}

	const drift = Math.max(0, trajectory.currentPlanTaskCount - trajectory.initialPlanTaskCount);
	const driftLevel = gradeLevel(drift, thresholds.expansionDriftTasks);
	if (driftLevel !== null) {
		findings.push({
			pattern: "expansion_drift",
			level: driftLevel,
			detail: `Plan grew by ${drift} task(s) past the ${trajectory.initialPlanTaskCount}-task baseline (threshold ${thresholds.expansionDriftTasks}).`,
		});
	}

	const thrash = longestGrowingContextRun(trajectory.steps);
	const thrashLevel = gradeLevel(thrash, thresholds.contextThrashSteps);
	if (thrashLevel !== null) {
		findings.push({
			pattern: "context_thrash",
			level: thrashLevel,
			detail: `${thrash} consecutive steps each requested a strictly larger file set (threshold ${thresholds.contextThrashSteps}).`,
		});
	}

	return findings;
}

/** The single most-severe level across findings (null when clean) — the card's overall remediation posture. */
export function peakRemediationLevel(findings: readonly RemediationFinding[]): RemediationLevel | null {
	let peak: RemediationLevel | null = null;
	for (const finding of findings) {
		if (peak === null || finding.level > peak) {
			peak = finding.level;
		}
	}
	return peak;
}
