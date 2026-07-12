import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { computeNKleinFailureBackoff, type NKleinTaskFailureBackoffState } from "./nklein-failure-backoff";
import { isLocalProvider } from "./nklein-local-only-policy";
import {
	buildLocalModelUnavailableGuidance,
	clearActiveTurnState,
	createMessage,
	isCreditLimitError,
	isLocalModelRuntimeUnavailableError,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	updateSummary,
} from "./nklein-session-state";
import { toErrorMessage } from "./nklein-task-session-helpers";

/**
 * Service touchpoints the failure emitter needs. State (failure-backoff tracker, active-tool set, model endpoint,
 * provider resolution) stays owned by the service and is reached through these narrow accessors — the tracker and
 * the active-tool set are both cross-cutting (used well beyond the failure path), so the emitter borrows them here.
 */
export interface TaskFailureEmitterDeps {
	/** Clear the stream/tool/conversation run timeouts for the task (verbatim: the three clearTaskTimeout calls). */
	clearRunTimeouts(taskId: string): void;
	/** Drop the task from the active-tool set (activeToolTaskIds.delete). */
	clearActiveToolFlag(taskId: string): void;
	resolveProviderId(taskId: string): string;
	getModelId(taskId: string): string;
	getEndpoint(taskId: string): string | null;
	getPreviousFailure(taskId: string): NKleinTaskFailureBackoffState | undefined;
	recordFailure(taskId: string, state: NKleinTaskFailureBackoffState): void;
	emitMessage(taskId: string, message: NKleinTaskMessage): void;
	emitSummary(summary: RuntimeTaskSessionSummary): void;
}

export interface TaskFailureEmitter {
	emit(taskId: string, entry: NKleinTaskSessionEntry, context: "start" | "send", error: unknown): void;
}

/**
 * Classifies a failed NKlein SDK start/send (credit-limit vs local-model-unavailable vs generic), applies the
 * consecutive-failure backoff (park after repeats vs await-review), and emits the self-observation + user-facing
 * system message + updated summary. Extracted verbatim from InMemoryNKleinTaskSessionService.emitTaskFailure.
 */
export function createTaskFailureEmitter(deps: TaskFailureEmitterDeps): TaskFailureEmitter {
	function emit(taskId: string, entry: NKleinTaskSessionEntry, context: "start" | "send", error: unknown): void {
		deps.clearRunTimeouts(taskId);
		deps.clearActiveToolFlag(taskId);
		const errorMessage = toErrorMessage(error);
		const creditLimitError = deps.resolveProviderId(taskId) === "nklein" && isCreditLimitError(errorMessage);
		const providerId = deps.resolveProviderId(taskId);
		const modelId = deps.getModelId(taskId);
		const endpoint = deps.getEndpoint(taskId);
		// A local model host (LM Studio/Ollama) that crashed or unloaded its model won't recover by retrying the
		// dead endpoint; classify it so the task parks fast with reload guidance instead of storming a gone model.
		const localModelUnavailable =
			!creditLimitError &&
			isLocalProvider(providerId, endpoint) &&
			isLocalModelRuntimeUnavailableError(errorMessage);
		const backoff = computeNKleinFailureBackoff({
			context,
			errorMessage,
			previousFailure: deps.getPreviousFailure(taskId),
			localModelUnavailable,
		});
		if (backoff.alreadyParked) {
			return;
		}
		const { consecutiveFailures, shouldPark } = backoff;
		const localModelUnavailableGuidance = localModelUnavailable
			? buildLocalModelUnavailableGuidance(modelId, endpoint)
			: null;
		deps.recordFailure(taskId, backoff.nextState);
		recordSelfObservation({
			signal: creditLimitError ? "provider_error" : localModelUnavailable ? "provider_error" : "runtime_error",
			severity: "error",
			message: shouldPark
				? `NKlein SDK ${context} failed ${consecutiveFailures} consecutive times; parking task: ${errorMessage}`
				: `NKlein SDK ${context} failed: ${errorMessage}`,
			taskId,
			providerId,
			modelId,
			metadata: {
				context,
				creditLimitError,
				localModelUnavailable,
				consecutiveFailures,
				parked: shouldPark,
			},
		});
		if (!creditLimitError) {
			const baseMessage = shouldPark
				? `NKlein SDK ${context} failed ${consecutiveFailures} consecutive times with the same error, so !Klein parked this task to avoid retry storms: ${errorMessage}. Send a new message after fixing the cause to try again.`
				: `NKlein SDK ${context} failed: ${errorMessage}. You can send another message to continue the conversation.`;
			const systemMessage = createMessage(
				taskId,
				"system",
				localModelUnavailableGuidance ? `${localModelUnavailableGuidance}\n\n${baseMessage}` : baseMessage,
			);
			entry.messages.push(systemMessage);
			deps.emitMessage(taskId, systemMessage);
		}
		clearActiveTurnState(entry);
		const errorSummary = updateSummary(entry, {
			state: shouldPark ? "failed" : "awaiting_review",
			reviewReason: "error",
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: creditLimitError ? null : (localModelUnavailableGuidance ?? errorMessage),
			latestHookActivity: {
				activityText: shouldPark
					? `${context === "start" ? "Start" : "Send"} parked after repeated failures: ${errorMessage}`
					: `${context === "start" ? "Start" : "Send"} failed: ${errorMessage}`,
				toolName: null,
				toolInputSummary: null,
				finalMessage: errorMessage,
				hookEventName: "agent_error",
				notificationType: creditLimitError ? "credit_limit" : null,
				source: "nklein-sdk",
			},
		});
		deps.emitSummary(errorSummary);
	}

	return { emit };
}
