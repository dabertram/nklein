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
