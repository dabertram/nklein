import { describe, expect, it, vi } from "vitest";
import type { BackgroundEvalLease } from "../../../src/core/background-eval-runner";
import {
	type BackgroundEvalRuntimeAtoms,
	createBackgroundEvalServiceDeps,
} from "../../../src/server/background-eval-runtime-deps";

function atoms(over: Partial<BackgroundEvalRuntimeAtoms> = {}): BackgroundEvalRuntimeAtoms {
	return {
		now: () => 1_000,
		maxConcurrentEvals: 1,
		tickIntervalMs: 60_000,
		maxRunMs: 300_000,
		scaffold: async (scenarioId) => ({ workspacePath: `/tmp/${scenarioId}`, workspaceId: `ws-${scenarioId}` }),
		startSession: async ({ scenarioId }) => ({ taskId: `task-${scenarioId}` }),
		getSessionState: async () => "running",
		stopSession: async () => {},
		removeWorkspace: async () => {},
		resolveWorkspacePath: async (workspaceId) => `/recovered/${workspaceId}`,
		selectScenario: () => "smoke",
		getSignals: async () => ({ hasInteractiveWork: false, loadedModelIdle: true, resourceHeadroom: true }),
		loadCheckpoint: async () => [],
		saveCheckpoint: async () => {},
		...over,
	};
}

const lease = (over: Partial<BackgroundEvalLease> = {}): BackgroundEvalLease => ({
	runId: "task-smoke",
	project: "smoke",
	workspaceId: "ws-smoke",
	startedAt: 1_000,
	deadlineAt: 301_000,
	...over,
});

describe("createBackgroundEvalServiceDeps (F1.31b assembly)", () => {
	it("startRun scaffolds → starts non-blocking → returns lease identity with a deadline", async () => {
		const scaffold = vi.fn(async (s: string) => ({ workspacePath: `/tmp/${s}`, workspaceId: `ws-${s}` }));
		const startSession = vi.fn(async () => ({ taskId: "task-smoke" }));
		const deps = createBackgroundEvalServiceDeps(
			atoms({ scaffold, startSession, now: () => 5_000, maxRunMs: 120_000 }),
		);
		const started = await deps.runner.startRun("smoke");
		expect(scaffold).toHaveBeenCalledWith("smoke");
		expect(startSession).toHaveBeenCalledWith({
			scenarioId: "smoke",
			workspacePath: "/tmp/smoke",
			workspaceId: "ws-smoke",
		});
		expect(started).toEqual({ runId: "task-smoke", workspaceId: "ws-smoke", deadlineAt: 125_000 });
	});

	it("isRunActive maps the started run to its path and reads the session state", async () => {
		const getSessionState = vi.fn(async () => "running" as const);
		const deps = createBackgroundEvalServiceDeps(atoms({ getSessionState }));
		await deps.runner.startRun("smoke");
		expect(await deps.runner.isRunActive(lease())).toBe(true);
		expect(getSessionState).toHaveBeenLastCalledWith({ taskId: "task-smoke", workspacePath: "/tmp/smoke" });

		// A terminal state ⇒ not active (so the runner reaps it).
		const terminal = createBackgroundEvalServiceDeps(atoms({ getSessionState: async () => "awaiting_review" }));
		await terminal.runner.startRun("smoke");
		expect(await terminal.runner.isRunActive(lease())).toBe(false);
	});

	it("cleanupProject deletes the started run's workspace and forgets it", async () => {
		const removeWorkspace = vi.fn(async () => {});
		const deps = createBackgroundEvalServiceDeps(atoms({ removeWorkspace }));
		await deps.runner.startRun("smoke");
		await deps.cleanupProject(lease(), "reaped");
		expect(removeWorkspace).toHaveBeenCalledWith("/tmp/smoke");
	});

	it("a lease RECOVERED after restart (empty map) resolves its path from workspaceId", async () => {
		const removeWorkspace = vi.fn(async () => {});
		const getSessionState = vi.fn(async () => "running" as const);
		// Fresh deps: nothing started this process ⇒ the runId→path map is empty.
		const deps = createBackgroundEvalServiceDeps(atoms({ removeWorkspace, getSessionState }));
		const recovered = lease({ runId: "task-old", workspaceId: "ws-old" });
		expect(await deps.runner.isRunActive(recovered)).toBe(true);
		expect(getSessionState).toHaveBeenCalledWith({ taskId: "task-old", workspacePath: "/recovered/ws-old" });
		await deps.cleanupProject(recovered, "shutdown");
		expect(removeWorkspace).toHaveBeenCalledWith("/recovered/ws-old");
	});

	it("an unresolvable lease (no map entry, null workspaceId) is inactive and skips cleanup", async () => {
		const removeWorkspace = vi.fn(async () => {});
		const deps = createBackgroundEvalServiceDeps(atoms({ removeWorkspace }));
		const orphan = lease({ runId: "task-gone", workspaceId: null });
		expect(await deps.runner.isRunActive(orphan)).toBe(false);
		await deps.cleanupProject(orphan, "shutdown");
		expect(removeWorkspace).not.toHaveBeenCalled();
	});

	it("passes the cap, tick interval, selection, signals, and checkpoint through to the runner deps", async () => {
		const saveCheckpoint = vi.fn(async () => {});
		const deps = createBackgroundEvalServiceDeps(
			atoms({ maxConcurrentEvals: 3, tickIntervalMs: 90_000, saveCheckpoint }),
		);
		expect(deps.tickIntervalMs).toBe(90_000);
		expect(deps.runner.maxConcurrentEvals).toBe(3);
		expect(deps.runner.selectNextProject()).toBe("smoke");
		expect(await deps.runner.getSignals()).toEqual({
			hasInteractiveWork: false,
			loadedModelIdle: true,
			resourceHeadroom: true,
		});
	});
});
