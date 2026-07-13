import { loadRuntimeConfig } from "../config/runtime-config";
import { type AgentTransitionEvent, buildTransitionEvent } from "../core/agent-attempt-ledger";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";
import { deriveTaskFitnessRecord } from "../nklein-agent/task-fitness-recording";
import { loadWorkspaceState } from "../state/workspace-state";
import { recordTaskFitnessOutcome } from "../telemetry/fitness-table-store";
import { didTaskConsultKnowledge, recordKnowledgeToolUsageObservation } from "../telemetry/knowledge-tool-usage-stats";
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
				// F1.1: fold whether the run consulted knowledge tools into the fitness cell. The observation log is
				// written per tool hook DURING the run, so it is complete here; null (no observations at all for the
				// task) stays "unknown" and advances neither tally.
				const usedKnowledgeTools = await didTaskConsultKnowledge(summary.taskId).catch(() => null);
				await recordTaskFitnessOutcome(fitnessRecord.key, {
					...fitnessRecord.outcome,
					usedKnowledgeTools,
				}).catch(() => {});
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

/**
 * §5.AF: record task-session STATE transitions as ledger `transition` events — the controller-visible state stream
 * (queued→running→awaiting_review→…) that the §5.AG escalation report + phase-ladder projections read. Created per
 * workspace subscription (the returned recorder closes over its own last-state map, so parallel workspaces never
 * cross-talk); appends best-effort (a ledger failure never touches the session loop). Only CHANGES are recorded —
 * summaries re-emitted in the same state (heartbeats, activity updates) are skipped.
 */
export function createSessionTransitionRecorder(
	appendEvent: (event: AgentTransitionEvent) => Promise<unknown>,
): (scope: RuntimeTrpcWorkspaceScope, summary: RuntimeTaskSessionSummary) => void {
	const lastStateByTaskId = new Map<string, string>();
	return (scope, summary) => {
		const previous = lastStateByTaskId.get(summary.taskId) ?? null;
		if (previous === summary.state) {
			return;
		}
		lastStateByTaskId.set(summary.taskId, summary.state);
		if (lastStateByTaskId.size > 5000) {
			// Bounded: drop the oldest tracked task (Map preserves insertion order) so a long-lived server can't grow it.
			const oldest = lastStateByTaskId.keys().next().value;
			if (oldest !== undefined) {
				lastStateByTaskId.delete(oldest);
			}
		}
		void appendEvent(
			buildTransitionEvent({
				workflowId: summary.taskId,
				taskId: summary.taskId,
				workspacePathHash: hashWorkspacePathForLedger(scope.workspacePath),
				from: previous,
				to: summary.state,
				reason: summary.reviewReason ?? summary.warningMessage ?? null,
			}),
		).catch(() => {});
	};
}
