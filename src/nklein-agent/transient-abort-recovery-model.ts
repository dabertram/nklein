import type { AgentModel } from "@cline/shared";
import { isRetryableModelCallError } from "../core/transient-error";
import { createRecoveryLadderModel, type RecoveryTurnSignal } from "./recovery-ladder-model";

/** One initial model call plus at most two same-model retries, matching the direct local-client transport budget. */
export const TRANSIENT_MODEL_CALL_MAX_RETRIES = 2;

export interface TransientAbortRecoveryModelOptions {
	/** Out-of-band liveness signal for buffered text/reasoning tokens; does not expose their content. */
	onBufferedToken?: () => void;
}

/**
 * Decide whether a BUFFERED swarm turn ended in a retryable provider/runtime abort.
 *
 * The outer request signal is provenance, not merely another error string: once it is aborted, the owning user/session
 * explicitly stopped the call and retrying would undo that control action. A tool-call delta is also terminal because
 * replaying it could repeat a side effect. Text/reasoning/usage events are safe here because the decorator buffers and
 * replaces the entire failed attempt before any event reaches the agent loop.
 */
export function shouldRetryTransientModelTurn(signal: RecoveryTurnSignal): boolean {
	if (signal.callerAborted || signal.hadToolCall) {
		return false;
	}
	if (signal.finishReason === "aborted") {
		return true;
	}
	if (signal.thrownError !== null) {
		return isRetryableModelCallError(signal.thrownError, {});
	}
	return signal.finishReason === "error" && signal.finishError !== null
		? isRetryableModelCallError(signal.finishError, {})
		: false;
}

/** Wrap the shared SDK model-call seam with bounded, replacement-safe transient-abort recovery. */
export function createTransientAbortRecoveryModel(
	base: AgentModel,
	options: TransientAbortRecoveryModelOptions = {},
): AgentModel {
	const singleProviderAttemptBase: AgentModel = {
		stream: (request) =>
			base.stream({
				...request,
				options: {
					...request.options,
					metadata: {
						...((request.options?.metadata as Record<string, unknown> | undefined) ?? {}),
						nkleinProviderMaxRetries: 0,
					},
				},
			}),
	};
	return createRecoveryLadderModel({
		base: singleProviderAttemptBase,
		maxAttempts: TRANSIENT_MODEL_CALL_MAX_RETRIES,
		shouldRecover: shouldRetryTransientModelTurn,
		// Transport/runtime recovery repeats the SAME request. Higher retry-ladder rungs own prompt/budget/model changes.
		reframe: (request) => request,
		onBufferedEvent: (event) => {
			if ((event.type === "text-delta" || event.type === "reasoning-delta") && event.text.length > 0) {
				options.onBufferedToken?.();
			}
		},
	});
}
