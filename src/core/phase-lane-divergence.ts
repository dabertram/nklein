/**
 * Phase↔lane divergence assessment — P24.1 step 1's SHADOW CHECK, pure.
 *
 * Step 1 ("one writer": lane becomes a projection of kernel phase) is the highest-blast-radius change in the
 * system, so authority does not move first — MEASUREMENT does. This assesses one card: does the board lane
 * equal the projection of the kernel phase? The wire samples every card on each board-liveness tick and
 * records one observation per novel divergence, which yields, on real traffic:
 *
 *   - the MIGRATION WORK LIST: each distinct (phase, lane) divergence pair is a writer that mutates the board
 *     without informing the kernel — exactly the call sites step 1 must convert to commands;
 *   - the SAFETY BASELINE: migration is done when this records nothing, and a later regression (a new bypassing
 *     writer) shows up here instead of as the next N20-class silent disagreement.
 *
 * Two divergence kinds, because they demand different fixes:
 *   - `unknown_to_kernel` — the kernel has NO phase (idle default) for a card whose lane says work happened.
 *     The writer never dispatched ANY command; the fix is adding dispatches (the common case pre-migration).
 *   - `projection_mismatch` — the kernel HAS a phase but the lane disagrees with its projection. Either a
 *     bypassing mutation moved the card, or the projection table itself is wrong for a real flow — both are
 *     exactly what the shadow phase exists to surface before authority transfers.
 *
 * `idle`+`backlog` and `idle`+terminal lanes are NOT divergences: a card the kernel never tracked that sits
 * where untracked cards legitimately sit (never started, or archived by an operator) proves nothing.
 */

import { workflowPhaseToBoardColumn } from "./workflow-board-bridge";
import type { WorkflowPhase } from "./workflow-kernel";

export interface PhaseLaneDivergence {
	readonly kind: "unknown_to_kernel" | "projection_mismatch";
	readonly taskId: string;
	readonly phase: WorkflowPhase;
	readonly lane: string;
	readonly projectedLane: string;
}

/** Lanes where an idle-(untracked)-phase card is unremarkable. */
const IDLE_COMPATIBLE_LANES: ReadonlySet<string> = new Set(["backlog", "completed", "trash"]);

/**
 * Decision 3 (David 2026-08-04, "show both"): during a REDRIVE the lane deliberately stays put while the
 * phase replays the admission ladder — these are the phases that ladder walks (reopened lands on idle, then
 * queued_* → planning), and the lanes a redriven card legitimately holds meanwhile. A divergence matching
 * this shape while the queue says a redrive is in flight is EXPECTED, not a bypassing writer; everything
 * else stays flagged (a redrive that somehow reaches implementing with the lane still elsewhere is real).
 */
const REDRIVE_WINDOW_PHASES: ReadonlySet<WorkflowPhase> = new Set([
	"idle",
	"queued_for_board_capacity",
	"queued_for_endpoint",
	"queued_for_sandbox",
	"planning",
]);
const REDRIVE_HOLD_LANES: ReadonlySet<string> = new Set(["review", "in_progress"]);

export function assessPhaseLaneDivergence(input: {
	readonly taskId: string;
	readonly phase: WorkflowPhase;
	readonly lane: string;
	/** The queue's redrive-window flag (`redriveInFlightOf`) — false/absent outside a redrive. */
	readonly redriveInFlight?: boolean;
}): PhaseLaneDivergence | null {
	if (input.redriveInFlight && REDRIVE_WINDOW_PHASES.has(input.phase) && REDRIVE_HOLD_LANES.has(input.lane)) {
		return null;
	}
	const projectedLane = workflowPhaseToBoardColumn(input.phase);
	if (input.phase === "idle") {
		if (IDLE_COMPATIBLE_LANES.has(input.lane)) {
			return null;
		}
		return {
			kind: "unknown_to_kernel",
			taskId: input.taskId,
			phase: input.phase,
			lane: input.lane,
			projectedLane,
		};
	}
	if (input.lane === projectedLane) {
		return null;
	}
	return {
		kind: "projection_mismatch",
		taskId: input.taskId,
		phase: input.phase,
		lane: input.lane,
		projectedLane,
	};
}

/** Stable dedup key: one observation per novel (card, phase, lane) triple — repeat ticks add nothing. */
export function phaseLaneDivergenceKey(divergence: PhaseLaneDivergence): string {
	return `${divergence.taskId}:${divergence.phase}:${divergence.lane}`;
}

/** The single telemetry category for the shadow check (registered in MECHANISM_REGISTRY, P24.1). */
export const PHASE_LANE_DIVERGENCE_CATEGORY = "phase_lane_divergence";

export function buildPhaseLaneDivergenceObservation(divergence: PhaseLaneDivergence): {
	signal: "custom";
	severity: "info";
	message: string;
	taskId: string;
	metadata: {
		category: typeof PHASE_LANE_DIVERGENCE_CATEGORY;
		kind: PhaseLaneDivergence["kind"];
		phase: WorkflowPhase;
		lane: string;
		projectedLane: string;
	};
} {
	return {
		signal: "custom",
		severity: "info",
		message:
			divergence.kind === "unknown_to_kernel"
				? `Phase/lane shadow: ${divergence.taskId} sits in "${divergence.lane}" but the kernel never heard of it — a writer moved it without dispatching any command.`
				: `Phase/lane shadow: ${divergence.taskId} is "${divergence.phase}" (projects to "${divergence.projectedLane}") but the board says "${divergence.lane}".`,
		taskId: divergence.taskId,
		metadata: {
			category: PHASE_LANE_DIVERGENCE_CATEGORY,
			kind: divergence.kind,
			phase: divergence.phase,
			lane: divergence.lane,
			projectedLane: divergence.projectedLane,
		},
	};
}
