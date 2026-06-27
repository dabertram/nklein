import { describe, expect, it } from "vitest";
import { computeBackgroundEvalRunnerSignals } from "../../../src/core/background-eval-runner-signals";

describe("computeBackgroundEvalRunnerSignals", () => {
	it("flags interactive work when a session runs in a workspace the runner does NOT own", () => {
		const signals = computeBackgroundEvalRunnerSignals({
			projects: [
				{ workspaceId: "owned", runningSessionCount: 1 },
				{ workspaceId: "user", runningSessionCount: 1 },
			],
			ownedWorkspaceIds: new Set(["owned"]),
			modelLoaded: true,
			maxConcurrentTasks: 4,
			totalRunningSessions: 2,
		});
		expect(signals.hasInteractiveWork).toBe(true);
	});

	it("does NOT flag interactive work when all running sessions are the runner's own leases", () => {
		const signals = computeBackgroundEvalRunnerSignals({
			projects: [
				{ workspaceId: "owned-1", runningSessionCount: 1 },
				{ workspaceId: "owned-2", runningSessionCount: 1 },
				{ workspaceId: "idle", runningSessionCount: 0 },
			],
			ownedWorkspaceIds: new Set(["owned-1", "owned-2"]),
			modelLoaded: true,
			maxConcurrentTasks: 4,
			totalRunningSessions: 2,
		});
		expect(signals.hasInteractiveWork).toBe(false);
	});

	it("reports loadedModelIdle from modelLoaded", () => {
		const base = {
			projects: [],
			ownedWorkspaceIds: new Set<string>(),
			maxConcurrentTasks: 4,
			totalRunningSessions: 0,
		};
		expect(computeBackgroundEvalRunnerSignals({ ...base, modelLoaded: true }).loadedModelIdle).toBe(true);
		expect(computeBackgroundEvalRunnerSignals({ ...base, modelLoaded: false }).loadedModelIdle).toBe(false);
	});

	it("has resource headroom only while total running sessions are below the board cap", () => {
		const base = {
			projects: [],
			ownedWorkspaceIds: new Set<string>(),
			modelLoaded: true,
			maxConcurrentTasks: 3,
		};
		expect(computeBackgroundEvalRunnerSignals({ ...base, totalRunningSessions: 2 }).resourceHeadroom).toBe(true);
		expect(computeBackgroundEvalRunnerSignals({ ...base, totalRunningSessions: 3 }).resourceHeadroom).toBe(false);
		expect(computeBackgroundEvalRunnerSignals({ ...base, totalRunningSessions: 5 }).resourceHeadroom).toBe(false);
	});
});
