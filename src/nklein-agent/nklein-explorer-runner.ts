/**
 * F11.2j explorer-subagent runner — the bounded `::explore` session (§5.U sibling of the plan-critique runner).
 *
 * One worker `explore` call = one bounded, read-only session on the SAME model with a FRESH context window (the
 * FastContext win is the offloaded window, not a different model — a smaller dedicated explorer model is a later
 * routing optimization). Owns the per-run query budget; every degraded path resolves to null so exploration never
 * blocks the worker (the tool tells it to fall back to its own retrieval).
 */

import { isHomeAgentSessionId } from "../core/home-agent-session";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { type AgentSandboxManager, createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import {
	buildExplorerSeedPrompt,
	type NKleinExplorerQueryHandler,
	type NKleinExplorerResult,
} from "./nklein-explorer-tool";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import type { SecondarySessionHarness } from "./nklein-secondary-session-harness";
import { createSessionId } from "./nklein-session-state";

const EXPLORER_NUDGE_PROMPT =
	"Submit your findings now by calling the submit_citations tool with your answer and citations. Do not reply in prose.";

/**
 * Classify an explore-query failure as a timeout vs a generic error. Pure, so the distinction the observation
 * carries is testable without spinning a real explorer session. A timeout is worth telling apart because "explore
 * keeps timing out" is an actionable pattern (budget/model too slow), where a one-off error is noise.
 */
export function classifyExploreFailure(message: string): "timeout" | "error" {
	return /timeout|timed out|aborted/i.test(message) ? "timeout" : "error";
}

export interface ExplorerRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null;
	getPauseController(): NKleinPauseController;
	getHarness(): SecondarySessionHarness;
	getBaseRef(taskId: string): string | null;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string): Promise<unknown>;
	defaultTimeoutMs: number;
	maxNudges: number;
	/** Per-run explore-query budget (each query is one bounded read-only session on the task's endpoint). */
	runBudget: number;
}

export interface ExplorerRunner {
	/**
	 * Build the worker-side `explore` executor for a session — or undefined for synthetic/home sessions (an
	 * `::explore` session must never recurse into another explorer). Enforces the per-run budget; every failure
	 * degrades to null (the tool renders an honest fallback message).
	 */
	buildExploreHandler(taskId: string, projectRepoPath: string): NKleinExplorerQueryHandler | undefined;
}

export function createExplorerRunner(deps: ExplorerRunnerDeps): ExplorerRunner {
	let exploreQueriesUsed = 0;

	async function runExplorerSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		question: string;
	}): Promise<NKleinExplorerResult | null> {
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			return null;
		}
		const workerLaunch = deps.getLaunchConfig(input.taskId) ?? null;
		if (!workerLaunch?.providerId || !workerLaunch.modelId) {
			return null;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...workerLaunch,
			workspaceRoot: input.projectRepoPath,
		};
		const explorerTaskId = `${input.taskId}::explore`;
		return deps.getHarness().runBracketed(
			{
				syntheticTaskId: explorerTaskId,
				projectRepoPath: input.projectRepoPath,
				baseRef: input.baseRef,
				defaultTimeoutMs: deps.defaultTimeoutMs,
				errorLabel: "Explorer session",
			},
			async ({ workspace, deadlineMs, runBoundedTurn }) => {
				let findings: NKleinExplorerResult | null = null;
				await runBoundedTurn(
					deps.startRuntimeSession({
						taskId: explorerTaskId,
						cwd: workspace.workdir,
						workspaceRoot: input.projectRepoPath,
						prompt: buildExplorerSeedPrompt(input.question),
						launchConfig,
						contextScope: "minimal",
						onExplorerCitationsSubmitted: (result) => {
							findings = result;
						},
						toolExecutors: createAgentSandboxToolExecutors(sandboxManager, explorerTaskId, {
							pauseController: deps.getPauseController(),
						}),
						extraTools: createAgentSandboxExtraTools(sandboxManager, explorerTaskId, {
							sessionId: createSessionId(explorerTaskId),
							contextWindow: launchConfig.contextWindow ?? undefined,
							maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
						}),
					}),
				);
				for (let nudge = 0; findings === null && nudge < deps.maxNudges && Date.now() < deadlineMs; nudge += 1) {
					await runBoundedTurn(deps.sendTaskSessionInput(explorerTaskId, EXPLORER_NUDGE_PROMPT));
				}
				return findings;
			},
		);
	}

	function buildExploreHandler(taskId: string, projectRepoPath: string): NKleinExplorerQueryHandler | undefined {
		if (isDerivedTaskSessionId(taskId) || isHomeAgentSessionId(taskId)) {
			return undefined;
		}
		return async (question) => {
			if (exploreQueriesUsed >= deps.runBudget) {
				return null;
			}
			if (!deps.getAgentSandboxManager()) {
				return null;
			}
			exploreQueriesUsed += 1;
			return await runExplorerSession({
				taskId,
				projectRepoPath,
				baseRef: deps.getBaseRef(taskId) ?? "HEAD",
				question,
			}).catch((error: unknown) => {
				// P21.7 follow-up: the return stays null (the tool renders an honest fallback — nothing to salvage
				// from a read-only helper query), but the FAILURE was previously swallowed silently, so a timed-out
				// explore looked identical to one that legitimately found nothing. Record the classified reason so
				// "explore keeps timing out" is visible instead of invisible — the record-the-decline rule applied
				// to a helper path.
				const message = error instanceof Error ? error.message : String(error);
				const reason = classifyExploreFailure(message);
				try {
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Explore query for ${taskId} failed: ${reason === "timeout" ? "timed out" : "errored"}.`,
						taskId,
						metadata: { category: "explore_query_failed", reason },
					});
				} catch {
					// Telemetry must never break the explore fallback.
				}
				return null;
			});
		};
	}

	return { buildExploreHandler };
}
