import type { RuntimeTaskSessionState } from "../core/api-contract.js";
import type { BackgroundEvalLease, BackgroundEvalRunnerSignals } from "../core/background-eval-runner.js";
import { isActiveWorkSessionState } from "../core/session-state-predicates.js";
import type { BackgroundEvalCleanupCause, BackgroundEvalServiceDeps } from "./background-eval-service.js";

/**
 * F1.31b (§5.AI) — assemble the effectful `BackgroundEvalServiceDeps` from ATOMIC runtime operations. This module owns
 * the run lifecycle glue the pure runner can't: it scaffolds a throwaway dev-test project, starts a NON-BLOCKING
 * sandboxed run (returning its lease identity immediately — the runner reaps it by deadline / terminal state), and on
 * reap/shutdown deletes the throwaway workspace. It keeps a `runId → {workspacePath, workspaceId}` map so the
 * lease-taking calls (isRunActive/stopRun/cleanupProject) can resolve a session; a lease RECOVERED after a restart
 * (empty map) resolves its path from `workspaceId` via the injected resolver, so recovery still reaps + cleans.
 *
 * Every effect is INJECTED, so the whole assembly is unit-testable over fakes; `runtime-server` supplies the real
 * atoms (scaffold, task-session start/status/stop, workspace delete, signals) behind the `NKLEIN_EVAL_RAIL` flag. The
 * `runId` IS the started task's id — the join key across the lifecycle.
 */

export interface BackgroundEvalRuntimeAtoms {
	now: () => number;
	/** Admission cap + the reaper deadline horizon. */
	maxConcurrentEvals: number;
	tickIntervalMs: number;
	/** A background run is force-stopped once it has run this long (secondary safety net beyond the run's own guards). */
	maxRunMs: number;
	/** Scaffold a throwaway dev-test project for a scenario id; returns its workspace path + (registered) id. */
	scaffold: (scenarioId: string) => Promise<{ workspacePath: string; workspaceId: string | null }>;
	/** Start a NON-BLOCKING sandboxed dev-test run; returns the started task id. Must NOT wait for the run to finish. */
	startSession: (input: {
		scenarioId: string;
		workspacePath: string;
		workspaceId: string | null;
	}) => Promise<{ taskId: string }>;
	/** The current session state for a started task (null when unknown/gone). */
	getSessionState: (input: { taskId: string; workspacePath: string }) => Promise<RuntimeTaskSessionState | null>;
	/** Force-stop a started task. */
	stopSession: (input: { taskId: string; workspacePath: string }) => Promise<void>;
	/** Delete a throwaway workspace directory (best-effort — the service collects any error). */
	removeWorkspace: (workspacePath: string) => Promise<void>;
	/** Resolve a workspace id back to its path (for leases recovered after a restart, whose map entry is gone). */
	resolveWorkspacePath: (workspaceId: string) => Promise<string | null>;
	/** Pick the next scenario id to evaluate, or null when there's nothing to run (round-robin until F1.32). */
	selectScenario: () => string | null;
	/** Compose the live admission signals (interactive work / model idle / resource headroom). */
	getSignals: () => Promise<BackgroundEvalRunnerSignals>;
	/** Durable lease checkpoint (survives restart). */
	loadCheckpoint: () => Promise<BackgroundEvalLease[]>;
	saveCheckpoint: (leases: readonly BackgroundEvalLease[]) => Promise<void>;
	/** Optional observability hook forwarded to the service. */
	onTick?: BackgroundEvalServiceDeps["onTick"];
}

export function createBackgroundEvalServiceDeps(atoms: BackgroundEvalRuntimeAtoms): BackgroundEvalServiceDeps {
	// Bridge lease identity → the session's workspace path (the scope every task-session call needs). Populated on
	// start; a recovered lease (not in the map) falls back to resolving its path from workspaceId.
	const runIdToWorkspace = new Map<string, { workspacePath: string; workspaceId: string | null }>();

	const resolveWorkspacePath = async (lease: BackgroundEvalLease): Promise<string | null> => {
		const known = runIdToWorkspace.get(lease.runId);
		if (known) {
			return known.workspacePath;
		}
		return lease.workspaceId ? await atoms.resolveWorkspacePath(lease.workspaceId) : null;
	};

	return {
		tickIntervalMs: atoms.tickIntervalMs,
		...(atoms.onTick ? { onTick: atoms.onTick } : {}),
		cleanupProject: async (lease: BackgroundEvalLease, _cause: BackgroundEvalCleanupCause): Promise<void> => {
			const workspacePath = await resolveWorkspacePath(lease);
			if (!workspacePath) {
				return; // nothing to delete (already gone / unresolvable)
			}
			await atoms.removeWorkspace(workspacePath);
			runIdToWorkspace.delete(lease.runId);
		},
		runner: {
			maxConcurrentEvals: atoms.maxConcurrentEvals,
			now: atoms.now,
			getSignals: atoms.getSignals,
			selectNextProject: atoms.selectScenario,
			loadCheckpoint: atoms.loadCheckpoint,
			saveCheckpoint: atoms.saveCheckpoint,
			startRun: async (scenarioId: string) => {
				const { workspacePath, workspaceId } = await atoms.scaffold(scenarioId);
				const { taskId } = await atoms.startSession({ scenarioId, workspacePath, workspaceId });
				runIdToWorkspace.set(taskId, { workspacePath, workspaceId });
				return { runId: taskId, workspaceId, deadlineAt: atoms.now() + atoms.maxRunMs };
			},
			isRunActive: async (lease: BackgroundEvalLease): Promise<boolean> => {
				const workspacePath = await resolveWorkspacePath(lease);
				if (!workspacePath) {
					return false; // unresolvable ⇒ treat as terminal so the runner reaps it
				}
				const state = await atoms.getSessionState({ taskId: lease.runId, workspacePath });
				return isActiveWorkSessionState(state);
			},
			stopRun: async (lease: BackgroundEvalLease): Promise<void> => {
				const workspacePath = await resolveWorkspacePath(lease);
				if (!workspacePath) {
					return;
				}
				await atoms.stopSession({ taskId: lease.runId, workspacePath });
			},
		},
	};
}
