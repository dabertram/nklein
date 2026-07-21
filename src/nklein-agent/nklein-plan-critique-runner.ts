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
	type NKleinClarifyTurnHandler,
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
	sendTaskSessionInput(taskId: string, prompt: string, admissionParentTaskId: string): Promise<unknown>;
	defaultTimeoutMs: number;
	maxNudges: number;
}

export interface PlanCritiqueRunner {
	/**
	 * Build the `requestPlanCritique` executor for a session's decompose tool — or undefined for synthetic sessions
	 * (`::review`/`::plan-critique`/`::acceptance` must never recurse into a critique). Enforces the per-run count
	 * budget; failures and empty verdicts degrade to null (proceed) so a critique never blocks.
	 */
	buildRequestHandler(taskId: string, projectRepoPath: string): NKleinPlanCritiqueRequestHandler | undefined;
	/** Trusted continuation context retained when a rejected architect turn dies before it can revise in-session. */
	getPendingRevisionPrompt(taskId: string): string | null;
	runPlanCritiqueSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		timeoutMs?: number;
		critic?: { providerId: string; modelId: string } | null;
	}): Promise<NKleinPlanCritiqueResult | null>;
	/** F1.3e — the bounded clarify-turn executor (see the factory doc), or undefined for synthetic sessions. */
	buildClarifyTurnHandler(taskId: string, projectRepoPath: string): NKleinClarifyTurnHandler | undefined;
}

/** F1.3e per-run cap on clarify turns (each auto-clarify round is 1-2 bounded sessions). */
const CLARIFY_TURN_RUN_BUDGET = 6;

/**
 * §5.U: the W4.3 plan-critique session, extracted verbatim from InMemoryNKleinTaskSessionService as a standalone
 * harness-based runner (the sibling of the second-opinion review runner). One bounded DIVERSE-CRITIC turn over a
 * validated decomposition plan BEFORE the cascade starts. Loaded-model availability + admission define capacity;
 * a critique never blocks a decomposition — every degraded path resolves to null (proceed).
 */
export function createPlanCritiqueRunner(deps: PlanCritiqueRunnerDeps): PlanCritiqueRunner {
	/** F1.3e per-run clarify-turn budget: each auto-clarify round costs 1-2 bounded sessions; cap the total. */
	let clarifyTurnsUsed = 0;
	// A critic rejection is returned as a tool error so the architect can repair it immediately. Some local models end
	// the turn at that boundary; the dead-card recovery then creates a fresh SDK session. Keep the critique lineage in
	// the service-owned runner so that restart receives the exact feedback and candidate 2 cannot masquerade as a new
	// candidate 1 merely because session-local tool state was rebuilt.
	const critiqueAttemptsByPlanKey = new Map<string, number>();
	const pendingRevisionSlugByTaskId = new Map<string, string>();
	const pendingRevisionPromptByTaskId = new Map<string, string>();

	function revisionPrompt(slug: string, attempt: number, feedback: string): string {
		return [
			"[!Klein plan-critique continuation — trusted runtime context]",
			`The independent critic rejected candidate ${attempt}/2 for plan slug "${slug}" before any graph was materialized.`,
			"Resume the revision; do not restart from the original decomposition assumptions and do not change the plan slug.",
			"Rebuild the candidate from this exact feedback, then submit it for the mandatory fresh verdict:",
			feedback,
		].join("\n");
	}

	function getPendingRevisionPrompt(taskId: string): string | null {
		return pendingRevisionPromptByTaskId.get(taskId) ?? null;
	}

	function buildRequestHandler(taskId: string, projectRepoPath: string): NKleinPlanCritiqueRequestHandler | undefined {
		if (isDerivedTaskSessionId(taskId) || isHomeAgentSessionId(taskId)) {
			return undefined;
		}
		return async (request) => {
			if (!deps.getAgentSandboxManager()) {
				return null;
			}
			const expectedSlug = pendingRevisionSlugByTaskId.get(taskId);
			const planSlug = expectedSlug ?? request.slug;
			const planKey = `${taskId}:${planSlug}`;
			const critiqueAttempt = (critiqueAttemptsByPlanKey.get(planKey) ?? 0) + 1;
			if (expectedSlug && request.slug !== expectedSlug) {
				critiqueAttemptsByPlanKey.set(planKey, critiqueAttempt);
				const feedback = `Keep the stable plan slug "${expectedSlug}". Candidate ${critiqueAttempt} changed it to "${request.slug}", which would discard the prior critic lineage and cannot be accepted.`;
				return {
					verdict: "revise",
					summary: "The revised candidate changed the stable plan slug.",
					feedback,
					critiqueAttempt,
				};
			}
			// Probe for the diverse critic before starting the bracketed session. Availability + the shared admission gate
			// define review capacity; a fixed service-lifetime count silently disabled critique after unrelated plans.
			// The waiver is SURFACED here
			// (the shared trigger's waiver path is unreachable from the tool seam, which only knows an executor
			// exists — see the decompose tool's gate comment).
			const critic = await deps.pickEscalationModel(taskId).catch(() => null);
			if (!critic) {
				recordSelfObservation({
					signal: "custom",
					severity: expectedSlug ? "warning" : "info",
					message: expectedSlug
						? `Plan-critique revision for ${request.slug} has no lineage-diverse critic — failing closed because its prior candidate was rejected.`
						: `Plan-critique diversity waived for ${request.slug}: no lineage-diverse capable critic is loaded — proceeding without deliberation (a same-family debate is correlated noise).`,
					taskId,
					metadata: {
						category: expectedSlug ? "plan_critique_revision_unavailable" : "plan_critique_diversity_waived",
						planSlug: request.slug,
					},
				});
				if (!expectedSlug) return null;
				critiqueAttemptsByPlanKey.set(planKey, critiqueAttempt);
				return {
					verdict: "revise",
					summary: "The required fresh verdict was unavailable.",
					feedback:
						"The prior candidate was rejected, so this revision cannot use the ordinary no-critic waiver. Keep the graph unmaterialized and escalate to another loaded lineage-diverse critic.",
					critiqueAttempt,
				};
			}
			const result = await runPlanCritiqueSession({
				taskId,
				projectRepoPath,
				baseRef: deps.getBaseRef(taskId) ?? "HEAD",
				seedPrompt: buildPlanCritiqueSeedPrompt(request),
				critic,
			}).catch(() => null);
			if (!result) {
				if (!expectedSlug) return null;
				critiqueAttemptsByPlanKey.set(planKey, critiqueAttempt);
				return {
					verdict: "revise",
					summary: "The required fresh critic turn returned no verdict.",
					feedback:
						"The prior candidate was rejected and this revision received no fresh verdict. Keep the graph unmaterialized and retry with another loaded lineage-diverse critic.",
					critiqueAttempt,
				};
			}
			critiqueAttemptsByPlanKey.set(planKey, critiqueAttempt);
			if (result.verdict === "revise" && result.feedback) {
				pendingRevisionSlugByTaskId.set(taskId, planSlug);
				pendingRevisionPromptByTaskId.set(taskId, revisionPrompt(planSlug, critiqueAttempt, result.feedback));
			} else if (result.verdict === "proceed") {
				pendingRevisionSlugByTaskId.delete(taskId);
				pendingRevisionPromptByTaskId.delete(taskId);
			}
			return { ...result, critiqueAttempt };
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
						admissionParentTaskId: input.taskId,
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
					await runBoundedTurn(
						deps.sendTaskSessionInput(critiqueTaskId, PLAN_CRITIQUE_NUDGE_PROMPT, input.taskId),
					);
				}
				return verdict;
			},
		);
	}

	/**
	 * F1.3e — build the bounded clarify-turn executor for a session's decompose tool (undefined for synthetic
	 * sessions, mirroring the critique handler). `propose` turns run on the ARCHITECT's own model; `review` turns
	 * take the default lineage-diverse path inside `runPlanCritiqueSession`. Shares the session machinery but has
	 * its OWN per-run budget; every degraded path resolves to null (keep the question open, never block).
	 */
	function buildClarifyTurnHandler(taskId: string, projectRepoPath: string): NKleinClarifyTurnHandler | undefined {
		if (isDerivedTaskSessionId(taskId) || isHomeAgentSessionId(taskId)) {
			return undefined;
		}
		return async (input) => {
			if (clarifyTurnsUsed >= CLARIFY_TURN_RUN_BUDGET) {
				return null;
			}
			if (!deps.getAgentSandboxManager()) {
				return null;
			}
			const architectLaunch = deps.getLaunchConfig(taskId) ?? null;
			if (!architectLaunch?.providerId || !architectLaunch.modelId) {
				return null;
			}
			clarifyTurnsUsed += 1;
			return await runPlanCritiqueSession({
				taskId,
				projectRepoPath,
				baseRef: deps.getBaseRef(taskId) ?? "HEAD",
				seedPrompt: input.seedPrompt,
				// propose = the architect's own model; review = the diverse §5.K pick (the session's default path).
				critic:
					input.role === "propose"
						? { providerId: architectLaunch.providerId, modelId: architectLaunch.modelId }
						: undefined,
			}).catch(() => null);
		};
	}

	return { buildRequestHandler, getPendingRevisionPrompt, buildClarifyTurnHandler, runPlanCritiqueSession };
}
