import { describe, expect, it } from "vitest";
import {
	type DurableDispatch,
	type DurableRunConfig,
	DurableRunController,
	type DurableRunPorts,
} from "../../../src/core/durable-run-controller";
import { DurableRunRegistry } from "../../../src/core/durable-run-registry";
import { buildDurableJobGraph, type DurableSchedulerLogEntry } from "../../../src/core/durable-scheduler";

const config: DurableRunConfig = { maxConcurrentLeases: 2, leaseDurationMs: 100, maxAttempts: 3, reclaimBackoffMs: 0 };

function fakePorts(startNow = 0) {
	let clock = startNow;
	let counter = 0;
	const log: DurableSchedulerLogEntry[] = [];
	const dispatches: DurableDispatch[] = [];
	const ports: DurableRunPorts = {
		now: () => clock,
		mintWorkerId: () => `w${++counter}`,
		appendLog: (entry) => {
			log.push(entry);
		},
		dispatch: (d) => dispatches.push(d),
	};
	return { ports, log, dispatches, setClock: (t: number) => (clock = t) };
}

function controllerFor(taskIds: string[]) {
	const graph = buildDurableJobGraph({ taskIds, dependencies: [] });
	const fake = fakePorts();
	return { controller: new DurableRunController(graph, config, fake.ports), fake };
}

describe("DurableRunRegistry", () => {
	it("registers / gets / has / disposes a workspace run", () => {
		const registry = new DurableRunRegistry();
		const { controller } = controllerFor(["a"]);
		expect(registry.has("ws")).toBe(false);
		registry.register("ws", controller);
		expect(registry.get("ws")).toBe(controller);
		expect(registry.activeWorkspaceIds()).toEqual(["ws"]);
		registry.dispose("ws");
		expect(registry.get("ws")).toBeNull();
	});

	it("reactToTaskSummary(awaiting_review) reports succeeded + ticks + auto-disposes a finished run", async () => {
		const registry = new DurableRunRegistry();
		const { controller } = controllerFor(["a"]);
		registry.register("ws", controller);
		await controller.tick(); // lease a

		await registry.reactToTaskSummary("ws", "a", "awaiting_review");
		expect(controller.jobsSnapshot()[0]?.state).toBe("succeeded");
		expect(controller.isComplete()).toBe(true);
		// finished → auto-disposed so the registry doesn't leak it.
		expect(registry.has("ws")).toBe(false);
	});

	it("reactToTaskSummary(failed, transient) routes to a retry via the controller", async () => {
		const registry = new DurableRunRegistry();
		const { controller, fake } = controllerFor(["a"]);
		registry.register("ws", controller);
		await controller.tick();

		await registry.reactToTaskSummary("ws", "a", "failed", "Body Timeout Error");
		// transient → NOT parked; the report's retry + the follow-up tick re-dispatch the card.
		expect(controller.jobsSnapshot()[0]?.state).not.toBe("failed");
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a", "a"]); // re-dispatched
		expect(registry.has("ws")).toBe(true); // still active
	});

	it("reactToTaskSummary(running) heartbeats the lease (no reclaim of a slow worker)", async () => {
		const registry = new DurableRunRegistry();
		const { controller, fake } = controllerFor(["a"]);
		registry.register("ws", controller);
		await controller.tick(); // lease a, expiresAt 100

		fake.setClock(90);
		await registry.reactToTaskSummary("ws", "a", "running"); // extend to 190
		fake.setClock(150);
		await controller.tick();
		expect(controller.jobsSnapshot()[0]?.state).toBe("leased"); // not reclaimed
	});

	it("is a no-op for an unknown workspace or a non-actionable state", async () => {
		const registry = new DurableRunRegistry();
		const { controller } = controllerFor(["a"]);
		registry.register("ws", controller);
		await controller.tick();
		await registry.reactToTaskSummary("other", "a", "awaiting_review"); // unknown ws
		await registry.reactToTaskSummary("ws", "a", "queued"); // non-actionable
		expect(controller.jobsSnapshot()[0]?.state).toBe("leased"); // unchanged
	});
});
