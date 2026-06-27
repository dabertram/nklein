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
		// Actively working or verifying acceptance.
		case "implementing":
		case "awaiting_acceptance":
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
