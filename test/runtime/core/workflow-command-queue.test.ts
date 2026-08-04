import { describe, expect, it, vi } from "vitest";
import { type AgentLedgerEvent, agentLedgerEventSchema } from "../../../src/core/agent-attempt-ledger";
import {
	createWorkflowCommandQueue,
	nextRedriveInFlight,
	replayWorkflowPhaseFromLedger,
	replayWorkflowRedriveFromLedger,
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
		queue.subscribe((transition) => {
			seen.push(transition);
		});

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
		queue.subscribe((transition) => {
			seen.push(transition);
		});

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
		queue.subscribe((transition) => {
			seen.push(transition);
		});
		await expect(queue.dispatch("t-1", { kind: "start_requested" })).resolves.toEqual({
			applied: false,
			phase: "idle",
			reason: "persist_failed",
		});
		// No state leaked and no subscriber saw a transition that was never durably recorded.
		expect(queue.phaseOf("t-1")).toBe("idle");
		expect(seen).toEqual([]);
	});

	it("F1.27b leaf 4: `reopened` re-admits failed/cancelled cards; completed never reopens; fresh cards hold", async () => {
		const { queue } = makeQueue();
		// Fail a mid-flight card, then reopen it — the admission ladder replays from idle.
		await queue.dispatch("t-1", { kind: "start_requested" });
		await queue.dispatch("t-1", { kind: "failed" });
		expect(queue.phaseOf("t-1")).toBe("failed");
		const reopened = await queue.dispatch("t-1", { kind: "reopened" });
		expect(reopened).toMatchObject({ applied: true });
		expect(queue.phaseOf("t-1")).toBe("idle");
		const restarted = await queue.dispatch("t-1", { kind: "start_requested" });
		expect(restarted).toMatchObject({ applied: true });
		// A fresh (idle) card's reopened holds silently — the start ladder's unconditional prefix is safe.
		const freshHold = await queue.dispatch("t-new", { kind: "reopened" });
		expect(freshHold).toMatchObject({ applied: false, reason: "held" });
		// Delivered work never reopens.
		const { queue: doneQueue } = makeQueue();
		for (const kind of [
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
		] as const) {
			await doneQueue.dispatch("t-done", { kind });
		}
		const noReopen = await doneQueue.dispatch("t-done", { kind: "reopened" });
		expect(noReopen).toEqual({ applied: false, phase: "completed", reason: "terminal" });
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

describe("async subscribers are FIRE-AND-FORGET (P24.1 step 3 reverted, 2026-08-04)", () => {
	it("dispatch does NOT wait for a slow subscriber projection — a held workspace lock cannot deadlock the chain", async () => {
		// Step 3 awaited projections inside the per-task chain; the first 42-card full nightly through that
		// code deadlocked 23 completions silently (a dispatch inside a workspace-state transaction waits on a
		// reconciler that waits on the same lock). Subscribers are decoupled again; the sampler race step 3
		// targeted is owned by the two-strike debounce.
		const { queue } = makeQueue();
		const order: string[] = [];
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		queue.subscribe(async (transition) => {
			order.push(`project:${transition.command.kind}:start`);
			await gate;
			order.push(`project:${transition.command.kind}:done`);
		});
		await queue.dispatch("t-9", { kind: "start_requested" });
		await queue.dispatch("t-9", { kind: "board_capacity_granted" });
		// Both commands applied while the projections still hang — the deadlock shape cannot form.
		expect(queue.phaseOf("t-9")).toBe("queued_for_endpoint");
		expect(order).toEqual(["project:start_requested:start", "project:board_capacity_granted:start"]);
		release();
	});

	it("a REJECTING subscriber never breaks the command path", async () => {
		const { queue } = makeQueue();
		queue.subscribe(async () => {
			throw new Error("projection failed");
		});
		const outcome = await queue.dispatch("t-10", { kind: "start_requested" });
		expect(outcome.applied).toBe(true);
		expect(queue.phaseOf("t-10")).toBe("queued_for_board_capacity");
	});
});

describe("redrive window (decision 3, 2026-08-04): reopened→begin_implementation tracked beside the phase", () => {
	// The full ladder a fresh card walks to reach implementing (drives realistic sequences below).
	const LADDER = [
		{ kind: "start_requested" },
		{ kind: "board_capacity_granted" },
		{ kind: "endpoint_granted" },
		{ kind: "sandbox_granted" },
		{ kind: "begin_implementation" },
	] as const;

	async function driveToImplementing(queue: ReturnType<typeof makeQueue>["queue"], taskId: string) {
		for (const command of LADDER) {
			await queue.dispatch(taskId, { ...command });
		}
	}

	it("nextRedriveInFlight: opens on reopened-from-live, closes on begin_implementation and on terminal phases", () => {
		expect(
			nextRedriveInFlight(false, {
				command: { kind: "reopened" },
				fromPhase: "awaiting_review",
				phase: "idle",
			}),
		).toBe(true);
		// A fresh card's ordinary ladder never opens the window: reopened from idle holds it closed.
		expect(nextRedriveInFlight(false, { command: { kind: "reopened" }, fromPhase: "idle", phase: "idle" })).toBe(
			false,
		);
		// Window stays open across the replayed admission ladder…
		expect(
			nextRedriveInFlight(true, {
				command: { kind: "start_requested" },
				fromPhase: "idle",
				phase: "queued_for_board_capacity",
			}),
		).toBe(true);
		// …and closes when implementation genuinely resumes, or when the redrive dies terminally.
		expect(
			nextRedriveInFlight(true, {
				command: { kind: "begin_implementation" },
				fromPhase: "planning",
				phase: "implementing",
			}),
		).toBe(false);
		expect(nextRedriveInFlight(true, { command: { kind: "failed" }, fromPhase: "planning", phase: "failed" })).toBe(
			false,
		);
	});

	it("a live queue exposes the window via redriveInFlightOf across a real reopen→restart sequence", async () => {
		const { queue } = makeQueue();
		await driveToImplementing(queue, "t-redrive");
		expect(queue.redriveInFlightOf("t-redrive")).toBe(false);
		await queue.dispatch("t-redrive", { kind: "implementation_finished" });
		// The redrive: reopened from a LIVE phase opens the window; the ladder replay keeps it open.
		await queue.dispatch("t-redrive", { kind: "reopened" });
		expect(queue.redriveInFlightOf("t-redrive")).toBe(true);
		await queue.dispatch("t-redrive", { kind: "start_requested" });
		await queue.dispatch("t-redrive", { kind: "board_capacity_granted" });
		expect(queue.redriveInFlightOf("t-redrive")).toBe(true);
		expect(queue.phaseOf("t-redrive")).toBe("queued_for_endpoint");
		// begin_implementation closes it — lane and phase agree again.
		await queue.dispatch("t-redrive", { kind: "endpoint_granted" });
		await queue.dispatch("t-redrive", { kind: "sandbox_granted" });
		await queue.dispatch("t-redrive", { kind: "begin_implementation" });
		expect(queue.redriveInFlightOf("t-redrive")).toBe(false);
	});

	it("boot replay recovers the open window exactly from the persisted transitions", async () => {
		const { queue, appended } = makeQueue();
		await driveToImplementing(queue, "t-replay");
		await queue.dispatch("t-replay", { kind: "implementation_finished" });
		await queue.dispatch("t-replay", { kind: "reopened" });
		await queue.dispatch("t-replay", { kind: "start_requested" });
		expect(queue.redriveInFlightOf("t-replay")).toBe(true);
		expect(replayWorkflowRedriveFromLedger(appended, "t-replay")).toBe(true);
		// After the window closes, replay agrees again.
		await queue.dispatch("t-replay", { kind: "board_capacity_granted" });
		await queue.dispatch("t-replay", { kind: "endpoint_granted" });
		await queue.dispatch("t-replay", { kind: "sandbox_granted" });
		await queue.dispatch("t-replay", { kind: "begin_implementation" });
		expect(replayWorkflowRedriveFromLedger(appended, "t-replay")).toBe(false);
		expect(queue.redriveInFlightOf("t-replay")).toBe(false);
	});
});
