import { afterEach, describe, expect, it, vi } from "vitest";
import { hashWorkspacePathForLedger } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { readAgentLedger } from "../../../src/state/agent-attempt-ledger-store";
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
