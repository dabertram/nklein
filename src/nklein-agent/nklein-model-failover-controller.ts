import type { RuntimeTaskImage, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "../core/api-contract";
import { isEnabledByDefaultEnv } from "../core/env-flag";
import { classifyFailureSignature } from "../core/failure-signature";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { decideModelCapabilityFailover, decideModelFailover } from "../core/model-failover-policy";
import { decideNextRetryStrategy } from "../core/retry-policy";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { NKleinTaskLaunchConfigOverrides } from "./nklein-launch-config";

const DECOMPOSITION_EXHAUSTION_MARKER = "decomposition attempts that kept failing graph validation";

function findDecompositionExhaustionSignal(summary: RuntimeTaskSessionSummary): string | null {
	for (const candidate of [
		summary.latestHookActivity?.finalMessage,
		summary.latestHookActivity?.activityText,
		summary.warningMessage,
	]) {
		if (candidate?.includes(DECOMPOSITION_EXHAUSTION_MARKER)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Service touchpoints — the same re-drive seam the adaptive-budget controller uses (`sendTaskSessionInput` with
 * launch-config overrides), so a failover lands as a normal re-driven turn on the substituted model.
 */
export interface ModelFailoverControllerDeps {
	resendTaskInput(
		taskId: string,
		text: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides,
	): Promise<unknown>;
	/** Correlate the engine-selected carry rung with the next terminal attempt ledger event. */
	noteStrategyApplied?: (taskId: string, strategy: string) => void;
	/** A fresh model owns a fresh bounded decomposition-recovery budget. */
	resetDecompositionRecoveryBudget?: (taskId: string) => void;
}

export interface ModelFailoverController {
	/** Stash the router's ranked candidate model keys for a task at START (fitness-blended order, best first). */
	setCandidates(taskId: string, rankedModelKeys: readonly string[]): void;
	/** F3.2 failover leg: on an error-terminal summary, re-drive the card on the next untried candidate. */
	maybeModelFailover(taskId: string, summary: RuntimeTaskSessionSummary): void;
	/** Drop per-task state (session forget/cleanup). */
	forgetTask(taskId: string): void;
}

/**
 * F3.2 failover leg (live-found twice: m4mini crash 2026-07-11, ministral engine-500 2026-07-17): a MODEL-side
 * terminal error used to park the card (`awaiting_review reason=error`) with no retry on another model, stagnating
 * unattended drains. This controller mirrors the adaptive-budget controller's shape: it reacts to the terminal
 * summary, asks the PURE `decideModelFailover` (model-side error classes only, capped hops, untried candidates in
 * the router's fitness-blended order), and re-drives the card via the normal input seam with a `modelId` override.
 *
 * DEFAULT-ON; kill-switch `NKLEIN_MODEL_FAILOVER=0/false/off`. Fail-closed: any error in the async re-drive leaves
 * the card parked in Review exactly as before.
 */
export function createModelFailoverController(deps: ModelFailoverControllerDeps): ModelFailoverController {
	const candidatesByTaskId = new Map<string, readonly string[]>();
	const triedModelKeysByTaskId = new Map<string, string[]>();
	/** One failover decision per (task, terminal transition) — the caller's dedupe already gates per state. */
	const inFlightTaskIds = new Set<string>();

	function setCandidates(taskId: string, rankedModelKeys: readonly string[]): void {
		candidatesByTaskId.set(taskId, [...rankedModelKeys]);
	}

	function forgetTask(taskId: string): void {
		candidatesByTaskId.delete(taskId);
		triedModelKeysByTaskId.delete(taskId);
		inFlightTaskIds.delete(taskId);
	}

	function maybeModelFailover(taskId: string, summary: RuntimeTaskSessionSummary): void {
		if (!isEnabledByDefaultEnv(process.env.NKLEIN_MODEL_FAILOVER)) {
			return;
		}
		if (summary.state !== "awaiting_review") {
			return;
		}
		// The guardrail event is authoritative. `warningMessage` may carry an unrelated concurrent advisory (live
		// run 20260721-160645: Codebase Memory container-headroom warning), so inspect the retained hook activity too.
		const decompositionExhaustionSignal = findDecompositionExhaustionSignal(summary);
		const decompositionCapabilityExhausted =
			summary.reviewReason === "attention" && decompositionExhaustionSignal !== null;
		// Ordinary attention/review terminals are not failures. The sole exception is the trusted repeated-
		// decomposition guard: it means this architect exhausted its bounded validation/critique path and the next
		// loaded architect must take over before a human is involved.
		if (summary.reviewReason !== "error" && !decompositionCapabilityExhausted) {
			return;
		}
		if (isHomeAgentSessionId(taskId) || inFlightTaskIds.has(taskId)) {
			return;
		}
		const providerId = summary.providerId ?? null;
		const failedModelKey = summary.modelId ?? null;
		if (!providerId || !failedModelKey) {
			return;
		}
		const tried = triedModelKeysByTaskId.get(taskId) ?? [];
		const candidateInput = {
			failedModelKey,
			triedModelKeys: tried,
			rankedCandidateKeys: candidatesByTaskId.get(taskId) ?? [],
		};
		const decision = decompositionCapabilityExhausted
			? decideModelCapabilityFailover(candidateInput)
			: decideModelFailover({ ...candidateInput, errorMessage: summary.warningMessage ?? null });
		if (!decision.failover || !decision.nextModelKey) {
			return;
		}
		const failureMessage = decompositionExhaustionSignal ?? summary.warningMessage ?? "unknown model error";
		const failure = classifyFailureSignature(failureMessage);
		const retryDecision = decideNextRetryStrategy({
			lastOutcome: failure.outcome,
			attemptsSoFar: 0,
			retryBudget: 1,
			triedStrategies: [],
			availableStrategies: ["cross_model_carry"],
		});
		if (retryDecision.strategy !== "cross_model_carry") {
			return;
		}
		const nextModelKey = decision.nextModelKey;
		triedModelKeysByTaskId.set(taskId, [...tried, failedModelKey, nextModelKey]);
		inFlightTaskIds.add(taskId);
		void (async () => {
			try {
				deps.noteStrategyApplied?.(taskId, "cross_model_carry");
				// The decomposition nudge budget is per architect attempt, not per card. Carrying an exhausted
				// weak-model budget into a fresh model can strand that model immediately after a valid critic
				// revision request, before it gets one turn to repair the candidate.
				deps.resetDecompositionRecoveryBudget?.(taskId);
				const category = decompositionCapabilityExhausted ? "decomposition_model_failover" : "model_failover";
				recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `Model failover for ${taskId}: ${decision.reason}`,
					taskId,
					metadata: { category, failedModelKey, nextModelKey },
				});
				await deps.resendTaskInput(
					taskId,
					decompositionCapabilityExhausted
						? "The previous architect exhausted its bounded decomposition validation and critique attempts. You are a fresh architect on a different loaded model. Re-read the authoritative specification, existing code, and the latest critic feedback in the preserved conversation; rebuild only the remaining implementation work, then submit it for a fresh independent verdict."
						: `The previous attempt ended with a model-side error (${(summary.warningMessage ?? "unknown error").slice(0, 160)}). You are a fresh attempt on a different model — continue the task and complete it.`,
					"act",
					undefined,
					{ providerId, modelId: nextModelKey },
				);
			} catch {
				// Fail-closed: a failed failover leaves the card parked in Review exactly as before.
			} finally {
				inFlightTaskIds.delete(taskId);
			}
		})();
	}

	return { setCandidates, maybeModelFailover, forgetTask };
}
