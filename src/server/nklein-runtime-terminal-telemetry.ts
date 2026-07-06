import { loadRuntimeConfig } from "../config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { deriveTaskFitnessRecord } from "../nklein-agent/task-fitness-recording";
import { loadWorkspaceState } from "../state/workspace-state";
import { recordTaskFitnessOutcome } from "../telemetry/fitness-table-store";
import { recordKnowledgeToolUsageObservation } from "../telemetry/knowledge-tool-usage-stats";
import { persistModelBehaviorOutcome } from "../telemetry/model-behavior-profile-store";
import { recordModelPerformanceObservation } from "../telemetry/model-performance-stats";
import type { RuntimeTrpcWorkspaceScope } from "../trpc/app-router";
import { createBoundedDedupSet } from "./bounded-dedup-set";

/**
 * Process-wide guard so a terminal run folds into the §5.AB fitness store AT MOST once even if its summary is observed
 * more than once. Module-level (not per-server) — identical to the original `runtime-server.ts` singleton it replaced.
 */
const recordedTerminalRuns = createBoundedDedupSet(5000);

export interface RuntimeTerminalTelemetryDeps {
	warn: (message: string) => void;
}

export interface RuntimeTerminalTelemetryRecorders {
	/** Fold a terminal summary into model-performance stats + the §5.AB fitness store + §5.AA behavior profile. */
	recordModelPerformance(scope: RuntimeTrpcWorkspaceScope, summary: RuntimeTaskSessionSummary): void;
	/** Fold a terminal summary into the knowledge-tool-usage stats. */
	recordKnowledgeToolUsage(scope: RuntimeTrpcWorkspaceScope, summary: RuntimeTaskSessionSummary): void;
}

/**
 * §5.U: the terminal-summary telemetry recorders, lifted verbatim out of the `createRuntimeServer` closure. Both
 * recorders share the identical "load the workspace state + runtime config, find this task's card" preamble
 * (`loadScopeCard`); each is fire-and-forget and swallows its own errors through `deps.warn` so telemetry never
 * breaks the session loop.
 */
export function createRuntimeTerminalTelemetryRecorders(
	deps: RuntimeTerminalTelemetryDeps,
): RuntimeTerminalTelemetryRecorders {
	async function loadScopeCard(scope: RuntimeTrpcWorkspaceScope, taskId: string) {
		const [workspaceState, runtimeConfig] = await Promise.all([
			loadWorkspaceState(scope.workspacePath).catch(() => null),
			loadRuntimeConfig(scope.workspacePath).catch(() => null),
		]);
		const cards = workspaceState?.board.columns.flatMap((column) => column.cards) ?? [];
		const card = cards.find((candidate) => candidate.id === taskId) ?? null;
		return { card, runtimeConfig };
	}

	const recordModelPerformance = (scope: RuntimeTrpcWorkspaceScope, summary: RuntimeTaskSessionSummary): void => {
		void (async () => {
			const { card, runtimeConfig } = await loadScopeCard(scope, summary.taskId);
			await recordModelPerformanceObservation({
				workspaceId: scope.workspaceId,
				workspacePath: scope.workspacePath,
				card,
				runtimeConfig,
				summary,
			});
			// §5.AB fitness store: fold this terminal outcome into its (model × role × difficulty) cell (best-effort,
			// serialized write). Returns null + skips for synthetic / non-terminal / model-less sessions.
			const fitnessRecord = deriveTaskFitnessRecord({ summary, card });
			const terminalRunKey = `${summary.taskId}|${summary.startedAt ?? 0}`;
			if (fitnessRecord && !recordedTerminalRuns.has(terminalRunKey)) {
				recordedTerminalRuns.remember(terminalRunKey);
				await recordTaskFitnessOutcome(fitnessRecord.key, fitnessRecord.outcome).catch(() => {});
				// §5.AA ModelBehaviorProfile: also fold the coarse terminal outcome into the model's cross-session
				// reliability profile (successRate + retry budget). Append-only ⇒ concurrency-safe. Best-effort.
				await persistModelBehaviorOutcome(fitnessRecord.key.modelKey, {
					kind: fitnessRecord.outcome.success ? "success" : "other_failure",
				}).catch(() => {});
			}
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not record model performance for ${summary.taskId}: ${message}`);
		});
	};

	const recordKnowledgeToolUsage = (scope: RuntimeTrpcWorkspaceScope, summary: RuntimeTaskSessionSummary): void => {
		void (async () => {
			const { card, runtimeConfig } = await loadScopeCard(scope, summary.taskId);
			await recordKnowledgeToolUsageObservation({
				workspaceId: scope.workspaceId,
				workspacePath: scope.workspacePath,
				card,
				runtimeConfig,
				summary,
			});
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not record knowledge tool usage for ${summary.taskId}: ${message}`);
		});
	};

	return { recordModelPerformance, recordKnowledgeToolUsage };
}
