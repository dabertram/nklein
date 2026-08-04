import { describe, expect, it } from "vitest";
import {
	assessPhaseLaneDivergence,
	buildPhaseLaneDivergenceObservation,
	phaseLaneDivergenceKey,
} from "../../../src/core/phase-lane-divergence";
import { workflowPhaseToBoardColumn } from "../../../src/core/workflow-board-bridge";
import { ALL_WORKFLOW_PHASES } from "../../../src/core/workflow-kernel";

/**
 * P24.1 step-1 shadow — the read-only measurement that precedes any authority transfer. The properties that
 * matter: agreement is silent, untracked cards are only remarkable in lanes that imply work happened, and the
 * dedup key collapses repeat ticks.
 */

describe("assessPhaseLaneDivergence", () => {
	it("is SILENT when the lane equals the projection — for every phase", () => {
		for (const phase of ALL_WORKFLOW_PHASES) {
			const lane = workflowPhaseToBoardColumn(phase);
			expect(assessPhaseLaneDivergence({ taskId: "t", phase, lane }), `${phase} in its own lane`).toBeNull();
		}
	});

	it("treats idle+backlog/completed/trash as unremarkable — untracked where untracked belongs", () => {
		for (const lane of ["backlog", "completed", "trash"]) {
			expect(assessPhaseLaneDivergence({ taskId: "t", phase: "idle", lane })).toBeNull();
		}
	});

	it("flags idle in a WORK lane as unknown_to_kernel — a writer that never dispatched", () => {
		const divergence = assessPhaseLaneDivergence({ taskId: "t", phase: "idle", lane: "in_progress" });
		expect(divergence?.kind).toBe("unknown_to_kernel");
	});

	it("flags a tracked phase in the wrong lane as projection_mismatch", () => {
		const divergence = assessPhaseLaneDivergence({ taskId: "t", phase: "implementing", lane: "review" });
		expect(divergence?.kind).toBe("projection_mismatch");
		expect(divergence?.projectedLane).toBe("in_progress");
	});

	it("dedup key collapses repeat observations of the same triple", () => {
		const a = assessPhaseLaneDivergence({ taskId: "t", phase: "implementing", lane: "review" });
		const b = assessPhaseLaneDivergence({ taskId: "t", phase: "implementing", lane: "review" });
		expect(a && phaseLaneDivergenceKey(a)).toBe(b && phaseLaneDivergenceKey(b));
	});

	it("builds an observation carrying the full triple under the registered category", () => {
		const divergence = assessPhaseLaneDivergence({ taskId: "t9", phase: "reviewing", lane: "in_progress" });
		const observation = divergence && buildPhaseLaneDivergenceObservation(divergence);
		expect(observation?.metadata.category).toBe("phase_lane_divergence");
		expect(observation?.metadata.phase).toBe("reviewing");
		expect(observation?.metadata.projectedLane).toBe("review");
		expect(observation?.taskId).toBe("t9");
	});
});

describe("redrive-window tolerance (decision 3, 2026-08-04)", () => {
	it("suppresses the expected ladder-replay divergences while a redrive is in flight", () => {
		// The lane deliberately HOLDS (review / in_progress) while the phase replays the admission ladder —
		// with the queue's redrive flag set, none of these are bypassing writers.
		for (const phase of ["idle", "queued_for_board_capacity", "queued_for_endpoint", "planning"] as const) {
			for (const lane of ["review", "in_progress"]) {
				expect(assessPhaseLaneDivergence({ taskId: "t", phase, lane, redriveInFlight: true })).toBeNull();
			}
		}
	});

	it("keeps flagging the same shapes when NO redrive is in flight — the tolerance is not a blanket pass", () => {
		expect(assessPhaseLaneDivergence({ taskId: "t", phase: "idle", lane: "review" })?.kind).toBe("unknown_to_kernel");
		expect(
			assessPhaseLaneDivergence({ taskId: "t", phase: "planning", lane: "review", redriveInFlight: false })?.kind,
		).toBe("projection_mismatch");
	});

	it("keeps flagging shapes OUTSIDE the window even mid-redrive (wrong lane, or a phase past the ladder)", () => {
		// A redriven card sitting in backlog is not a legitimate hold — the ladder never parks there.
		expect(
			assessPhaseLaneDivergence({ taskId: "t", phase: "planning", lane: "backlog", redriveInFlight: true }),
		).not.toBeNull();
		// implementing disagrees with review even mid-redrive: begin_implementation should have closed the window.
		expect(
			assessPhaseLaneDivergence({ taskId: "t", phase: "implementing", lane: "review", redriveInFlight: true }),
		).not.toBeNull();
	});
});
