import { describe, expect, it } from "vitest";
import type { BackgroundEvalLease, BackgroundEvalRunnerDeps } from "../../../src/core/background-eval-runner";
import {
	type BackgroundEvalCleanupCause,
	createBackgroundEvalService,
} from "../../../src/server/background-eval-service";

/**
 * F1.31 — the production background-eval service driver: startup recovery before ticking, serialized ticks,
 * reap-triggered throwaway-project cleanup, and shutdown that force-stops + cleans every held lease, empties the
 * checkpoint, and never throws on a stuck sandbox (errors collected into the status instead).
 */

interface Harness {
	deps: BackgroundEvalRunnerDeps;
	checkpoint: BackgroundEvalLease[];
	saved: BackgroundEvalLease[][];
	started: string[];
	stopped: string[];
	cleaned: Array<{ runId: string; cause: BackgroundEvalCleanupCause }>;
	activeRunIds: Set<string>;
	signals: { hasInteractiveWork: boolean; loadedModelIdle: boolean; resourceHeadroom: boolean };
	nextProject: string | null;
	now: number;
}

function makeHarness(overrides: Partial<Pick<Harness, "checkpoint" | "nextProject">> = {}): Harness {
	const harness: Harness = {
		checkpoint: overrides.checkpoint ?? [],
		saved: [],
		started: [],
		stopped: [],
		cleaned: [],
		activeRunIds: new Set(),
		signals: { hasInteractiveWork: false, loadedModelIdle: true, resourceHeadroom: true },
		nextProject: overrides.nextProject !== undefined ? overrides.nextProject : "eval-project-1",
		now: 1_000,
		deps: undefined as unknown as BackgroundEvalRunnerDeps,
	};
	let runSeq = 0;
	harness.deps = {
		maxConcurrentEvals: 2,
		getSignals: async () => harness.signals,
		selectNextProject: () => harness.nextProject,
		startRun: async (project) => {
			runSeq += 1;
			const runId = `run-${runSeq}`;
			harness.started.push(`${project}:${runId}`);
			harness.activeRunIds.add(runId);
			return { runId, workspaceId: `ws-${runId}`, deadlineAt: harness.now + 60_000 };
		},
		isRunActive: async (lease) => harness.activeRunIds.has(lease.runId),
		stopRun: async (lease) => {
			harness.stopped.push(lease.runId);
			harness.activeRunIds.delete(lease.runId);
		},
		loadCheckpoint: async () => [...harness.checkpoint],
		saveCheckpoint: async (leases) => {
			harness.checkpoint = [...leases];
			harness.saved.push([...leases]);
		},
		now: () => harness.now,
	};
	return harness;
}

function makeService(harness: Harness, tickIntervalMs = 60_000) {
	return createBackgroundEvalService({
		runner: harness.deps,
		tickIntervalMs,
		cleanupProject: async (lease, cause) => {
			harness.cleaned.push({ runId: lease.runId, cause });
		},
	});
}

describe("createBackgroundEvalService", () => {
	it("recovers the checkpoint on start and reaps a dead predecessor lease with cleanup", async () => {
		const staleLease: BackgroundEvalLease = {
			runId: "stale-run",
			project: "old-project",
			workspaceId: "ws-stale",
			startedAt: 0,
			deadlineAt: 500_000, // not expired — but the run is NOT active (predecessor process died)
		};
		const harness = makeHarness({ checkpoint: [staleLease], nextProject: null });
		const service = makeService(harness);
		await service.start();
		expect(service.getStatus().activeLeases).toEqual([staleLease]); // recovered before any tick

		const outcome = await service.tickNow();
		expect(outcome?.reaped.map((lease) => lease.runId)).toEqual(["stale-run"]);
		expect(harness.cleaned).toEqual([{ runId: "stale-run", cause: "reaped" }]);
		expect(harness.checkpoint).toEqual([]); // reap persisted
		await service.stop();
	});

	it("admits a run when idle, then cleans its throwaway project when it completes", async () => {
		const harness = makeHarness();
		const service = makeService(harness);
		await service.start();

		const admitted = await service.tickNow();
		expect(admitted?.reason).toBe("admitted");
		expect(harness.started).toEqual(["eval-project-1:run-1"]);
		expect(service.getStatus().activeLeases).toHaveLength(1);

		harness.activeRunIds.delete("run-1"); // the run reaches a terminal state on its own
		harness.nextProject = null;
		const reapTick = await service.tickNow();
		expect(reapTick?.reaped.map((lease) => lease.runId)).toEqual(["run-1"]);
		expect(harness.cleaned).toEqual([{ runId: "run-1", cause: "reaped" }]);
		expect(harness.stopped).toEqual([]); // natural completion is never force-stopped
		await service.stop();
	});

	it("stop() force-stops held leases, cleans their projects, and empties the checkpoint", async () => {
		const harness = makeHarness();
		const service = makeService(harness);
		await service.start();
		await service.tickNow();
		expect(service.getStatus().activeLeases).toHaveLength(1);

		await service.stop();
		expect(harness.stopped).toEqual(["run-1"]);
		expect(harness.cleaned).toEqual([{ runId: "run-1", cause: "shutdown" }]);
		expect(harness.checkpoint).toEqual([]);
		const status = service.getStatus();
		expect(status.running).toBe(false);
		expect(status.activeLeases).toEqual([]);
		expect(status.cleanupErrors).toEqual([]);
	});

	it("collects cleanup failures into the status instead of throwing on shutdown", async () => {
		const harness = makeHarness();
		const service = createBackgroundEvalService({
			runner: harness.deps,
			tickIntervalMs: 60_000,
			cleanupProject: async () => {
				throw new Error("sandbox stuck");
			},
		});
		await service.start();
		await service.tickNow();
		await expect(service.stop()).resolves.toBeUndefined();
		const status = service.getStatus();
		expect(status.cleanupErrors).toHaveLength(1);
		expect(status.cleanupErrors[0]).toContain("sandbox stuck");
		expect(status.cleanupErrors[0]).toContain("shutdown");
		expect(harness.checkpoint).toEqual([]); // the checkpoint still empties despite the failure
	});

	it("serializes ticks: a second tick during an in-flight one is skipped with null", async () => {
		const harness = makeHarness();
		let releaseSignals: () => void = () => {};
		harness.deps.getSignals = () =>
			new Promise((resolve) => {
				releaseSignals = () => resolve(harness.signals);
			});
		const service = makeService(harness);
		await service.start();

		const first = service.tickNow();
		const second = await service.tickNow(); // in-flight → skipped
		expect(second).toBeNull();
		releaseSignals();
		const firstOutcome = await first;
		expect(firstOutcome?.reason).toBe("admitted");
		harness.deps.getSignals = async () => harness.signals;
		await service.stop();
	});

	it("yields to interactive work and records the tick reason without starting anything", async () => {
		const harness = makeHarness();
		harness.signals.hasInteractiveWork = true;
		const service = makeService(harness);
		await service.start();
		const outcome = await service.tickNow();
		expect(outcome?.reason).toBe("yield_to_interactive");
		expect(harness.started).toEqual([]);
		expect(service.getStatus().lastTick?.reason).toBe("yield_to_interactive");
		await service.stop();
	});

	it("a tick error is recorded and the service keeps ticking (the timer never dies)", async () => {
		const harness = makeHarness();
		let failNext = true;
		const stableGetSignals = harness.deps.getSignals;
		harness.deps.getSignals = async () => {
			if (failNext) {
				failNext = false;
				throw new Error("signals unavailable");
			}
			return stableGetSignals();
		};
		const service = makeService(harness);
		await service.start();

		const failed = await service.tickNow();
		expect(failed).toBeNull();
		expect(service.getStatus().lastTickError).toContain("signals unavailable");

		const recovered = await service.tickNow();
		expect(recovered?.reason).toBe("admitted");
		expect(service.getStatus().lastTickError).toBeNull();
		await service.stop();
	});

	it("start and stop are idempotent", async () => {
		const harness = makeHarness({ nextProject: null });
		const service = makeService(harness);
		await service.start();
		await service.start();
		await service.stop();
		await service.stop();
		expect(service.getStatus().running).toBe(false);
	});
});
