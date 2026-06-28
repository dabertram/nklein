import { describe, expect, it } from "vitest";
import type { AgentSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
import type { DurableDispatch } from "../../../src/core/durable-run-controller";
import { createLedgerDurableRunPorts } from "../../../src/core/durable-run-ports";

describe("createLedgerDurableRunPorts", () => {
	it("maps a log entry through the ledger adapter and appends it; forwards dispatch; honors injected clock/mint", async () => {
		const appended: AgentSchedulerEvent[] = [];
		const dispatched: DurableDispatch[] = [];
		const ports = createLedgerDurableRunPorts({
			envelope: { workflowId: "wf", workspacePathHash: "h" },
			appendEvent: (event) => {
				appended.push(event);
			},
			enqueueStart: (d) => {
				dispatched.push(d);
			},
			now: () => 4242,
			mintWorkerId: () => "worker-x",
		});

		expect(ports.now()).toBe(4242);
		expect(ports.mintWorkerId()).toBe("worker-x");

		await ports.appendLog({
			kind: "scheduled",
			now: 100,
			action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 200 },
		});
		expect(appended).toHaveLength(1);
		expect(appended[0]).toMatchObject({
			kind: "scheduler",
			event: "lease_acquired",
			workflowId: "wf",
			taskId: "a",
			workerId: "w1",
			detail: "200",
			recordedAt: 100,
		});

		ports.dispatch({ jobId: "a", workerId: "w1", expiresAt: 200 });
		expect(dispatched).toEqual([{ jobId: "a", workerId: "w1", expiresAt: 200 }]);
	});

	it("defaults now/mintWorkerId when not injected", () => {
		const ports = createLedgerDurableRunPorts({
			envelope: { workflowId: "wf", workspacePathHash: "h" },
			appendEvent: () => {},
			enqueueStart: () => {},
		});
		expect(ports.now()).toBeGreaterThan(0);
		expect(ports.mintWorkerId()).toMatch(/[0-9a-f-]{36}/);
	});
});
