import { describe, expect, it, vi } from "vitest";
import { type AgentLedgerEvent, agentLedgerEventSchema } from "../../../src/core/agent-attempt-ledger";
import {
	createWorkflowCommandQueue,
	replayWorkflowPhaseFromLedger,
	type WorkflowQueueTransition,
} from "../../../src/core/workflow-command-queue";

/**
 * F1.27 — the workflow-kernel/durable-queue seam: typed dispatch over the pure reducer, held/terminal rejections,
 * persist-before-notify durability, subscriber events with kernel effects, and exact boot replay from the ledger.
 */

function makeQueue(over: Partial<Parameters<typeof createWorkflowCommandQueue>[0]> = {}) {
	const appended: AgentLedgerEvent[] = [];
	const queue = createWorkflowCommandQueue({
		workflowId: "run-1",
		workspacePathHash: "hash",
		appendEvent: async (event) => {
			appended.push(event);
		},
		now: () => 1_000,
		...over,
	});
	return { queue, appended };
}

describe("createWorkflowCommandQueue", () => {
	it("drives a full lifecycle through the reducer, emitting effects and persisting every applied command", async () => {
		const { queue, appended } = makeQueue();
		const seen: WorkflowQueueTransition[] = [];
		queue.subscribe((transition) => seen.push(transition));

		const started = await queue.dispatch("t-1", { kind: "start_requested" });
		expect(started).toMatchObject({ applied: true });
		expect(queue.phaseOf("t-1")).toBe("queued_for_board_capacity");

		for (const kind of [
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
		] as const) {
			const outcome = await queue.dispatch("t-1", { kind });
			expect(outcome.applied, kind).toBe(true);
		}
		expect(queue.phaseOf("t-1")).toBe("completed");
		// The sandbox grant carries the kernel's start_session effect to subscribers.
		const sandboxGrant = seen.find((transition) => transition.command.kind === "sandbox_granted");
		expect(sandboxGrant?.effects).toEqual([{ kind: "start_session" }]);
		// Every applied command persisted as a schema-valid wf:* → wf:* transition (11 total).
		expect(appended).toHaveLength(11);
		expect(appended.every((event) => agentLedgerEventSchema.safeParse(event).success)).toBe(true);
		expect(appended[0]).toMatchObject({ from: "wf:idle", to: "wf:queued_for_board_capacity" });
	});

	it("HOLDS a duplicate/out-of-order command (no persist, no event) and rejects commands to a terminal task", async () => {
		const { queue, appended } = makeQueue();
		const seen: WorkflowQueueTransition[] = [];
		queue.subscribe((transition) => seen.push(transition));

		await queue.dispatch("t-1", { kind: "start_requested" });
		const duplicate = await queue.dispatch("t-1", { kind: "start_requested" }); // already queued
		expect(duplicate).toEqual({ applied: false, phase: "queued_for_board_capacity", reason: "held" });
		const outOfOrder = await queue.dispatch("t-1", { kind: "review_passed" }); // nowhere near review
		expect(outOfOrder).toMatchObject({ applied: false, reason: "held" });
		expect(appended).toHaveLength(1);
		expect(seen).toHaveLength(1);

		await queue.dispatch("t-1", { kind: "cancel_requested" });
		expect(queue.phaseOf("t-1")).toBe("cancelled");
		const afterTerminal = await queue.dispatch("t-1", { kind: "start_requested" });
		expect(afterTerminal).toEqual({ applied: false, phase: "cancelled", reason: "terminal" });
	});

	it("persists BEFORE notifying subscribers; an append failure means no state change and no event", async () => {
		const appendEvent = vi.fn(async () => {
			throw new Error("disk full");
		});
		const queue = createWorkflowCommandQueue({
			workflowId: "run-1",
			workspacePathHash: "hash",
			appendEvent,
			now: () => 1_000,
		});
		const seen: WorkflowQueueTransition[] = [];
		queue.subscribe((transition) => seen.push(transition));
		await expect(queue.dispatch("t-1", { kind: "start_requested" })).resolves.toEqual({
			applied: false,
			phase: "idle",
			reason: "persist_failed",
		});
		// No state leaked and no subscriber saw a transition that was never durably recorded.
		expect(queue.phaseOf("t-1")).toBe("idle");
		expect(seen).toEqual([]);
	});

	it("replays the persisted log back to the exact phase (boot resume) and seeds a new queue with it", async () => {
		const { queue, appended } = makeQueue();
		await queue.dispatch("t-1", { kind: "start_requested" });
		await queue.dispatch("t-1", { kind: "board_capacity_granted" });
		await queue.dispatch("t-2", { kind: "start_requested" });

		expect(replayWorkflowPhaseFromLedger(appended, "t-1")).toBe("queued_for_endpoint");
		expect(replayWorkflowPhaseFromLedger(appended, "t-2")).toBe("queued_for_board_capacity");
		expect(replayWorkflowPhaseFromLedger(appended, "t-never")).toBe("idle");

		const resumed = createWorkflowCommandQueue({
			workflowId: "run-1",
			workspacePathHash: "hash",
			seedPhases: new Map([["t-1", replayWorkflowPhaseFromLedger(appended, "t-1")]]),
		});
		expect(resumed.phaseOf("t-1")).toBe("queued_for_endpoint");
		const next = await resumed.dispatch("t-1", { kind: "endpoint_granted" });
		expect(next).toMatchObject({ applied: true });
		expect(resumed.phaseOf("t-1")).toBe("queued_for_sandbox");
	});
});
