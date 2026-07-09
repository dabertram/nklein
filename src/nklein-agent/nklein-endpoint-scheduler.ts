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
	hostId?: string | null;
}

export interface NKleinEndpointSchedulingRequest extends NKleinModelRegistryKeyInput {
	taskId: string;
	runningSessions: readonly NKleinEndpointSessionSnapshot[];
	modelRegistry: NKleinModelRegistrySnapshot;
	now?: number;
	/** Already-resolved LM Studio host id for this request; preferred over re-looking up `modelId` in a fresh map. */
	hostId?: string | null;
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
	/**
	 * §5.AB per-LM-STUDIO-HOST cap (`resolveEffectiveHostConcurrency`): the max concurrent sessions this task's
	 * `lms ps` host/machine admits across ALL its models. Host id is resolved from `hostId` or `machineByModelId`.
	 * Local models still resolve to `local` because `lms ps` maps them that way; unresolved aliases are not assumed local.
	 * Explicit per-host settings can therefore let a large local host run 2+ requests while a smaller linked box stays at 1.
	 */
	hostConcurrencyCap?: number | null;
	/**
	 * §5.AB per-MACHINE cap for the LM-Link case: several machines share ONE endpoint, so `endpointConcurrencyCap` (keyed
	 * on the baseUrl) can't tell them apart. When both this cap AND `machineByModelId` (runtime model id → owning machine,
	 * from `lms ps --json`) are supplied, each MACHINE admits up to this many sessions independently. `null`/absent = no
	 * per-machine gate (default; behavior unchanged).
	 */
	perMachineCap?: number | null;
	/** Runtime model id → owning machine id (from `lms ps`); enables the per-machine gate above. */
	machineByModelId?: ReadonlyMap<string, string>;
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

function resolveRequestHostId(request: NKleinEndpointSchedulingRequest): string | null {
	return request.hostId?.trim() || request.machineByModelId?.get(request.modelId)?.trim() || null;
}

function resolveSessionHostId(
	session: NKleinEndpointSessionSnapshot,
	machineByModelId: ReadonlyMap<string, string>,
): string | null {
	return session.hostId?.trim() || machineByModelId.get(session.modelId)?.trim() || null;
}

/**
 * §5.AB per-MACHINE gate for LM-Link setups (several machines behind one endpoint): admit up to `perMachineCap` sessions
 * per MACHINE, resolved via `machineByModelId` (from `lms ps`). Independent of the endpoint pool. Returns `null` (inert)
 * unless BOTH the cap and the map are supplied, so the default is unchanged.
 */
function evaluateMachinePoolConcurrencyGate(
	request: NKleinEndpointSchedulingRequest,
): NKleinEndpointSchedulingDecision | null {
	const cap = normalizePositiveCap(request.perMachineCap);
	if (cap === null || !request.machineByModelId) {
		return null;
	}
	const targetMachineId = resolveRequestHostId(request);
	if (!targetMachineId) {
		return null;
	}
	const runningOnMachines = request.runningSessions.filter(
		(session) => session.taskId !== request.taskId && session.state === "running",
	);
	const runningOnTargetMachine = runningOnMachines.filter(
		(session) => resolveSessionHostId(session, request.machineByModelId ?? new Map()) === targetMachineId,
	);
	if (runningOnTargetMachine.length < cap) {
		return null;
	}
	const blocker = runningOnTargetMachine[0];
	return {
		ok: false,
		blockedByTaskId: blocker?.taskId ?? request.taskId,
		sharedEndpointId: `machine:${targetMachineId}`,
		estimatedWaitMs: null,
		reason: `Machine "${targetMachineId}" is at its ${cap} concurrent-session cap; another !Klein task on this machine must finish first.`,
	};
}

/**
 * §5.AB per-LM-STUDIO-HOST gate — a configured cap for the target host/machine id (`local`, m4mini's LM-Link device id,
 * etc.). This is the persisted, per-host version of the older uniform `perMachineCap` env gate.
 */
function evaluateHostConcurrencyGate(
	request: NKleinEndpointSchedulingRequest,
): NKleinEndpointSchedulingDecision | null {
	const cap = normalizePositiveCap(request.hostConcurrencyCap);
	if (cap === null || !request.machineByModelId) {
		return null;
	}
	const targetHostId = resolveRequestHostId(request);
	if (!targetHostId) {
		return null;
	}
	const runningOnHost = request.runningSessions.filter(
		(session) =>
			session.taskId !== request.taskId &&
			session.state === "running" &&
			resolveSessionHostId(session, request.machineByModelId ?? new Map()) === targetHostId,
	);
	const earliest = runningOnHost[0];
	if (runningOnHost.length < cap || !earliest) {
		return null;
	}
	return {
		ok: false,
		blockedByTaskId: earliest.taskId,
		sharedEndpointId: `host:${targetHostId}`,
		estimatedWaitMs: null,
		reason: `LM Studio host "${targetHostId}" is at its ${cap} concurrent-session cap; another !Klein task on this host must finish first.`,
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
	// §5.AB persisted host caps: a full LM Studio host holds even when another host behind the same endpoint is free.
	const hostBlock = evaluateHostConcurrencyGate(request);
	if (hostBlock) {
		return hostBlock;
	}
	// §5.AB LM-Link: the per-MACHINE gate (machines sharing one endpoint) is likewise independent.
	const machineBlock = evaluateMachinePoolConcurrencyGate(request);
	if (machineBlock) {
		return machineBlock;
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
