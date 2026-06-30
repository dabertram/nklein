import { normalizeEndpoint, normalizeModelId, normalizeProviderId } from "../core/model-identity";
import { normalizePositiveInteger } from "../core/normalize-number";
import type {
	NKleinModelRegistryEntry,
	NKleinModelRegistryKeyInput,
	NKleinModelRegistrySnapshot,
} from "./nklein-model-registry";
import { buildNKleinModelRegistryKey, buildSharedLocalEndpointId } from "./nklein-model-registry-key";
import {
	createEmptyCapabilityStats,
	createEmptySpeedStats,
	normalizeCapabilityStats,
	normalizeConstraints,
	normalizeSpeedStats,
	normalizeWindowStats,
} from "./nklein-model-registry-stats";
import { asRecord } from "./nklein-value-guards";

/**
 * Entry construction + persisted-snapshot deserialization for the model registry, extracted from
 * nklein-model-registry (the final decomposition slice). All value deps come from sibling modules
 * (key / stats / model-identity / normalize-number / value-guards) and the registry types are
 * type-only imports (erased), so there is no runtime cycle — registry → deserialize is one-way.
 */

const MODEL_REGISTRY_SCHEMA_VERSION = 1;

interface NKleinModelRegistryFileShape {
	schemaVersion?: unknown;
	updatedAt?: unknown;
	models?: unknown;
}

/** Total observations backing an entry (speed + capability samples) — used to pick a winner on key collisions. */
export function registryEntryObservationCount(entry: NKleinModelRegistryEntry): number {
	return entry.speed.samples + entry.capability.samples;
}

/**
 * Two persisted records can canonicalize to the same key (e.g. a `127.0.0.1` config and a
 * `localhost` observation). Keep the one carrying real observations so its telemetry survives
 * the merge instead of being clobbered by a blank duplicate.
 */
function mergeDuplicateRegistryEntries(
	existing: NKleinModelRegistryEntry,
	incoming: NKleinModelRegistryEntry,
): NKleinModelRegistryEntry {
	const existingCount = registryEntryObservationCount(existing);
	const incomingCount = registryEntryObservationCount(incoming);
	if (existingCount !== incomingCount) {
		return incomingCount > existingCount ? incoming : existing;
	}
	return incoming.updatedAt >= existing.updatedAt ? incoming : existing;
}

/** Build a fresh registry entry (canonical key, shared-endpoint id, empty stat blocks) for the given coordinates. */
export function createNKleinModelRegistryEntry(
	input: NKleinModelRegistryKeyInput,
	now: number,
): NKleinModelRegistryEntry {
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint);
	return {
		key: buildNKleinModelRegistryKey({ providerId, modelId, endpoint }),
		providerId,
		modelId,
		endpoint,
		contextWindow: {
			advertised: null,
			observed: null,
			userOverride: null,
			effective: null,
		},
		speed: createEmptySpeedStats(),
		capability: createEmptyCapabilityStats(),
		constraints: {
			sharedEndpointId: buildSharedLocalEndpointId({ providerId, modelId, endpoint }),
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: now,
		updatedAt: now,
	};
}

/** Deserialize one persisted entry, dropping records without a usable provider+model; overlays the parsed stats on a fresh base. */
function normalizeEntry(value: unknown, fallbackNow: number): NKleinModelRegistryEntry | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const providerId = typeof record?.providerId === "string" ? normalizeProviderId(record.providerId) : null;
	const modelId = typeof record?.modelId === "string" ? normalizeModelId(record.modelId) : null;
	if (!providerId || !modelId) {
		return null;
	}
	const endpoint = normalizeEndpoint(typeof record?.endpoint === "string" ? record.endpoint : null);
	const base = createNKleinModelRegistryEntry({ providerId, modelId, endpoint }, fallbackNow);
	const contextWindow = normalizeWindowStats(record.contextWindow);
	const capability = normalizeCapabilityStats(record.capability, fallbackNow);
	return {
		...base,
		contextWindow,
		speed: normalizeSpeedStats(record.speed),
		capability,
		constraints: normalizeConstraints(record.constraints, base.constraints),
		createdAt: normalizePositiveInteger(record.createdAt) ?? base.createdAt,
		updatedAt: normalizePositiveInteger(record.updatedAt) ?? base.updatedAt,
	};
}

/** Deserialize a persisted registry snapshot, dropping invalid entries and merging key collisions. */
export function normalizeSnapshot(value: unknown, fallbackNow: number): NKleinModelRegistrySnapshot {
	const record = asRecord(value) as NKleinModelRegistryFileShape | null;
	const rawModels = asRecord(record?.models);
	const models: Record<string, NKleinModelRegistryEntry> = {};
	if (rawModels) {
		for (const model of Object.values(rawModels)) {
			const entry = normalizeEntry(model, fallbackNow);
			if (entry) {
				const existing = models[entry.key];
				models[entry.key] = existing ? mergeDuplicateRegistryEntries(existing, entry) : entry;
			}
		}
	}
	return {
		schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION,
		updatedAt: normalizePositiveInteger(record?.updatedAt) ?? fallbackNow,
		models,
	};
}
