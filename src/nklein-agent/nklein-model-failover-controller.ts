import type { RuntimeTaskImage, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "../core/api-contract";
import { isEnabledByDefaultEnv } from "../core/env-flag";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { decideModelFailover } from "../core/model-failover-policy";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { NKleinTaskLaunchConfigOverrides } from "./nklein-launch-config";

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
		// Only the error terminal qualifies — interrupted/failed have their own flows, and a clean awaiting_review
		// is the normal review hand-off.
		if (summary.state !== "awaiting_review" || summary.reviewReason !== "error") {
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
		const decision = decideModelFailover({
			errorMessage: summary.warningMessage ?? null,
			failedModelKey,
			triedModelKeys: tried,
			rankedCandidateKeys: candidatesByTaskId.get(taskId) ?? [],
		});
		if (!decision.failover || !decision.nextModelKey) {
			return;
		}
		const nextModelKey = decision.nextModelKey;
		triedModelKeysByTaskId.set(taskId, [...tried, failedModelKey, nextModelKey]);
		inFlightTaskIds.add(taskId);
		void (async () => {
			try {
				recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `Model failover for ${taskId}: ${decision.reason}`,
					taskId,
					metadata: { category: "model_failover", failedModelKey, nextModelKey },
				});
				await deps.resendTaskInput(
					taskId,
					`The previous attempt ended with a model-side error (${(summary.warningMessage ?? "unknown error").slice(0, 160)}). You are a fresh attempt on a different model — continue the task and complete it.`,
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
