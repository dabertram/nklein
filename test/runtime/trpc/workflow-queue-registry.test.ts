import { afterEach, describe, expect, it, vi } from "vitest";
import { hashWorkspacePathForLedger } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { readAgentLedger } from "../../../src/state/agent-attempt-ledger-store";
import { dispatchWorkflowStartCommands } from "../../../src/trpc/runtime-api/start-task-session";
import { handleStopTaskSession } from "../../../src/trpc/runtime-api/task-session-io";
import {
	getWorkspaceWorkflowQueue,
	resetWorkspaceWorkflowQueuesForTest,
} from "../../../src/trpc/runtime-api/workflow-queue-registry";

/**
 * F1.27b (leaf 1) — the live queue mount + the first migrated adapter path: one workflow command queue per
 * workspace, and the operator stop emits `cancel_requested` through it (audit-only; the stop effect is untouched).
 */

afterEach(() => {
	resetWorkspaceWorkflowQueuesForTest();
});

describe("getWorkspaceWorkflowQueue", () => {
	it("returns one shared queue per workspace path (distinct workspaces get distinct mirrors)", async () => {
		const a1 = getWorkspaceWorkflowQueue("/tmp/ws-a", "ws-a");
		const a2 = getWorkspaceWorkflowQueue("/tmp/ws-a", "ws-a");
		const b = getWorkspaceWorkflowQueue("/tmp/ws-b", "ws-b");
		expect(a1).toBe(a2);
		expect(a1).not.toBe(b);
		await a1.dispatch("t-1", { kind: "start_requested" });
		expect(a2.phaseOf("t-1")).toBe("queued_for_board_capacity"); // same mirror
		expect(b.phaseOf("t-1")).toBe("idle");
	});
});

describe("dispatchWorkflowStartCommands (F1.27b leaf 2 — the start path)", () => {
	it("a queued start lands queued_for_endpoint; the later successful start completes the ladder (holds absorb duplicates)", async () => {
		const workspacePath = "/tmp/ws-start-adapter";
		const scope = { workspaceId: "ws-start", workspacePath };
		// Endpoint-busy queue: request + capacity grant only.
		dispatchWorkflowStartCommands(scope, "t-1", ["start_requested", "board_capacity_granted"]);
		const queue = getWorkspaceWorkflowQueue(workspacePath, "ws-start");
		await vi.waitFor(() => expect(queue.phaseOf("t-1")).toBe("queued_for_endpoint"));
		// The drained retry re-enters the handler and fires the FULL ladder — the first two hold silently.
		dispatchWorkflowStartCommands(scope, "t-1", [
			"start_requested",
			"board_capacity_granted",
			"endpoint_granted",
			"sandbox_granted",
		]);
		await vi.waitFor(() => expect(queue.phaseOf("t-1")).toBe("planning"));
		// The ledger recorded exactly the APPLIED transitions (4 total), no duplicates.
		const events = await readAgentLedger({ workspacePathHash: hashWorkspacePathForLedger(workspacePath) });
		const applied = events.filter(
			(event) =>
				event.kind === "transition" && event.taskId === "t-1" && event.controllerDecision === "workflow_kernel",
		);
		expect(applied).toHaveLength(4);
	});
});

describe("handleStopTaskSession (F1.27b first migrated adapter)", () => {
	it("stops through the proven service path AND records the cancel_requested command in the ledger", async () => {
		const workspacePath = "/tmp/ws-stop-adapter";
		const stopTaskSession = vi.fn(async () => ({ taskId: "t-1", state: "interrupted" }) as never);
		const result = await handleStopTaskSession({ workspaceId: "ws-stop", workspacePath }, { taskId: "t-1" }, {
			getScopedNKleinTaskSessionService: async () => ({ stopTaskSession }) as never,
		} as never);
		expect(result.ok).toBe(true);
		expect(stopTaskSession).toHaveBeenCalledWith("t-1"); // the effect path is byte-identical
		// The command landed in the workspace's ledger as a wf:* transition (cancel from idle is kernel-truth
		// for an operator stop of a task the kernel never saw start).
		await vi.waitFor(async () => {
			const events = await readAgentLedger({ workspacePathHash: hashWorkspacePathForLedger(workspacePath) });
			const cancel = events.find(
				(event) => event.kind === "transition" && event.taskId === "t-1" && event.to === "wf:cancelled",
			);
			expect(cancel).toMatchObject({ reason: "cancel_requested", controllerDecision: "workflow_kernel" });
		});
		// The queue mirror agrees.
		expect(getWorkspaceWorkflowQueue(workspacePath, "ws-stop").phaseOf("t-1")).toBe("cancelled");
	});

	it("a failed stop (no session) dispatches nothing", async () => {
		const workspacePath = "/tmp/ws-stop-none";
		const result = await handleStopTaskSession({ workspaceId: "ws-none", workspacePath }, { taskId: "t-none" }, {
			getScopedNKleinTaskSessionService: async () => ({ stopTaskSession: async () => null }) as never,
		} as never);
		expect(result.ok).toBe(false);
		expect(getWorkspaceWorkflowQueue(workspacePath, "ws-none").phaseOf("t-none")).toBe("idle");
	});
});
