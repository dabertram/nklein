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
	/**
	 * §5.W: the effective per-PROVIDER concurrent-session cap for this task's provider (the resolved
	 * override?? global from `resolveEffectiveProviderConcurrency`). When set, a start is held once the provider
	 * already runs this many sessions across ALL its endpoints/models. `null`/`undefined` = no provider gate.
	 */
	providerConcurrencyCap?: number | null;
	/**
	 * §5.W: the effective per-MODEL concurrent-request cap (`resolveEffectiveModelConcurrency`), used in place of the
	 * machine-local registry `maxConcurrentRequests` constraint when supplied. `null`/`undefined` = use the registry.
	 */
	modelConcurrencyCap?: number | null;
	/**
	 * §5.AB per-MACHINE pool cap (`resolveEffectiveEndpointConcurrency`): the max concurrent sessions this task's
	 * ENDPOINT/machine admits across ALL its models. When set, a start is held once the machine pool is full —
	 * independent of the provider + per-model gates. `null`/`undefined` = no pool gate (default; behavior unchanged).
	 */
	endpointConcurrencyCap?: number | null;
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

/** A positive integer cap, or `null` when the value is absent/invalid (→ caller falls back). */
function normalizePositiveCap(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
}

/**
 * §5.W per-PROVIDER concurrency gate — independent of the per-endpoint/per-model gate. Holds a start when this task's
 * provider already runs `providerConcurrencyCap` sessions across ALL its endpoints/models. Only active for a LOCAL
 * provider with a supplied cap; returns `null` (no opinion) otherwise, so the default behavior is unchanged.
 */
function evaluateProviderConcurrencyGate(
	request: NKleinEndpointSchedulingRequest,
): NKleinEndpointSchedulingDecision | null {
	const cap = normalizePositiveCap(request.providerConcurrencyCap);
	if (cap === null) {
		return null;
	}
	const providerId = normalizeProviderId(request.providerId);
	const endpoint = normalizeEndpoint(request.endpoint);
	if (!isLocalProvider(providerId, endpoint)) {
		return null;
	}
	const providerSessions = request.runningSessions.filter(
		(session) =>
			session.taskId !== request.taskId &&
			session.state === "running" &&
			normalizeProviderId(session.providerId) === providerId,
	);
	const earliest = providerSessions[0];
	if (providerSessions.length < cap || !earliest) {
		return null;
	}
	return {
		ok: false,
		blockedByTaskId: earliest.taskId,
		sharedEndpointId: `provider:${providerId}`,
		estimatedWaitMs: null,
		reason: `Provider "${providerId}" is at its ${cap} concurrent-session cap; another !Klein task on this provider must finish first.`,
	};
}

/**
 * §5.AB per-MACHINE pool gate — independent of the provider + per-model gates. Holds a start when this task's
 * ENDPOINT/machine already runs `endpointConcurrencyCap` sessions across ALL its models, so a machine pool can't be
 * over-committed regardless of which models are in flight. Only active for a LOCAL endpoint with a supplied cap;
 * returns `null` (no opinion) otherwise, so the default behavior is unchanged.
 */
function evaluateEndpointPoolConcurrencyGate(
	request: NKleinEndpointSchedulingRequest,
): NKleinEndpointSchedulingDecision | null {
	const cap = normalizePositiveCap(request.endpointConcurrencyCap);
	if (cap === null) {
		return null;
	}
	// The MACHINE is identified by its endpoint/baseUrl (an LM-Studio-linked machine = one endpoint), NOT the
	// model-aware sharedEndpointId — so the pool counts ALL models on that machine. Only local endpoints have a pool.
	const providerId = normalizeProviderId(request.providerId);
	const endpoint = normalizeEndpoint(request.endpoint);
	if (!endpoint || !isLocalProvider(providerId, endpoint)) {
		return null;
	}
	const poolSessions = request.runningSessions.filter(
		(session) =>
			session.taskId !== request.taskId &&
			session.state === "running" &&
			normalizeEndpoint(session.endpoint) === endpoint,
	);
	const earliest = poolSessions[0];
	if (poolSessions.length < cap || !earliest) {
		return null;
	}
	return {
		ok: false,
		blockedByTaskId: earliest.taskId,
		sharedEndpointId: `pool:${endpoint}`,
		estimatedWaitMs: null,
		reason: `Machine pool "${endpoint}" is at its ${cap} concurrent-session cap; another !Klein task on this machine must finish first.`,
	};
}

export function scheduleNKleinEndpointStart(
	request: NKleinEndpointSchedulingRequest,
): NKleinEndpointSchedulingDecision {
	// §5.W: the per-PROVIDER cap is an independent gate — check it first so a provider at capacity holds even when the
	// specific endpoint/model still has room.
	const providerBlock = evaluateProviderConcurrencyGate(request);
	if (providerBlock) {
		return providerBlock;
	}
	// §5.AB: the per-MACHINE pool cap is also independent — a full machine holds even if this specific model has room.
	const poolBlock = evaluateEndpointPoolConcurrencyGate(request);
	if (poolBlock) {
		return poolBlock;
	}
	const sharedEndpointId = getSharedEndpointId(request.modelRegistry, request);
	if (!sharedEndpointId) {
		return { ok: true };
	}
	const now = request.now ?? Date.now();
	// Per-model parallel-request capacity (default 1 = strict serialization). The swarm may run up to `limit`
	// concurrent sessions on the same shared endpoint before a new start is held. §5.W: an effective per-model
	// config cap (`modelConcurrencyCap`) wins over the machine-local registry constraint when supplied.
	const limit =
		normalizePositiveCap(request.modelConcurrencyCap) ?? getMaxConcurrentRequests(request.modelRegistry, request);

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
