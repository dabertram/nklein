import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";
import { isLocalProvider } from "./nklein-local-only-policy";
import { extractNKleinModelRegistryObservationFromEvent, getDefaultNKleinModelRegistry } from "./nklein-model-registry";
import { readSdkAgentEvent } from "./nklein-sdk-event-readers";
import { isCreditLimitError, now } from "./nklein-session-state";
import { toErrorMessage } from "./nklein-task-session-helpers";
import type { NKleinSdkSessionEvent } from "./sdk-runtime-boundary.js";

export interface RuntimeObservationRecorderDeps {
	resolveTaskModelIdentity(taskId: string): { providerId: string; modelId: string };
	getEndpoint(taskId: string): string | null;
	resolveKnownContextWindow(taskId: string): number | null;
	elapsedMs(taskId: string, at: number): number | null;
	forgetTimer(taskId: string): void;
	recordObservationWithModel(event: SelfObservationEventInput & { taskId: string }): void;
	isNKleinProviderForTask(taskId: string): boolean;
}

export interface RuntimeObservationRecorder {
	/** Fold a turn-latency/registry signal from an SDK session event into the model registry (best-effort). */
	recordModelRegistryObservation(taskId: string, event: NKleinSdkSessionEvent): void;
	/** Record a local model's advertised context window in the registry (skips cloud / non-positive windows). */
	recordLaunchContextWindow(input: {
		providerId: string;
		modelId: string;
		endpoint: string | null;
		contextWindow: number | null;
	}): void;
	/** Turn an SDK error / run-failed event into a model-attributed self-observation (credit-limit-aware). */
	recordSdkEventObservation(taskId: string, event: unknown): void;
}

/**
 * §5.U: the runtime observation recorders, extracted verbatim from InMemoryNKleinTaskSessionService. Thin glue that
 * routes SDK session events + launch metadata into the model registry / self-observation sink — the pure extractors
 * (`extractNKleinModelRegistryObservationFromEvent`, `readSdkAgentEvent`) are unit-tested elsewhere; the previously
 * uncovered wiring (local-provider gate, credit-limit classification, identity stamping) is what this module's test
 * now pins.
 */
export function createRuntimeObservationRecorder(deps: RuntimeObservationRecorderDeps): RuntimeObservationRecorder {
	function recordModelRegistryObservation(taskId: string, event: NKleinSdkSessionEvent): void {
		const observedAt = now();
		const observation = extractNKleinModelRegistryObservationFromEvent(
			event,
			{
				...deps.resolveTaskModelIdentity(taskId),
				endpoint: deps.getEndpoint(taskId),
				contextWindow: deps.resolveKnownContextWindow(taskId),
			},
			observedAt,
			deps.elapsedMs(taskId, observedAt),
		);
		if (!observation) {
			return;
		}
		deps.forgetTimer(taskId);
		void getDefaultNKleinModelRegistry()
			.recordRequest(observation)
			.catch(() => undefined);
	}

	function recordLaunchContextWindow(input: {
		providerId: string;
		modelId: string;
		endpoint: string | null;
		contextWindow: number | null;
	}): void {
		if (!isLocalProvider(input.providerId, input.endpoint)) {
			return;
		}
		if (
			typeof input.contextWindow !== "number" ||
			!Number.isFinite(input.contextWindow) ||
			input.contextWindow <= 0
		) {
			return;
		}
		void getDefaultNKleinModelRegistry()
			.recordContextWindow({
				providerId: input.providerId,
				modelId: input.modelId,
				endpoint: input.endpoint,
				advertisedContextWindow: input.contextWindow,
			})
			.catch(() => undefined);
	}

	function recordSdkEventObservation(taskId: string, event: unknown): void {
		const agentEvent = readSdkAgentEvent(event);
		if (!agentEvent || (agentEvent.type !== "error" && agentEvent.type !== "run-failed")) {
			return;
		}
		const rawMessage = typeof agentEvent.message === "string" ? agentEvent.message : null;
		const errorMessage = toErrorMessage(agentEvent.error ?? rawMessage);
		deps.recordObservationWithModel({
			signal:
				deps.isNKleinProviderForTask(taskId) && isCreditLimitError(errorMessage)
					? "provider_error"
					: "runtime_error",
			severity: "error",
			message: errorMessage,
			taskId,
			metadata: {
				eventType: agentEvent.type,
			},
		});
	}

	return { recordModelRegistryObservation, recordLaunchContextWindow, recordSdkEventObservation };
}
