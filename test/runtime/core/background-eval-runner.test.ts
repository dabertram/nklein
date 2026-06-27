import { describe, expect, it, vi } from "vitest";
import {
	type BackgroundEvalLease,
	type BackgroundEvalRunnerDeps,
	type BackgroundEvalRunnerSignals,
	createBackgroundEvalRunner,
} from "../../../src/core/background-eval-runner";

function makeDeps(overrides: Partial<BackgroundEvalRunnerDeps> = {}): {
	deps: BackgroundEvalRunnerDeps;
	clock: { now: number };
	signals: BackgroundEvalRunnerSignals;
	activeRunIds: Set<string>;
	checkpoint: BackgroundEvalLease[];
	startRun: ReturnType<typeof vi.fn>;
	stopRun: ReturnType<typeof vi.fn>;
} {
	const clock = { now: 1000 };
	const signals: BackgroundEvalRunnerSignals = {
		hasInteractiveWork: false,
		loadedModelIdle: true,
		resourceHeadroom: true,
	};
	const activeRunIds = new Set<string>();
	let checkpoint: BackgroundEvalLease[] = [];
	let runCounter = 0;
	const startRun = vi.fn(async (_project: string) => {
		runCounter += 1;
		const runId = `run-${runCounter}`;
		activeRunIds.add(runId);
		return { runId, workspaceId: `ws-${runCounter}`, deadlineAt: clock.now + 10_000 };
	});
	const stopRun = vi.fn(async (lease: BackgroundEvalLease) => {
		activeRunIds.delete(lease.runId);
	});
	const deps: BackgroundEvalRunnerDeps = {
		maxConcurrentEvals: 2,
		getSignals: async () => signals,
		selectNextProject: () => "demo_project",
		startRun,
		isRunActive: async (lease) => activeRunIds.has(lease.runId),
		stopRun,
		loadCheckpoint: async () => checkpoint,
		saveCheckpoint: async (leases) => {
			checkpoint = [...leases];
		},
		now: () => clock.now,
		...overrides,
	};
	return {
		deps,
		clock,
		signals,
		activeRunIds,
		get checkpoint() {
			return checkpoint;
		},
		startRun,
		stopRun,
	};
}

describe("createBackgroundEvalRunner", () => {
	it("admits a run when idle with capacity + a project to run, and checkpoints it", async () => {
		const h = makeDeps();
		const runner = createBackgroundEvalRunner(h.deps);
		const outcome = await runner.tick();
		expect(outcome.reason).toBe("admitted");
		expect(outcome.admitted?.project).toBe("demo_project");
		expect(outcome.activeLeases).toBe(1);
		expect(h.startRun).toHaveBeenCalledOnce();
		expect(h.checkpoint).toHaveLength(1); // persisted for restart
	});

	it("ALWAYS yields to interactive work (no run started)", async () => {
		const h = makeDeps();
		h.signals.hasInteractiveWork = true;
		const runner = createBackgroundEvalRunner(h.deps);
		const outcome = await runner.tick();
		expect(outcome.reason).toBe("yield_to_interactive");
		expect(outcome.admitted).toBeNull();
		expect(h.startRun).not.toHaveBeenCalled();
	});

	it("holds at the concurrency cap, then admits again once a lease completes", async () => {
		const h = makeDeps({ maxConcurrentEvals: 1 });
		const runner = createBackgroundEvalRunner(h.deps);
		const first = await runner.tick();
		expect(first.reason).toBe("admitted");
		const second = await runner.tick();
		expect(second.reason).toBe("background_cap_reached"); // cap of 1 reached
		// the first run completes naturally → its lease is reaped → a slot frees up
		h.activeRunIds.clear();
		const third = await runner.tick();
		expect(third.reaped.map((lease) => lease.runId)).toEqual(["run-1"]);
		expect(h.stopRun).not.toHaveBeenCalled(); // natural completion, not force-stopped
		expect(third.reason).toBe("admitted");
		expect(third.activeLeases).toBe(1);
	});

	it("force-stops + reaps a lease that overran its deadline", async () => {
		const h = makeDeps({ maxConcurrentEvals: 1 });
		const runner = createBackgroundEvalRunner(h.deps);
		await runner.tick(); // run-1, deadline now+10000
		h.clock.now += 20_000; // past the deadline
		const outcome = await runner.tick();
		expect(outcome.reaped.map((lease) => lease.runId)).toEqual(["run-1"]);
		expect(h.stopRun).toHaveBeenCalledOnce(); // overran → force-stopped
		expect(outcome.reason).toBe("admitted"); // slot freed → new run admitted
	});

	it("reports no_project_to_run when admission passes but the selector has nothing", async () => {
		const h = makeDeps({ selectNextProject: () => null });
		const runner = createBackgroundEvalRunner(h.deps);
		const outcome = await runner.tick();
		expect(outcome.reason).toBe("no_project_to_run");
		expect(outcome.admitted).toBeNull();
	});

	it("recover() restores in-flight leases from the durable checkpoint", async () => {
		const lease: BackgroundEvalLease = {
			runId: "run-x",
			project: "p",
			workspaceId: "ws-x",
			startedAt: 1,
			deadlineAt: 9_999_999,
		};
		const h = makeDeps({ loadCheckpoint: async () => [lease] });
		const runner = createBackgroundEvalRunner(h.deps);
		await runner.recover();
		expect(runner.getLeases().map((l) => l.runId)).toEqual(["run-x"]);
	});
});
