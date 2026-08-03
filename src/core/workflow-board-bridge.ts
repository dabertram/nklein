// §5.AF bridge: map a workflow phase (the kernel's finer-grained scheduler view) to the board column it surfaces as,
// so the future durable scheduler can keep the board — the user's view — in sync with the kernel's phase. Pure. This is
// the canonical phase→column direction ONLY; the reverse is lossy (a board column can't recover which queue/review
// sub-phase a task is in). The board mutation helpers (`task-board-mutations`, §5.B lane reconcile) remain the single
// source of truth for actual lane moves — this only says where a given phase *belongs*.
import type { RuntimeBoardColumnId } from "./runtime-config-api-contract";
import type { WorkflowPhase } from "./workflow-kernel";

export function workflowPhaseToBoardColumn(phase: WorkflowPhase): RuntimeBoardColumnId {
	switch (phase) {
		case "idle":
			return "backlog";
		// Started but pre-implementation (queued for resources, or refining) — the §5.B Planning/Refinement lane.
		case "queued_for_board_capacity":
		case "queued_for_endpoint":
		case "queued_for_sandbox":
		case "planning":
			return "planning";
		// Actively working.
		case "implementing":
			return "in_progress";
		// DATA-INFORMED ROW CHANGE (P24.1 shadow, first inventory 2026-08-03): the REAL flow parks
		// acceptance-phase cards in the Review lane — the terminal hook moves the board to `review` at turn
		// end, and acceptance verification runs there as the review pipeline's first step (live drains show
		// `review-phase: acceptance-verify` under the review lane). Projecting to `in_progress` made every
		// healthy review entry read as a divergence; the projection now matches the flow the product actually
		// has, and the shadow verifies it stays matched.
		case "awaiting_acceptance":
			return "review";
		// A deliberately held card stays WHERE THE WORK IS, for the same reason `failed` does: the operator needs
		// to see it. Moving it to its own lane would hide a card someone paused and meant to come back to.
		case "paused":
			return "in_progress";
		// In or past review (review → delivery all surface in the Review lane until merged).
		case "awaiting_review":
		case "reviewing":
		case "ready_for_delivery":
		case "delivering":
			return "review";
		case "completed":
			return "completed";
		case "cancelled":
			return "trash";
		// A failed task is parked where the work was, for operator attention (§5.AG marks it stuck/risky).
		case "failed":
			return "in_progress";
	}
}
