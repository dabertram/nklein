import { buildModelBehaviorProfilesFromLedger } from "../core/agent-ledger-projections";
import type { RuntimeTaskImage, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "../core/api-contract";
import { isTruthyEnv } from "../core/env-flag";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { learnedQualityEffectiveBudget, learnedRetryBudget } from "../core/model-behavior-profile";
import { raisedTokenBudget } from "../core/retry-policy";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { readSelfObservationEvents, recordSelfObservation } from "../telemetry/self-observation-sink";
import { hasStallEvidence, shouldAttemptAdaptiveBudgetRetry } from "./nklein-adaptive-retry-policy";
import type { NKleinTaskLaunchConfigOverrides } from "./nklein-launch-config";

/**
 * Service touchpoints. `resendTaskInput` is the service's `sendTaskSessionInput` (the adaptive retry re-drives the
 * card on a raised per-turn budget); `resolveKnownContextWindow` + `hasResultBranch` gate the retry decision.
 */
export interface AdaptiveBudgetControllerDeps {
	hasResultBranch(taskId: string): boolean;
	resolveKnownContextWindow(taskId: string): number | null;
	resendTaskInput(
		taskId: string,
		text: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides,
	): Promise<unknown>;
}

export interface AdaptiveBudgetController {
	/** W2.3a: the LEARNED quality-effective context budget for a model (from the ledger's qualityOk knee), or null. */
	getQualityBudget(modelId: string): number | null;
	refreshLearnedQualityBudgets(): void;
	maybeAdaptiveBudgetRetry(taskId: string, summary: RuntimeTaskSessionSummary): void;
}

/**
 * W2.3a / W1.1b: owns the LEARNED quality-effective budgets per model (folded from the agent ledger) and the
 * STALL-signature adaptive retry (re-send with a raised per-turn budget when a reasoning model burns its whole
 * output budget on reasoning_content and delivers nothing). Extracted verbatim from
 * InMemoryNKleinTaskSessionService — owns its three state maps/flags; the ContextBudgetController reads the quality
 * budget through `getQualityBudget`.
 */
export function createAdaptiveBudgetController(deps: AdaptiveBudgetControllerDeps): AdaptiveBudgetController {
	const qualityBudgetByModelId = new Map<string, number>();
	/** §5.AA learned per-model RETRY budget (from the same ledger fold) — the adaptive cap the retry engine parks on. */
	const retryBudgetByModelId = new Map<string, number>();
	let qualityBudgetRefreshInFlight = false;
	/** W1.1b adaptive-retry state: attempts + last budget per task (bounded by MAX_ADAPTIVE_RETRY_ATTEMPTS). */
	const adaptiveRetryStateByTaskId = new Map<string, { attempt: number; lastBudget: number }>();

	function getQualityBudget(modelId: string): number | null {
		return qualityBudgetByModelId.get(modelId) ?? null;
	}

	function refreshLearnedQualityBudgets(): void {
		if (qualityBudgetRefreshInFlight) {
			return;
		}
		qualityBudgetRefreshInFlight = true;
		void (async () => {
			try {
				const events = await readAllAgentLedger();
				for (const profile of buildModelBehaviorProfilesFromLedger(events)) {
					const budget = learnedQualityEffectiveBudget(profile);
					if (budget !== null) {
						qualityBudgetByModelId.set(profile.modelId, budget);
					}
					// §5.AA: the learned retry budget (typical retries + unreliability margin, clamped 1..6) — the adaptive
					// cap the retry engine parks on, replacing the hard constant-2. Empty map ⇒ default ⇒ prior behavior.
					retryBudgetByModelId.set(profile.modelId, learnedRetryBudget(profile));
				}
			} catch {
				// Best-effort — an unreadable ledger leaves the advertised-window behavior unchanged.
			} finally {
				qualityBudgetRefreshInFlight = false;
			}
		})();
	}

	function maybeAdaptiveBudgetRetry(taskId: string, summary: RuntimeTaskSessionSummary): void {
		const providerId = summary.providerId ?? null;
		const modelId = summary.modelId ?? null;
		const state = adaptiveRetryStateByTaskId.get(taskId) ?? { attempt: 0, lastBudget: 1024 };
		// §5.AA engine adoption: the continue-vs-park decision is the retry engine's, capped by this model's LEARNED
		// retry budget (from the ledger fold) rather than a hard constant. Unknown model ⇒ default ⇒ prior behavior.
		const retryBudget = modelId ? retryBudgetByModelId.get(modelId) : undefined;
		if (
			!shouldAttemptAdaptiveBudgetRetry({
				adaptiveRetryEnabled: isTruthyEnv(process.env.NKLEIN_ADAPTIVE_RETRY),
				summaryState: summary.state,
				providerId,
				modelId,
				isHomeAgentSession: isHomeAgentSessionId(taskId),
				attempt: state.attempt,
				...(retryBudget !== undefined ? { retryBudget } : {}),
			})
		) {
			return;
		}
		// The eligibility gate already guarantees provider+model are set; narrow for the async re-send below.
		if (!providerId || !modelId) {
			return;
		}
		void (async () => {
			try {
				// Stall evidence: a model_stalled observation recorded during THIS run (since the session started).
				const since = summary.startedAt ?? 0;
				const events = await readSelfObservationEvents({ taskId, limit: 25 }).catch(() => []);
				const stalled = hasStallEvidence(events, since);
				// Only a stall WITHOUT delivered work qualifies — a captured result branch means the turn produced
				// something despite the stall observation (leave it to the normal review flow).
				if (!stalled || deps.hasResultBranch(taskId)) {
					return;
				}
				const contextWindow = deps.resolveKnownContextWindow(taskId) ?? 32_000;
				const raised = raisedTokenBudget({
					current: state.lastBudget,
					attempt: state.attempt + 1,
					ceiling: Math.max(2_048, contextWindow - 8_192),
				});
				adaptiveRetryStateByTaskId.set(taskId, { attempt: state.attempt + 1, lastBudget: raised });
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: `Adaptive budget retry ${state.attempt + 1}/2 for ${taskId}: re-sending with maxTokensPerTurn=${raised} after a stalled (likely truncated-mid-reasoning) turn.`,
					taskId,
					metadata: { category: "adaptive_budget_retry", attempt: state.attempt + 1, raisedBudget: raised },
				});
				await deps.resendTaskInput(
					taskId,
					"Your previous turn produced no output (it likely exhausted the token budget mid-reasoning). Continue the task and complete it — the output budget has been raised.",
					"act",
					undefined,
					{ providerId, modelId, maxTokensPerTurn: raised },
				);
			} catch {
				// Best-effort recovery — a failed retry leaves the card held in Review exactly as before (fail-closed).
			}
		})();
	}

	return { getQualityBudget, refreshLearnedQualityBudgets, maybeAdaptiveBudgetRetry };
}
