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
		case "queued_for_sandbox":
		case "planning":
			return "planning";
		// DATA-INFORMED ROW (P24.1 second inventory, 2026-08-03): the product deliberately parks a dep-free
		// card waiting on an endpoint in the READY lane ("dep-free but no slot ⇒ show in Ready", todo 11116) —
		// the queue-visible lane. Board-capacity/sandbox waits stay in planning (no product lane exists for
		// them); the projection matches the flow the product actually has.
		case "queued_for_endpoint":
			return "ready";
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

/**
 * P24.1 step 1, first one-writer increment: which applied kernel transitions DRIVE a board lane move.
 *
 * The kernel becomes the single writer for lane moves EDGE-BY-EDGE — an allowlist, not a blanket, so each
 * conversion's blast radius is one edge and the shadow verifies it before the next joins. The first converted
 * edge is `implementation_finished` (the transient review-entry window: the summary-edge listener dispatched
 * the phase while a separate finalize path moved the lane — two async writers racing every sampler; deriving
 * the move FROM the applied transition makes phase and lane change from one cause). Legacy direct
 * `moveTaskToColumn` calls on a converted edge become redundant (same destination, idempotent move) and are
 * retired once the shadow stays silent for the pair.
 */
const KERNEL_DRIVEN_LANE_COMMANDS: ReadonlySet<string> = new Set([
	"implementation_finished",
	// Conversion 2 (fourth inventory, 2026-08-03): the started-card window — lane moved to in_progress while
	// begin_implementation was still in flight. Same anatomy as conversion 1, same cure.
	"begin_implementation",
]);

/** The lane an applied transition should move the card to, or null when the edge is not (yet) converted. */
export function laneMoveForAppliedTransition(transition: {
	readonly command: { readonly kind: string };
	readonly phase: WorkflowPhase;
}): RuntimeBoardColumnId | null {
	if (!KERNEL_DRIVEN_LANE_COMMANDS.has(transition.command.kind)) {
		return null;
	}
	return workflowPhaseToBoardColumn(transition.phase);
}
