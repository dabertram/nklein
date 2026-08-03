import { describe, expect, it } from "vitest";
import type { RuntimeBoardColumnId } from "../../../src/core/runtime-config-api-contract";
import { laneMoveForAppliedTransition, workflowPhaseToBoardColumn } from "../../../src/core/workflow-board-bridge";
import {
	classifyWorkflowPhase,
	isLiveWorkflowPhase,
	isTerminalWorkflowPhase,
	type WorkflowPhase,
} from "../../../src/core/workflow-kernel";

const EXPECTED: Record<WorkflowPhase, RuntimeBoardColumnId> = {
	idle: "backlog",
	queued_for_board_capacity: "planning",
	// Data-informed row (P24.1 second inventory): endpoint-queued dep-free cards park in Ready by design.
	queued_for_endpoint: "ready",
	queued_for_sandbox: "planning",
	planning: "planning",
	implementing: "in_progress",
	// Data-informed row (P24.1 first inventory): acceptance verifies in the Review lane in the real flow.
	awaiting_acceptance: "review",
	paused: "in_progress",
	awaiting_review: "review",
	reviewing: "review",
	ready_for_delivery: "review",
	delivering: "review",
	completed: "completed",
	failed: "in_progress",
	cancelled: "trash",
};

describe("workflowPhaseToBoardColumn", () => {
	it("maps every workflow phase to the expected board column", () => {
		for (const [phase, column] of Object.entries(EXPECTED) as [WorkflowPhase, RuntimeBoardColumnId][]) {
			expect(workflowPhaseToBoardColumn(phase)).toBe(column);
		}
	});

	it("groups the pre-implementation phases into Planning — except the deliberate Ready park", () => {
		for (const phase of ["queued_for_board_capacity", "queued_for_sandbox", "planning"] as WorkflowPhase[]) {
			expect(workflowPhaseToBoardColumn(phase)).toBe("planning");
		}
		// Data-informed row (P24.1 second inventory): a dep-free card waiting on an ENDPOINT parks in the
		// Ready lane by product design (todo 11116) — the queue-visible lane, not hidden inside Planning.
		expect(workflowPhaseToBoardColumn("queued_for_endpoint")).toBe("ready");
	});

	it("surfaces the whole review→delivery span in the Review lane", () => {
		for (const phase of ["awaiting_review", "reviewing", "ready_for_delivery", "delivering"] as WorkflowPhase[]) {
			expect(workflowPhaseToBoardColumn(phase)).toBe("review");
		}
	});

	it("maps terminal completed/cancelled to their lanes and parks failed in progress", () => {
		expect(workflowPhaseToBoardColumn("completed")).toBe("completed");
		expect(workflowPhaseToBoardColumn("cancelled")).toBe("trash");
		expect(workflowPhaseToBoardColumn("failed")).toBe("in_progress");
	});
});

/**
 * P24.1 — CROSS-INVARIANTS between the kernel's classification and this projection.
 *
 * The table above is example-based: it asserts each mapping is what someone wrote down, which is true by
 * construction and cannot catch a mapping that is internally INCONSISTENT with what the phase means. That is the
 * method that let six liveness defects through, so these check the relationship instead of the entries.
 *
 * `EXPECTED` is reused deliberately as the phase enumeration: `Record<WorkflowPhase, …>` is exhaustive by type,
 * so a newly added phase fails to compile here until it is both mapped AND classified.
 */
describe("phase classification agrees with the board projection", () => {
	const ALL_PHASES = Object.keys(EXPECTED) as WorkflowPhase[];

	it("NO live phase surfaces in a terminal column — the ghost-session class, pinned", () => {
		// THE v14 DEFECT, stated structurally: a session was live (`awaiting_review`) while its card sat in the
		// `completed` lane. The board said done, the runtime kept driving it, and the two disagreeing produced a
		// livelock that took a real drain down. A card the runtime still owes work to must never READ as settled.
		for (const phase of ALL_PHASES.filter(isLiveWorkflowPhase)) {
			const column = workflowPhaseToBoardColumn(phase);
			expect(
				["completed", "trash"].includes(column),
				`${phase} is live but surfaces in "${column}" — the board would show it settled while work continues`,
			).toBe(false);
		}
	});

	it("a card reads as COMPLETED only when it genuinely is", () => {
		// The converse direction. If any non-completed phase projected to the completed column, delivery could be
		// re-driven against an already-delivered branch (and `reopened` deliberately refuses to reopen `completed`,
		// so such a card would also be unrecoverable).
		for (const phase of ALL_PHASES) {
			expect(workflowPhaseToBoardColumn(phase) === "completed", `${phase} projects to the completed column`).toBe(
				phase === "completed",
			);
		}
	});

	it("documents the ONE deliberate divergence: a failed card is parked where the work was", () => {
		// `failed` is terminal to the kernel but shows in `in_progress`, because the operator needs to SEE it rather
		// than have it vanish into trash (§5.AG marks it stuck/risky). Left unstated this looks exactly like the
		// classification/projection drift the tests above forbid, so it is pinned as intentional — and it is safe
		// precisely because `failed` is NOT live, so no scheduler will re-drive it off the lane alone.
		expect(isTerminalWorkflowPhase("failed")).toBe(true);
		expect(isLiveWorkflowPhase("failed")).toBe(false);
		expect(workflowPhaseToBoardColumn("failed")).toBe("in_progress");
	});

	it("every waiting-for-capacity phase surfaces as WAITING (planning or ready), never as in-progress work", () => {
		// A card queued behind host capacity is not "in progress" — showing it there is what makes an operator (or a
		// staleness monitor) conclude a worker is hung when nothing has started yet. Planning and Ready are both
		// honest waiting lanes; in_progress is the lie this invariant forbids.
		for (const phase of ALL_PHASES.filter((candidate) => classifyWorkflowPhase(candidate) === "waiting_capacity")) {
			expect(["planning", "ready"], `${phase} should surface as a waiting lane`).toContain(
				workflowPhaseToBoardColumn(phase),
			);
		}
	});
});

describe("laneMoveForAppliedTransition (P24.1 one-writer increment, edge allowlist)", () => {
	it("drives the lane on the converted implementation_finished edge, from the applied phase", () => {
		expect(
			laneMoveForAppliedTransition({ command: { kind: "implementation_finished" }, phase: "awaiting_acceptance" }),
		).toBe("review");
	});

	it("returns null for every unconverted edge — blast radius stays one edge per conversion", () => {
		for (const kind of ["start_requested", "review_started", "review_changes_requested", "delivered", "failed"]) {
			expect(laneMoveForAppliedTransition({ command: { kind }, phase: "implementing" })).toBeNull();
		}
	});
});

describe("conversion 2: begin_implementation drives the in_progress move", () => {
	it("moves the card to in_progress from the applied implementing phase", () => {
		expect(laneMoveForAppliedTransition({ command: { kind: "begin_implementation" }, phase: "implementing" })).toBe(
			"in_progress",
		);
	});
});
