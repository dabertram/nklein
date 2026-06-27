import { describe, expect, it } from "vitest";
import {
	applyWorkflowCommand,
	isTerminalWorkflowPhase,
	type WorkflowCommand,
	type WorkflowPhase,
} from "../../../src/core/workflow-kernel";

/** Drive a sequence of commands from `idle`, returning the final phase + the flat list of effect kinds. */
function run(commands: WorkflowCommand["kind"][]): { phase: WorkflowPhase; effects: string[] } {
	let phase: WorkflowPhase = "idle";
	const effects: string[] = [];
	for (const kind of commands) {
		const transition = applyWorkflowCommand(phase, { kind } as WorkflowCommand);
		phase = transition.phase;
		effects.push(...transition.effects.map((effect) => effect.kind));
	}
	return { phase, effects };
}

const HAPPY_PATH: WorkflowCommand["kind"][] = [
	"start_requested",
	"board_capacity_granted",
	"endpoint_granted",
	"sandbox_granted",
	"begin_implementation",
	"implementation_finished",
	"acceptance_passed",
	"review_started",
	"review_passed",
	"delivery_requested",
	"delivered",
];

describe("applyWorkflowCommand", () => {
	it("drives the full happy path idle → completed with the right effects in order", () => {
		const { phase, effects } = run(HAPPY_PATH);
		expect(phase).toBe<WorkflowPhase>("completed");
		expect(effects).toEqual([
			"enqueue", // board_capacity
			"enqueue", // endpoint
			"enqueue", // sandbox
			"start_session",
			"run_acceptance",
			"request_review",
			"capture_result_branch",
			"mark_done",
		]);
	});

	it("walks the queue ladder in order (board capacity → endpoint → sandbox → planning)", () => {
		expect(run(["start_requested"]).phase).toBe("queued_for_board_capacity");
		expect(run(["start_requested", "board_capacity_granted"]).phase).toBe("queued_for_endpoint");
		expect(run(["start_requested", "board_capacity_granted", "endpoint_granted"]).phase).toBe("queued_for_sandbox");
		expect(run(["start_requested", "board_capacity_granted", "endpoint_granted", "sandbox_granted"]).phase).toBe(
			"planning",
		);
	});

	it("emits start_session when the sandbox is granted (planning begins)", () => {
		const transition = applyWorkflowCommand("queued_for_sandbox", { kind: "sandbox_granted" });
		expect(transition).toEqual({ phase: "planning", effects: [{ kind: "start_session" }] });
	});

	it("bounces a failed acceptance back to implementing", () => {
		expect(applyWorkflowCommand("awaiting_acceptance", { kind: "acceptance_failed" }).phase).toBe("implementing");
	});

	it("bounces a review change-request back to implementing", () => {
		expect(applyWorkflowCommand("reviewing", { kind: "review_changes_requested" }).phase).toBe("implementing");
	});

	it("honors cancel from any active phase, releasing resources", () => {
		for (const phase of ["queued_for_endpoint", "planning", "implementing", "reviewing"] as WorkflowPhase[]) {
			expect(applyWorkflowCommand(phase, { kind: "cancel_requested" })).toEqual({
				phase: "cancelled",
				effects: [{ kind: "release_resources" }],
			});
		}
	});

	it("honors failure from any active phase, releasing resources", () => {
		expect(applyWorkflowCommand("implementing", { kind: "failed" })).toEqual({
			phase: "failed",
			effects: [{ kind: "release_resources" }],
		});
	});

	it("is a no-op (holds the phase, no effects) for an unexpected command", () => {
		expect(applyWorkflowCommand("planning", { kind: "delivered" })).toEqual({ phase: "planning", effects: [] });
		expect(applyWorkflowCommand("idle", { kind: "review_passed" })).toEqual({ phase: "idle", effects: [] });
	});

	it("treats terminal phases as absorbing — every command is a no-op", () => {
		for (const phase of ["completed", "failed", "cancelled"] as WorkflowPhase[]) {
			expect(isTerminalWorkflowPhase(phase)).toBe(true);
			expect(applyWorkflowCommand(phase, { kind: "cancel_requested" })).toEqual({ phase, effects: [] });
			expect(applyWorkflowCommand(phase, { kind: "start_requested" })).toEqual({ phase, effects: [] });
		}
	});

	it("is safe to replay a duplicate command (idempotent hold once advanced)", () => {
		// sandbox_granted advances to planning; a second one in `planning` is a no-op hold.
		const first = applyWorkflowCommand("queued_for_sandbox", { kind: "sandbox_granted" });
		expect(first.phase).toBe("planning");
		expect(applyWorkflowCommand(first.phase, { kind: "sandbox_granted" })).toEqual({
			phase: "planning",
			effects: [],
		});
	});
});
