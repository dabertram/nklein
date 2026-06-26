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

function getMaxConcurrentRequests(snapshot: NKleinModelRegistrySnapshot, input: NKleinModelRegistryKeyInput): number {
	if (!hasRealModelIdentity(input)) {
		return 1;
	}
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint);
	const key = buildNKleinModelRegistryKey({ providerId, modelId, endpoint });
	const limit = snapshot.models[key]?.constraints.maxConcurrentRequests ?? null;
	return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 1;
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
	// Per-model parallel-request capacity (default 1 = strict serialization). The swarm may run up to `limit`
	// concurrent sessions on the same shared endpoint before a new start is held.
	const limit = getMaxConcurrentRequests(request.modelRegistry, request);

	const concurrentSessions = request.runningSessions.filter(
		(session) =>
			session.taskId !== request.taskId &&
			session.state === "running" &&
			getSharedEndpointId(request.modelRegistry, session) === sharedEndpointId,
	);
	if (concurrentSessions.length < limit) {
		return { ok: true };
	}

	// At capacity: hold behind the session that is estimated to free up soonest, so the reported wait is accurate.
	let earliest = concurrentSessions[0];
	let earliestWaitMs = estimateRemainingEndpointWaitMs(request.modelRegistry, earliest, now);
	for (const session of concurrentSessions.slice(1)) {
		const waitMs = estimateRemainingEndpointWaitMs(request.modelRegistry, session, now);
		if (earliestWaitMs === null || (waitMs !== null && waitMs < earliestWaitMs)) {
			earliest = session;
			earliestWaitMs = waitMs;
		}
	}
	const capacityNote = limit > 1 ? ` Shared endpoint is at its ${limit} concurrent-request capacity.` : "";
	return {
		ok: false,
		blockedByTaskId: earliest.taskId,
		sharedEndpointId,
		estimatedWaitMs: earliestWaitMs,
		reason: `Another !Klein task is already running on shared endpoint "${sharedEndpointId}".${capacityNote}${formatEstimatedWait(earliestWaitMs)}`,
	};
}
