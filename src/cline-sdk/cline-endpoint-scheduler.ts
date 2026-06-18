import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { isLocalProvider } from "./cline-local-only-policy";
import {
	buildClineModelRegistryKey,
	type ClineModelRegistryKeyInput,
	type ClineModelRegistrySnapshot,
} from "./cline-model-registry";

export interface ClineEndpointSessionSnapshot extends ClineModelRegistryKeyInput {
	taskId: string;
	state: RuntimeTaskSessionSummary["state"];
}

export interface ClineEndpointSchedulingRequest extends ClineModelRegistryKeyInput {
	taskId: string;
	runningSessions: readonly ClineEndpointSessionSnapshot[];
	modelRegistry: ClineModelRegistrySnapshot;
}

export type ClineEndpointSchedulingDecision =
	| {
			ok: true;
	  }
	| {
			ok: false;
			blockedByTaskId: string;
			sharedEndpointId: string;
			reason: string;
	  };

function normalizeProviderId(providerId: string): string {
	return providerId.trim().toLowerCase();
}

function normalizeModelId(modelId: string): string {
	return modelId.trim();
}

function normalizeEndpoint(endpoint: string | null | undefined): string | null {
	const trimmed = endpoint?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : null;
}

function getFallbackSharedEndpointId(input: ClineModelRegistryKeyInput): string | null {
	const providerId = normalizeProviderId(input.providerId);
	const endpoint = normalizeEndpoint(input.endpoint);
	if (!isLocalProvider(providerId, endpoint)) {
		return null;
	}
	return endpoint ?? `${providerId}:default`;
}

function getSharedEndpointId(snapshot: ClineModelRegistrySnapshot, input: ClineModelRegistryKeyInput): string | null {
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint);
	if (providerId.length === 0 || modelId.length === 0) {
		return null;
	}
	if (!isLocalProvider(providerId, endpoint)) {
		return null;
	}
	const key = buildClineModelRegistryKey({ providerId, modelId, endpoint });
	const registrySharedEndpointId = snapshot.models[key]?.constraints.sharedEndpointId?.trim() ?? "";
	return registrySharedEndpointId.length > 0 ? registrySharedEndpointId : getFallbackSharedEndpointId(input);
}

export function scheduleClineEndpointStart(request: ClineEndpointSchedulingRequest): ClineEndpointSchedulingDecision {
	const sharedEndpointId = getSharedEndpointId(request.modelRegistry, request);
	if (!sharedEndpointId) {
		return { ok: true };
	}

	for (const session of request.runningSessions) {
		if (session.taskId === request.taskId || session.state !== "running") {
			continue;
		}
		const sessionSharedEndpointId = getSharedEndpointId(request.modelRegistry, session);
		if (sessionSharedEndpointId === sharedEndpointId) {
			return {
				ok: false,
				blockedByTaskId: session.taskId,
				sharedEndpointId,
				reason: `Another Cline task is already running on shared endpoint "${sharedEndpointId}".`,
			};
		}
	}

	return { ok: true };
}
