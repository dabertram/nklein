import type { RuntimeTaskSessionState } from "../core/api-contract.js";
import { createRailOutcomeLog } from "../core/background-eval-controls.js";
import type { BackgroundEvalLease, BackgroundEvalRunnerSignals } from "../core/background-eval-runner.js";
import {
	loadBackgroundEvalRunnerLeases,
	saveBackgroundEvalRunnerLeases,
} from "../state/background-eval-runner-store.js";
import { loadRailControlSettings, saveRailControlSettings } from "../state/rail-control-store.js";
import { createBackgroundEvalServiceDeps } from "./background-eval-runtime-deps.js";
import { type BackgroundEvalService, createBackgroundEvalService } from "./background-eval-service.js";
import { createRailControlCoordinator, type RailControlCoordinator } from "./rail-control-service.js";

/**
 * F1.31b (§5.AI) — wire the background-eval RAIL into the runtime: assemble the F1.31 service from the runtime's own
 * task-session + workspace operations (INJECTED, so this is testable) and bind it to the F1.35 control coordinator. The
 * whole thing is gated by `enabled` (`NKLEIN_EVAL_RAIL`, default OFF): when off, `service` is null and the coordinator
 * is the service-less fallback (controls persist, status reads disabled/idle — byte-identical production path). When on,
 * the operator's persisted enable/pause intent drives the service, and each admitted tick scaffolds a throwaway
 * dev-test project, starts a NON-BLOCKING sandboxed eval session, and reaps + deletes it by deadline / terminal state.
 *
 * Scenario choice is a simple round-robin over the injected preset ids until F1.32's fitness-aware picker is wired in.
 */

export interface BackgroundEvalRailWiringDeps {
	/** `NKLEIN_EVAL_RAIL` — when false, no service is hosted (production default). */
	enabled: boolean;
	now: () => number;
	/** Admission cap for concurrent background evals. */
	maxConcurrentEvals: number;
	/** Tick cadence + the run deadline horizon. */
	tickIntervalMs: number;
	maxRunMs: number;
	/** The preset scenario ids to rotate through (round-robin). */
	scenarioIds: readonly string[];
	/**
	 * F1.32b: the fitness-aware target picker — returns the next (scenario, model) or null when nothing is
	 * eligible. When present it REPLACES the round-robin scenario pick, and the chosen model is threaded into
	 * `startEvalSession` (null model ⇒ the workspace default, the pre-F1.32b behavior).
	 */
	selectTarget?: () => Promise<{ scenarioId: string; modelId: string | null } | null>;
	/** Scaffold a throwaway dev-test project for a scenario id → its host path + registered workspace id. */
	scaffoldEvalWorkspace: (scenarioId: string) => Promise<{ workspacePath: string; workspaceId: string | null }>;
	/** Start a NON-BLOCKING sandboxed eval session for a scaffolded project (must not wait for it to finish). */
	startEvalSession: (input: {
		taskId: string;
		scenarioId: string;
		workspacePath: string;
		workspaceId: string | null;
		/** F1.32b: the picker's model for this run (null ⇒ the workspace default). */
		modelId: string | null;
	}) => Promise<void>;
	/** The current session state (null when unknown/gone). */
	getEvalSessionState: (input: { taskId: string; workspacePath: string }) => Promise<RuntimeTaskSessionState | null>;
	/** Force-stop an overrunning eval session. */
	stopEvalSession: (input: { taskId: string; workspacePath: string }) => Promise<void>;
	/** Delete a throwaway workspace directory. */
	removeWorkspace: (workspacePath: string) => Promise<void>;
	/** Resolve a workspace id → path (for leases recovered after a restart). */
	resolveWorkspacePathById: (workspaceId: string) => Promise<string | null> | string | null;
	/** Compose the live admission signals from the runtime's current state. */
	getSignals: () => Promise<BackgroundEvalRunnerSignals>;
	/** Injected for tests; default to the shared on-disk stores. */
	loadCheckpoint?: () => Promise<Awaited<ReturnType<typeof loadBackgroundEvalRunnerLeases>>>;
	saveCheckpoint?: (leases: readonly BackgroundEvalLease[]) => Promise<void>;
	loadSettings?: typeof loadRailControlSettings;
	saveSettings?: typeof saveRailControlSettings;
	/** Best-effort logger for wiring-time faults. */
	warn?: (message: string) => void;
}

export interface BackgroundEvalRailWiring {
	coordinator: RailControlCoordinator;
	service: BackgroundEvalService | null;
	/** Boot hook: start the service iff the operator's persisted intent is active. */
	startAtBoot: () => Promise<void>;
	/** Shutdown hook: stop the service (idempotent; no-op when service-less). */
	stop: () => Promise<void>;
}

/** A deterministic round-robin scenario picker over a fixed id list (empty ⇒ nothing to run). */
function createRoundRobinScenarioPicker(scenarioIds: readonly string[]): () => string | null {
	let cursor = 0;
	return () => {
		if (scenarioIds.length === 0) {
			return null;
		}
		const id = scenarioIds[cursor % scenarioIds.length] ?? null;
		cursor += 1;
		return id;
	};
}

export function wireBackgroundEvalRail(deps: BackgroundEvalRailWiringDeps): BackgroundEvalRailWiring {
	const outcomeLog = createRailOutcomeLog();
	const loadSettings = deps.loadSettings ?? loadRailControlSettings;
	const saveSettings = deps.saveSettings ?? saveRailControlSettings;

	let service: BackgroundEvalService | null = null;
	// F1.32b: the model the target picker chose for the tick's imminent startRun (see startSession).
	let pendingModelId: string | null = null;
	if (deps.enabled) {
		const serviceDeps = createBackgroundEvalServiceDeps({
			now: deps.now,
			maxConcurrentEvals: deps.maxConcurrentEvals,
			tickIntervalMs: deps.tickIntervalMs,
			maxRunMs: deps.maxRunMs,
			scaffold: deps.scaffoldEvalWorkspace,
			startSession: async ({ scenarioId, workspacePath, workspaceId }) => {
				// Synthesize the run's task id (the join key across the lease lifecycle), mirroring the CLI's
				// `devtest-<scenario>-<ts>` shape; the tick cadence (≥1 min) keeps it unique per run.
				const taskId = `devtest-${scenarioId}-${deps.now()}`;
				// F1.32b: consume the model the picker latched for this tick (selectNextProject → startRun run
				// serially within one runner tick, so the one-slot latch is race-free).
				const modelId = pendingModelId;
				pendingModelId = null;
				await deps.startEvalSession({ taskId, scenarioId, workspacePath, workspaceId, modelId });
				return { taskId };
			},
			getSessionState: deps.getEvalSessionState,
			stopSession: deps.stopEvalSession,
			removeWorkspace: deps.removeWorkspace,
			resolveWorkspacePath: async (workspaceId) => await deps.resolveWorkspacePathById(workspaceId),
			selectScenario: deps.selectTarget
				? async () => {
						const target = await deps.selectTarget?.();
						pendingModelId = target?.modelId ?? null;
						return target?.scenarioId ?? null;
					}
				: createRoundRobinScenarioPicker(deps.scenarioIds),
			getSignals: deps.getSignals,
			loadCheckpoint: deps.loadCheckpoint ?? (() => loadBackgroundEvalRunnerLeases()),
			saveCheckpoint: deps.saveCheckpoint ?? ((leases) => saveBackgroundEvalRunnerLeases(leases)),
			onTick: (outcome) => {
				outcomeLog.record({
					at: deps.now(),
					reason: outcome.reason,
					admittedProject: outcome.admitted?.project ?? null,
					reapedCount: outcome.reaped.length,
				});
			},
		});
		service = createBackgroundEvalService(serviceDeps);
	}

	const coordinator = createRailControlCoordinator({ loadSettings, saveSettings, service, outcomeLog });

	return {
		coordinator,
		service,
		startAtBoot: async () => {
			try {
				await coordinator.syncServiceToPersistedIntent();
			} catch (error) {
				deps.warn?.(
					`Background eval rail boot sync failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		stop: async () => {
			if (service) {
				await service.stop();
			}
		},
	};
}
