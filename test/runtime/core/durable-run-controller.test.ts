import { describe, expect, it } from "vitest";
import {
	type DurableDispatch,
	type DurableRunConfig,
	DurableRunController,
	type DurableRunPorts,
} from "../../../src/core/durable-run-controller";
import {
	buildDurableJobGraph,
	type DurableSchedulerLogEntry,
	replayDurableJobs,
} from "../../../src/core/durable-scheduler";

const config: DurableRunConfig = { maxConcurrentLeases: 2, leaseDurationMs: 100, maxAttempts: 3, reclaimBackoffMs: 0 };

/** A fake runtime: a movable clock, a deterministic worker-id mint, and recorders for the log + dispatches. */
function fakePorts(over: Partial<DurableRunPorts> & { startNow?: number } = {}) {
	let clock = over.startNow ?? 1000;
	let counter = 0;
	const log: DurableSchedulerLogEntry[] = [];
	const dispatches: DurableDispatch[] = [];
	const ports: DurableRunPorts = {
		now: () => clock,
		mintWorkerId: () => `w${++counter}`,
		appendLog: (entry) => {
			log.push(entry);
		},
		dispatch: (dispatch) => dispatches.push(dispatch),
		...over,
	};
	return { ports, log, dispatches, advance: (ms: number) => (clock += ms), setClock: (t: number) => (clock = t) };
}

describe("DurableRunController", () => {
	it("drives a dependency chain to completion via tick + reportCompletion, dispatching each ready card", async () => {
		const graph = buildDurableJobGraph({
			taskIds: ["a", "b", "c"],
			dependencies: [
				{ fromTaskId: "b", toTaskId: "a" },
				{ fromTaskId: "c", toTaskId: "b" },
			],
		});
		const { ports, log, dispatches } = fakePorts();
		const controller = new DurableRunController(graph, config, ports);

		// a is the only ready job → leased + dispatched.
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a"]);

		// a finishes → b unblocks on the next tick.
		await controller.reportCompletion("a", "succeeded");
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a", "b"]);

		await controller.reportCompletion("b", "succeeded");
		await controller.tick();
		expect(dispatches.map((d) => d.jobId)).toEqual(["a", "b", "c"]);

		await controller.reportCompletion("c", "succeeded");
		await controller.tick();
		expect(controller.isComplete()).toBe(true);
		expect(controller.jobsSnapshot().every((j) => j.state === "succeeded")).toBe(true);
		// The persisted log replays to the same terminal state (restart-survivable).
		expect(replayDurableJobs(graph, log, { reclaimBackoffMs: 0 })).toEqual(controller.jobsSnapshot());
	});

	it("reclaims an expired lease and re-dispatches the card within the attempt budget", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		const fake = fakePorts({ startNow: 0 });
		const controller = new DurableRunController(graph, config, fake.ports);

		await controller.tick(); // lease a (worker w1), expires at 100
		expect(fake.dispatches).toHaveLength(1);
		fake.setClock(200); // past expiry, worker never reported
		await controller.tick(); // reclaim → re-lease (backoff 0) → re-dispatch
		expect(fake.dispatches).toHaveLength(2);
		expect(fake.dispatches[1]?.jobId).toBe("a");
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "leased", attempts: 2 });
	});

	it("resume() reclaims an orphaned in-flight lease so the next tick re-dispatches it", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a", "b"], dependencies: [{ fromTaskId: "b", toTaskId: "a" }] });
		// A prior process leased `a` and crashed before it reported.
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "old", expiresAt: 100 } },
		];
		const fake = fakePorts({ startNow: 5000 });
		const controller = await DurableRunController.resume(graph, priorLog, config, fake.ports);

		// On resume, `a` was leased → reclaimed (orphaned), logged.
		expect(controller.jobsSnapshot().find((j) => j.jobId === "a")).toMatchObject({ state: "ready", attempts: 1 });
		expect(fake.log.some((e) => e.kind === "scheduled" && e.action.type === "reclaim")).toBe(true);
		// Next tick re-dispatches `a`.
		await controller.tick();
		expect(fake.dispatches.map((d) => d.jobId)).toEqual(["a"]);
	});

	it("fails an orphaned lease on resume when its attempt budget is already spent", async () => {
		const graph = buildDurableJobGraph({ taskIds: ["a"], dependencies: [] });
		// Three prior leases (attempts exhausted at maxAttempts=3), still leased at crash.
		const priorLog: DurableSchedulerLogEntry[] = [
			{ kind: "scheduled", now: 0, action: { type: "lease", jobId: "a", workerId: "w1", expiresAt: 10 } },
			{ kind: "scheduled", now: 20, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ kind: "scheduled", now: 20, action: { type: "lease", jobId: "a", workerId: "w2", expiresAt: 30 } },
			{ kind: "scheduled", now: 40, action: { type: "reclaim", jobId: "a", reason: "lease_expired" } },
			{ kind: "scheduled", now: 40, action: { type: "lease", jobId: "a", workerId: "w3", expiresAt: 50 } },
		];
		const fake = fakePorts({ startNow: 9000 });
		const controller = await DurableRunController.resume(graph, priorLog, config, fake.ports);
		expect(controller.jobsSnapshot()[0]).toMatchObject({ state: "failed", attempts: 3 });
		expect(controller.isComplete()).toBe(true);
	});
});
