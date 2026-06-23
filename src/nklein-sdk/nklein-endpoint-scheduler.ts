import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { normalizeEndpoint, normalizeModelId, normalizeProviderId } from "../core/model-identity";
import { isLocalProvider } from "./nklein-local-only-policy";
import {
	buildNKleinModelRegistryKey,
	type NKleinModelRegistryKeyInput,
	type NKleinModelRegistrySnapshot,
} from "./nklein-model-registry";

export interface NKleinEndpointSessionSnapshot extends NKleinModelRegistryKeyInput {
	taskId: string;
	state: RuntimeTaskSessionSummary["state"];
	startedAt?: number | null;
}

export interface NKleinEndpointSchedulingRequest extends NKleinModelRegistryKeyInput {
	taskId: string;
	runningSessions: readonly NKleinEndpointSessionSnapshot[];
	modelRegistry: NKleinModelRegistrySnapshot;
	now?: number;
}

export type NKleinEndpointSchedulingDecision =
	| {
			ok: true;
	  }
	| {
			ok: false;
			blockedByTaskId: string;
			sharedEndpointId: string;
			estimatedWaitMs: number | null;
			reason: string;
	  };

function hasRealModelIdentity(input: NKleinModelRegistryKeyInput): boolean {
	return input.providerId.trim().length > 0 && input.modelId.trim().length > 0;
}

function getLegacySharedEndpointId(input: NKleinModelRegistryKeyInput): string | null {
	const providerId = normalizeProviderId(input.providerId);
	const endpoint = normalizeEndpoint(input.endpoint);
	if (!isLocalProvider(providerId, endpoint)) {
		return null;
	}
	return endpoint ?? `${providerId}:default`;
}

function getFallbackSharedEndpointId(input: NKleinModelRegistryKeyInput): string | null {
	const modelId = normalizeModelId(input.modelId);
	const legacyEndpointId = getLegacySharedEndpointId(input);
	if (!legacyEndpointId || !modelId) {
		return legacyEndpointId;
	}
	return `${legacyEndpointId}#${modelId}`;
}

function getSharedEndpointId(snapshot: NKleinModelRegistrySnapshot, input: NKleinModelRegistryKeyInput): string | null {
	if (!hasRealModelIdentity(input)) {
		return null;
	}
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint);
	if (!isLocalProvider(providerId, endpoint)) {
		return null;
	}
	const key = buildNKleinModelRegistryKey({ providerId, modelId, endpoint });
	const registrySharedEndpointId = snapshot.models[key]?.constraints.sharedEndpointId?.trim() ?? "";
	const legacySharedEndpointId = getLegacySharedEndpointId(input);
	if (registrySharedEndpointId.length > 0 && registrySharedEndpointId !== legacySharedEndpointId) {
		return registrySharedEndpointId;
	}
	return getFallbackSharedEndpointId(input);
}

function getObservedWallTimeMs(
	snapshot: NKleinModelRegistrySnapshot,
	input: NKleinModelRegistryKeyInput,
): number | null {
	if (!hasRealModelIdentity(input)) {
		return null;
	}
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint);
	const key = buildNKleinModelRegistryKey({ providerId, modelId, endpoint });
	const speed = snapshot.models[key]?.speed;
	const wallTimeMs = speed?.wallTimeMsEwma ?? speed?.lastWallTimeMs ?? null;
	return typeof wallTimeMs === "number" && Number.isFinite(wallTimeMs) && wallTimeMs > 0
		? Math.trunc(wallTimeMs)
		: null;
}

function estimateRemainingEndpointWaitMs(
	snapshot: NKleinModelRegistrySnapshot,
	session: NKleinEndpointSessionSnapshot,
	now: number,
): number | null {
	const observedWallTimeMs = getObservedWallTimeMs(snapshot, session);
	if (observedWallTimeMs === null) {
		return null;
	}
	const startedAt =
		typeof session.startedAt === "number" && Number.isFinite(session.startedAt) && session.startedAt > 0
			? session.startedAt
			: null;
	if (startedAt === null) {
		return observedWallTimeMs;
	}
	return Math.max(0, observedWallTimeMs - Math.max(0, now - startedAt));
}

function formatEstimatedWait(estimatedWaitMs: number | null): string {
	if (estimatedWaitMs === null) {
		return "";
	}
	const seconds = Math.max(1, Math.ceil(estimatedWaitMs / 1000));
	return ` Estimated wait from observed model speed: about ${seconds.toLocaleString()}s.`;
}

export function scheduleNKleinEndpointStart(
	request: NKleinEndpointSchedulingRequest,
): NKleinEndpointSchedulingDecision {
	const sharedEndpointId = getSharedEndpointId(request.modelRegistry, request);
	if (!sharedEndpointId) {
		return { ok: true };
	}
	const now = request.now ?? Date.now();

	for (const session of request.runningSessions) {
		if (session.taskId === request.taskId || session.state !== "running") {
			continue;
		}
		const sessionSharedEndpointId = getSharedEndpointId(request.modelRegistry, session);
		if (sessionSharedEndpointId === sharedEndpointId) {
			const estimatedWaitMs = estimateRemainingEndpointWaitMs(request.modelRegistry, session, now);
			return {
				ok: false,
				blockedByTaskId: session.taskId,
				sharedEndpointId,
				estimatedWaitMs,
				reason: `Another !Klein task is already running on shared endpoint "${sharedEndpointId}".${formatEstimatedWait(estimatedWaitMs)}`,
			};
		}
	}

	return { ok: true };
}
