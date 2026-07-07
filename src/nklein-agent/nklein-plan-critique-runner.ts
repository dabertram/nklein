import type { PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { type AgentSandboxManager, createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import {
	buildPlanCritiqueSeedPrompt,
	type NKleinPlanCritiqueRequestHandler,
	type NKleinPlanCritiqueResult,
} from "./nklein-plan-critique-tool";
import { pickDiverseReviewerModel } from "./nklein-reviewer-model-selection";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import type { SecondarySessionHarness } from "./nklein-secondary-session-harness";
import { createSessionId } from "./nklein-session-state";

const PLAN_CRITIQUE_NUDGE_PROMPT =
	"Submit your critique now by calling the submit_plan_critique tool with a `proceed` or `revise` verdict. Do not reply in prose.";

export interface PlanCritiqueRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null;
	/** The §5.AQ warmth ledger (read by the diverse-critic auto-pick). */
	getShellKeyByModelId(): Map<string, PromptWarmthLedgerEntry>;
	getPauseController(): NKleinPauseController;
	/** The shared secondary-session harness (bounded sandbox session + always-teardown). */
	getHarness(): SecondarySessionHarness;
	/** Probe a lineage-diverse critic BEFORE spending budget (the service's `pickDiverseEscalationModel`). */
	pickEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null>;
	getBaseRef(taskId: string): string | null;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string): Promise<unknown>;
	defaultTimeoutMs: number;
	maxNudges: number;
	/** W4.3 per-run critique budget (deliberation is rare by design). */
	runBudget: number;
}

export interface PlanCritiqueRunner {
	/**
	 * Build the `requestPlanCritique` executor for a session's decompose tool — or undefined for synthetic sessions
	 * (`::review`/`::plan-critique`/`::acceptance` must never recurse into a critique). Enforces the per-run count
	 * budget; failures and empty verdicts degrade to null (proceed) so a critique never blocks.
	 */
	buildRequestHandler(taskId: string, projectRepoPath: string): NKleinPlanCritiqueRequestHandler | undefined;
	runPlanCritiqueSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		timeoutMs?: number;
		critic?: { providerId: string; modelId: string } | null;
	}): Promise<NKleinPlanCritiqueResult | null>;
}

/**
 * §5.U: the W4.3 plan-critique session, extracted verbatim from InMemoryNKleinTaskSessionService as a standalone
 * harness-based runner (the sibling of the second-opinion review runner). One bounded DIVERSE-CRITIC turn over a
 * validated decomposition plan BEFORE the cascade starts; owns the per-run critique-count budget. A critique never
 * blocks a decomposition — every degraded path resolves to null (proceed).
 */
export function createPlanCritiqueRunner(deps: PlanCritiqueRunnerDeps): PlanCritiqueRunner {
	/** W4.3 per-run critique budget: deliberation is rare by design (high-stakes × unclean quality only). */
	let planCritiqueRunsUsed = 0;

	function buildRequestHandler(taskId: string, projectRepoPath: string): NKleinPlanCritiqueRequestHandler | undefined {
		if (isDerivedTaskSessionId(taskId) || isHomeAgentSessionId(taskId)) {
			return undefined;
		}
		return async (request) => {
			if (planCritiqueRunsUsed >= deps.runBudget) {
				return null;
			}
			if (!deps.getAgentSandboxManager()) {
				return null;
			}
			// Adversarial-review fix (2026-07-02): probe for the diverse critic BEFORE spending budget — degraded
			// no-op attempts (single-model fleets) were burning the whole budget without ever running a session,
			// permanently self-disabling deliberation for the service lifetime. And the waiver is SURFACED here
			// (the shared trigger's waiver path is unreachable from the tool seam, which only knows an executor
			// exists — see the decompose tool's gate comment).
			const critic = await deps.pickEscalationModel(taskId).catch(() => null);
			if (!critic) {
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: `Plan-critique diversity waived for ${request.slug}: no lineage-diverse capable critic is loaded — proceeding without deliberation (a same-family debate is correlated noise).`,
					taskId,
					metadata: { category: "plan_critique_diversity_waived", planSlug: request.slug },
				});
				return null;
			}
			planCritiqueRunsUsed += 1;
			return await runPlanCritiqueSession({
				taskId,
				projectRepoPath,
				baseRef: deps.getBaseRef(taskId) ?? "HEAD",
				seedPrompt: buildPlanCritiqueSeedPrompt(request),
				critic,
			}).catch(() => null);
		};
	}

	async function runPlanCritiqueSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		timeoutMs?: number;
		critic?: { providerId: string; modelId: string } | null;
	}): Promise<NKleinPlanCritiqueResult | null> {
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			return null;
		}
		const architectLaunch = deps.getLaunchConfig(input.taskId) ?? null;
		if (!architectLaunch?.providerId || !architectLaunch.modelId) {
			return null;
		}
		// The whole point is a DIVERSE second perspective — degrade to null (proceed) without one.
		const critic =
			input.critic ??
			(await pickDiverseReviewerModel(architectLaunch, input.taskId, "plan-critique", {
				lastShellKeyByModel: deps.getShellKeyByModelId(),
			}).catch(() => null));
		if (!critic) {
			return null;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...architectLaunch,
			providerId: critic.providerId,
			modelId: critic.modelId,
			workspaceRoot: input.projectRepoPath,
		};
		const critiqueTaskId = `${input.taskId}::plan-critique`;
		// No primaryTaskId ⇒ the harness checks out `baseRef` (the source card's base) directly, not the delivered tree.
		return deps.getHarness().runBracketed(
			{
				syntheticTaskId: critiqueTaskId,
				projectRepoPath: input.projectRepoPath,
				baseRef: input.baseRef,
				timeoutMs: input.timeoutMs,
				defaultTimeoutMs: deps.defaultTimeoutMs,
				errorLabel: "Plan-critique session",
			},
			async ({ workspace, deadlineMs, runBoundedTurn }) => {
				let verdict: NKleinPlanCritiqueResult | null = null;
				await runBoundedTurn(
					deps.startRuntimeSession({
						taskId: critiqueTaskId,
						cwd: workspace.workdir,
						workspaceRoot: input.projectRepoPath,
						prompt: input.seedPrompt,
						launchConfig,
						contextScope: "minimal",
						onPlanCritiqueSubmitted: (result) => {
							verdict = result;
						},
						toolExecutors: createAgentSandboxToolExecutors(sandboxManager, critiqueTaskId, {
							pauseController: deps.getPauseController(),
						}),
						extraTools: createAgentSandboxExtraTools(sandboxManager, critiqueTaskId, {
							sessionId: createSessionId(critiqueTaskId),
							contextWindow: launchConfig.contextWindow ?? undefined,
							maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
						}),
					}),
				);
				for (let nudge = 0; verdict === null && nudge < deps.maxNudges && Date.now() < deadlineMs; nudge += 1) {
					await runBoundedTurn(deps.sendTaskSessionInput(critiqueTaskId, PLAN_CRITIQUE_NUDGE_PROMPT));
				}
				return verdict;
			},
		);
	}

	return { buildRequestHandler, runPlanCritiqueSession };
}
