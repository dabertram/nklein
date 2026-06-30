import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { normalizeEndpoint, normalizeModelId, normalizeProviderId } from "../core/model-identity";
import { normalizePositiveInteger, normalizePositiveNumber } from "../core/normalize-number";
import { lockedFileSystem } from "../fs/locked-file-system";
import { isLocalProvider } from "./nklein-local-only-policy";
import { asRecord } from "./nklein-value-guards";
import type { NKleinSdkAgentEvent, NKleinSdkSessionEvent } from "./sdk-runtime-boundary";

const MODEL_REGISTRY_SCHEMA_VERSION = 1;
const DEFAULT_EWMA_ALPHA = 0.25;
const DEFAULT_CAPABILITY_PRIOR = 35;
const DEFAULT_PERSIST_DEBOUNCE_MS = 25;
const CAPABILITY_OBSERVATION_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
export interface NKleinModelRegistryKeyInput {
	providerId: string;
	modelId: string;
	endpoint?: string | null;
}

export interface NKleinModelRegistryRequestObservation extends NKleinModelRegistryKeyInput {
	contextWindow?: number | null;
	promptTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	wallTimeMs: number;
	ttftMs?: number | null;
	promptEvalMs?: number | null;
	decodeMs?: number | null;
	createdAt?: number;
}

export interface NKleinModelRegistryCapabilityObservation extends NKleinModelRegistryKeyInput {
	passed: boolean;
	score?: number | null;
	createdAt?: number;
}

export interface NKleinModelRegistryContextWindowObservation extends NKleinModelRegistryKeyInput {
	advertisedContextWindow?: number | null;
	observedContextWindow?: number | null;
	userOverrideContextWindow?: number | null;
	createdAt?: number;
}

export interface NKleinModelRegistryWindowStats {
	advertised: number | null;
	observed: number | null;
	userOverride: number | null;
	effective: number | null;
}

export interface NKleinModelRegistrySpeedStats {
	samples: number;
	promptTokensEwma: number | null;
	outputTokensEwma: number | null;
	totalTokensEwma: number | null;
	prefillTokensPerSecondEwma: number | null;
	decodeTokensPerSecondEwma: number | null;
	ttftMsEwma: number | null;
	wallTimeMsEwma: number | null;
	wallTimeMsPer1kPromptTokensEwma: number | null;
	lastPromptTokens: number | null;
	lastOutputTokens: number | null;
	lastWallTimeMs: number | null;
	lastObservedAt: number | null;
}

export interface NKleinModelRegistryCapabilityStats {
	samples: number;
	staticPrior: number;
	evalScore: number | null;
	externalScore: number | null;
	observedPassRate: number | null;
	effectiveScore: number;
	lastObservedAt: number | null;
}

export interface NKleinModelRegistryConstraints {
	sharedEndpointId: string | null;
	inputCostPerMillionTokens: number | null;
	outputCostPerMillionTokens: number | null;
	// Per-model parallel-request capacity. null = the default of 1 (serialize on the shared endpoint); N > 1 lets
	// the swarm scheduler run up to N concurrent sessions on this model's shared endpoint.
	maxConcurrentRequests: number | null;
}

export interface NKleinModelRegistryEntry {
	key: string;
	providerId: string;
	modelId: string;
	endpoint: string | null;
	contextWindow: NKleinModelRegistryWindowStats;
	speed: NKleinModelRegistrySpeedStats;
	capability: NKleinModelRegistryCapabilityStats;
	constraints: NKleinModelRegistryConstraints;
	createdAt: number;
	updatedAt: number;
}

export interface NKleinModelRegistrySnapshot {
	schemaVersion: number;
	updatedAt: number;
	models: Record<string, NKleinModelRegistryEntry>;
}

export interface NKleinModelRegistryOptions {
	registryPath?: string;
	now?: () => number;
	ewmaAlpha?: number;
	persistDebounceMs?: number;
}

interface NKleinModelRegistryFileShape {
	schemaVersion?: unknown;
	updatedAt?: unknown;
	models?: unknown;
}

function getDefaultModelRegistryPath(): string {
	return join(resolveNkleinRuntimeHomePath(homedir()), "model-registry.json");
}

function normalizeScore(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(100, value));
}

function normalizeNullableString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function registryEntryObservationCount(entry: NKleinModelRegistryEntry): number {
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

function getDefaultSharedEndpointId(input: {
	providerId: string;
	modelId: string;
	endpoint: string | null;
}): string | null {
	if (!isLocalProvider(input.providerId, input.endpoint)) {
		return null;
	}
	const endpoint = input.endpoint ?? `${input.providerId}:default`;
	return input.modelId ? `${endpoint}#${input.modelId}` : endpoint;
}

export function buildNKleinModelRegistryKey(input: NKleinModelRegistryKeyInput): string {
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint) ?? "default";
	return `${providerId}:${modelId}:${endpoint}`;
}

function ewma(previous: number | null, next: number, alpha: number): number {
	if (previous === null) {
		return next;
	}
	return previous * (1 - alpha) + next * alpha;
}

function createEmptySpeedStats(): NKleinModelRegistrySpeedStats {
	return {
		samples: 0,
		promptTokensEwma: null,
		outputTokensEwma: null,
		totalTokensEwma: null,
		prefillTokensPerSecondEwma: null,
		decodeTokensPerSecondEwma: null,
		ttftMsEwma: null,
		wallTimeMsEwma: null,
		wallTimeMsPer1kPromptTokensEwma: null,
		lastPromptTokens: null,
		lastOutputTokens: null,
		lastWallTimeMs: null,
		lastObservedAt: null,
	};
}

function createEmptyCapabilityStats(): NKleinModelRegistryCapabilityStats {
	return {
		samples: 0,
		staticPrior: DEFAULT_CAPABILITY_PRIOR,
		evalScore: null,
		externalScore: null,
		observedPassRate: null,
		effectiveScore: DEFAULT_CAPABILITY_PRIOR,
		lastObservedAt: null,
	};
}

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
			sharedEndpointId: getDefaultSharedEndpointId({ providerId, modelId, endpoint }),
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: now,
		updatedAt: now,
	};
}

function cloneEntry(entry: NKleinModelRegistryEntry, now?: number): NKleinModelRegistryEntry {
	const capability = { ...entry.capability };
	if (typeof now === "number") {
		capability.effectiveScore = calculateEffectiveCapability(capability, now);
	}
	return {
		...entry,
		contextWindow: { ...entry.contextWindow },
		speed: { ...entry.speed },
		capability,
		constraints: { ...entry.constraints },
	};
}

function calculateEffectiveContextWindow(windowStats: NKleinModelRegistryWindowStats): number | null {
	return windowStats.userOverride ?? windowStats.observed ?? windowStats.advertised;
}

function decayObservedCapabilityScore(
	score: number,
	capability: NKleinModelRegistryCapabilityStats,
	now?: number,
): number {
	if (typeof now !== "number" || capability.lastObservedAt === null) {
		return score;
	}
	const ageMs = Math.max(0, now - capability.lastObservedAt);
	const observationWeight = 0.5 ** (ageMs / CAPABILITY_OBSERVATION_HALF_LIFE_MS);
	return capability.staticPrior + (score - capability.staticPrior) * observationWeight;
}

function calculateEffectiveCapability(capability: NKleinModelRegistryCapabilityStats, now?: number): number {
	const observedScores = [
		capability.evalScore,
		capability.externalScore,
		capability.observedPassRate === null ? null : capability.observedPassRate * 100,
	]
		.filter((score): score is number => score !== null)
		.map((score) => decayObservedCapabilityScore(score, capability, now));
	const priorWeight = 1 / (1 + Math.max(0, capability.samples));
	const weightedTotal =
		observedScores.reduce((total, score) => total + score, 0) + capability.staticPrior * priorWeight;
	const totalWeight = observedScores.length + priorWeight;
	if (totalWeight === 0) {
		return DEFAULT_CAPABILITY_PRIOR;
	}
	return Math.round(weightedTotal / totalWeight);
}

function normalizeWindowStats(value: unknown): NKleinModelRegistryWindowStats {
	const record = asRecord(value);
	const stats = {
		advertised: normalizePositiveInteger(record?.advertised),
		observed: normalizePositiveInteger(record?.observed),
		userOverride: normalizePositiveInteger(record?.userOverride),
		effective: null,
	};
	return {
		...stats,
		effective: calculateEffectiveContextWindow(stats),
	};
}

function normalizeSpeedStats(value: unknown): NKleinModelRegistrySpeedStats {
	const record = asRecord(value);
	return {
		samples: normalizePositiveInteger(record?.samples) ?? 0,
		promptTokensEwma: normalizePositiveNumber(record?.promptTokensEwma),
		outputTokensEwma: normalizePositiveNumber(record?.outputTokensEwma),
		totalTokensEwma: normalizePositiveNumber(record?.totalTokensEwma),
		prefillTokensPerSecondEwma: normalizeScoreLikeNumber(record?.prefillTokensPerSecondEwma),
		decodeTokensPerSecondEwma: normalizeScoreLikeNumber(record?.decodeTokensPerSecondEwma),
		ttftMsEwma: normalizePositiveNumber(record?.ttftMsEwma),
		wallTimeMsEwma: normalizePositiveNumber(record?.wallTimeMsEwma),
		wallTimeMsPer1kPromptTokensEwma: normalizePositiveNumber(record?.wallTimeMsPer1kPromptTokensEwma),
		lastPromptTokens: normalizePositiveInteger(record?.lastPromptTokens),
		lastOutputTokens: normalizePositiveInteger(record?.lastOutputTokens),
		lastWallTimeMs: normalizePositiveNumber(record?.lastWallTimeMs),
		lastObservedAt: normalizePositiveInteger(record?.lastObservedAt),
	};
}

function normalizeCapabilityStats(value: unknown, now: number): NKleinModelRegistryCapabilityStats {
	const record = asRecord(value);
	const capability = {
		samples: normalizePositiveInteger(record?.samples) ?? 0,
		staticPrior: normalizeScore(record?.staticPrior) ?? DEFAULT_CAPABILITY_PRIOR,
		evalScore: normalizeScore(record?.evalScore),
		externalScore: normalizeScore(record?.externalScore),
		observedPassRate: normalizePassRate(record?.observedPassRate),
		effectiveScore: DEFAULT_CAPABILITY_PRIOR,
		lastObservedAt: normalizePositiveInteger(record?.lastObservedAt),
	};
	return {
		...capability,
		effectiveScore: calculateEffectiveCapability(capability, now),
	};
}

function normalizeConstraints(
	value: unknown,
	fallback: NKleinModelRegistryConstraints,
): NKleinModelRegistryConstraints {
	const record = asRecord(value);
	return {
		sharedEndpointId: normalizeNullableString(record?.sharedEndpointId) ?? fallback.sharedEndpointId,
		inputCostPerMillionTokens: normalizePositiveNumber(record?.inputCostPerMillionTokens),
		outputCostPerMillionTokens: normalizePositiveNumber(record?.outputCostPerMillionTokens),
		maxConcurrentRequests: normalizePositiveInteger(record?.maxConcurrentRequests) ?? fallback.maxConcurrentRequests,
	};
}

function normalizeScoreLikeNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return value;
}

function normalizePassRate(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		return null;
	}
	return value;
}

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

function normalizeSnapshot(value: unknown, fallbackNow: number): NKleinModelRegistrySnapshot {
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

async function readJsonIfExists(path: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export class NKleinModelRegistry {
	private snapshot: NKleinModelRegistrySnapshot | null = null;
	private readonly registryPath: string;
	private readonly now: () => number;
	private readonly ewmaAlpha: number;
	private readonly persistDebounceMs: number;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private snapshotToPersist: NKleinModelRegistrySnapshot | null = null;
	private pendingPersist: Promise<void> | null = null;
	private resolvePendingPersist: (() => void) | null = null;
	private rejectPendingPersist: ((error: unknown) => void) | null = null;
	private persistInFlight: Promise<void> | null = null;

	constructor(options: NKleinModelRegistryOptions = {}) {
		this.registryPath = options.registryPath ?? getDefaultModelRegistryPath();
		this.now = options.now ?? Date.now;
		this.ewmaAlpha =
			typeof options.ewmaAlpha === "number" && Number.isFinite(options.ewmaAlpha) && options.ewmaAlpha > 0
				? Math.min(1, options.ewmaAlpha)
				: DEFAULT_EWMA_ALPHA;
		this.persistDebounceMs =
			typeof options.persistDebounceMs === "number" &&
			Number.isFinite(options.persistDebounceMs) &&
			options.persistDebounceMs >= 0
				? Math.trunc(options.persistDebounceMs)
				: DEFAULT_PERSIST_DEBOUNCE_MS;
	}

	get path(): string {
		return this.registryPath;
	}

	async load(): Promise<NKleinModelRegistrySnapshot> {
		if (this.snapshot) {
			return this.getSnapshot();
		}
		const raw = await readJsonIfExists(this.registryPath);
		this.snapshot = normalizeSnapshot(raw, this.now());
		return this.getSnapshot();
	}

	async recordRequest(observation: NKleinModelRegistryRequestObservation): Promise<NKleinModelRegistryEntry> {
		const snapshot = await this.mutableSnapshot();
		const observedAt = observation.createdAt ?? this.now();
		const entry = this.getOrCreateEntry(snapshot, observation, observedAt);
		const contextWindow = normalizePositiveInteger(observation.contextWindow);
		if (contextWindow) {
			entry.contextWindow.observed = contextWindow;
			entry.contextWindow.effective = calculateEffectiveContextWindow(entry.contextWindow);
		}
		const promptTokens = Math.max(0, Math.trunc(observation.promptTokens));
		const outputTokens = Math.max(0, Math.trunc(observation.outputTokens));
		const totalTokens = promptTokens + outputTokens;
		const wallTimeMs = normalizePositiveNumber(observation.wallTimeMs);
		const ttftMs = normalizePositiveNumber(observation.ttftMs);
		const promptEvalMs = normalizePositiveNumber(observation.promptEvalMs);
		const decodeMs = normalizePositiveNumber(observation.decodeMs) ?? inferDecodeMs(observation.wallTimeMs, ttftMs);
		const speed = entry.speed;
		speed.samples += 1;
		speed.promptTokensEwma = ewma(speed.promptTokensEwma, promptTokens, this.ewmaAlpha);
		speed.outputTokensEwma = ewma(speed.outputTokensEwma, outputTokens, this.ewmaAlpha);
		speed.totalTokensEwma = ewma(speed.totalTokensEwma, totalTokens, this.ewmaAlpha);
		if (promptEvalMs && promptTokens > 0) {
			speed.prefillTokensPerSecondEwma = ewma(
				speed.prefillTokensPerSecondEwma,
				(promptTokens / promptEvalMs) * 1000,
				this.ewmaAlpha,
			);
		}
		if (decodeMs && outputTokens > 0) {
			speed.decodeTokensPerSecondEwma = ewma(
				speed.decodeTokensPerSecondEwma,
				(outputTokens / decodeMs) * 1000,
				this.ewmaAlpha,
			);
		}
		if (ttftMs) {
			speed.ttftMsEwma = ewma(speed.ttftMsEwma, ttftMs, this.ewmaAlpha);
		}
		if (wallTimeMs) {
			speed.wallTimeMsEwma = ewma(speed.wallTimeMsEwma, wallTimeMs, this.ewmaAlpha);
			if (promptTokens > 0) {
				speed.wallTimeMsPer1kPromptTokensEwma = ewma(
					speed.wallTimeMsPer1kPromptTokensEwma,
					wallTimeMs / (promptTokens / 1000),
					this.ewmaAlpha,
				);
			}
		}
		speed.lastPromptTokens = promptTokens;
		speed.lastOutputTokens = outputTokens;
		speed.lastWallTimeMs = wallTimeMs;
		speed.lastObservedAt = observedAt;
		entry.updatedAt = observedAt;
		snapshot.updatedAt = observedAt;
		this.schedulePersist(snapshot);
		return cloneEntry(entry);
	}

	async recordCapability(observation: NKleinModelRegistryCapabilityObservation): Promise<NKleinModelRegistryEntry> {
		const snapshot = await this.mutableSnapshot();
		const observedAt = observation.createdAt ?? this.now();
		const entry = this.getOrCreateEntry(snapshot, observation, observedAt);
		const capability = entry.capability;
		const previousPassRate = capability.observedPassRate ?? (observation.passed ? 1 : 0);
		const nextPassValue = observation.passed ? 1 : 0;
		capability.samples += 1;
		capability.observedPassRate = ewma(previousPassRate, nextPassValue, this.ewmaAlpha);
		const score = normalizeScore(observation.score);
		if (score !== null) {
			capability.evalScore = ewma(capability.evalScore, score, this.ewmaAlpha);
		}
		capability.lastObservedAt = observedAt;
		capability.effectiveScore = calculateEffectiveCapability(capability, observedAt);
		entry.updatedAt = observedAt;
		snapshot.updatedAt = observedAt;
		this.schedulePersist(snapshot);
		return cloneEntry(entry, observedAt);
	}

	async recordContextWindow(
		observation: NKleinModelRegistryContextWindowObservation,
	): Promise<NKleinModelRegistryEntry> {
		const snapshot = await this.mutableSnapshot();
		const observedAt = observation.createdAt ?? this.now();
		const entry = this.getOrCreateEntry(snapshot, observation, observedAt);
		const advertisedContextWindow = normalizePositiveInteger(observation.advertisedContextWindow);
		const observedContextWindow = normalizePositiveInteger(observation.observedContextWindow);
		const userOverrideContextWindow = normalizePositiveInteger(observation.userOverrideContextWindow);
		if (advertisedContextWindow !== null) {
			if (entry.contextWindow.advertised !== null && entry.contextWindow.advertised !== advertisedContextWindow) {
				// The model's advertised context window CHANGED (e.g. the model was reloaded/reconfigured in the
				// provider — LM Studio etc.). The prior auto-`observed` value was measured against the OLD window, so
				// in the `userOverride ?? observed ?? advertised` precedence it would mask the new size and the change
				// would go "undetected". Clear the stale observation so the new advertised size takes effect (a fresh
				// `observedContextWindow` in this same observation, if any, is re-applied just below). A user override
				// is intentional and is left untouched.
				entry.contextWindow.observed = null;
			}
			entry.contextWindow.advertised = advertisedContextWindow;
		}
		if (observedContextWindow !== null) {
			entry.contextWindow.observed = observedContextWindow;
		}
		if (userOverrideContextWindow !== null) {
			entry.contextWindow.userOverride = userOverrideContextWindow;
		}
		// `observed` must never exceed the live loaded/advertised window. A stale observation measured at a LARGER
		// window would otherwise win via `effective = userOverride ?? observed ?? advertised` and drive the context
		// budget past what the model is actually loaded with → overflow (§5.AB residual). Clamp it to the advertised
		// (loaded) size. A deliberate user override is left untouched (it's the user's explicit choice).
		if (
			entry.contextWindow.advertised !== null &&
			entry.contextWindow.observed !== null &&
			entry.contextWindow.observed > entry.contextWindow.advertised
		) {
			entry.contextWindow.observed = entry.contextWindow.advertised;
		}
		entry.contextWindow.effective = calculateEffectiveContextWindow(entry.contextWindow);
		entry.updatedAt = observedAt;
		snapshot.updatedAt = observedAt;
		this.schedulePersist(snapshot);
		return cloneEntry(entry);
	}

	async setContextWindowOverride(
		input: NKleinModelRegistryKeyInput & { contextWindow: number | null; createdAt?: number },
	): Promise<NKleinModelRegistryEntry> {
		const snapshot = await this.mutableSnapshot();
		const observedAt = input.createdAt ?? this.now();
		const entry = this.getOrCreateEntry(snapshot, input, observedAt);
		entry.contextWindow.userOverride = normalizePositiveInteger(input.contextWindow);
		entry.contextWindow.effective = calculateEffectiveContextWindow(entry.contextWindow);
		entry.updatedAt = observedAt;
		snapshot.updatedAt = observedAt;
		this.schedulePersist(snapshot);
		return cloneEntry(entry);
	}

	async setMaxConcurrentRequests(
		input: NKleinModelRegistryKeyInput & { maxConcurrentRequests: number | null; createdAt?: number },
	): Promise<NKleinModelRegistryEntry> {
		const snapshot = await this.mutableSnapshot();
		const observedAt = input.createdAt ?? this.now();
		const entry = this.getOrCreateEntry(snapshot, input, observedAt);
		entry.constraints.maxConcurrentRequests = normalizePositiveInteger(input.maxConcurrentRequests);
		entry.updatedAt = observedAt;
		snapshot.updatedAt = observedAt;
		this.schedulePersist(snapshot);
		return cloneEntry(entry);
	}

	async removeEntry(key: string): Promise<boolean> {
		return (await this.removeEntries([key])) === 1;
	}

	async removeEntries(keys: readonly string[]): Promise<number> {
		const normalizedKeys = [...new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0))];
		if (normalizedKeys.length === 0) {
			return 0;
		}
		const snapshot = await this.mutableSnapshot();
		let removed = 0;
		for (const key of normalizedKeys) {
			if (Object.hasOwn(snapshot.models, key)) {
				delete snapshot.models[key];
				removed += 1;
			}
		}
		if (removed === 0) {
			return 0;
		}
		snapshot.updatedAt = this.now();
		this.schedulePersist(snapshot);
		return removed;
	}

	async flush(): Promise<void> {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		await this.drainPersistQueue();
		if (this.persistInFlight) {
			await this.persistInFlight;
		}
	}

	async getSnapshot(): Promise<NKleinModelRegistrySnapshot>;
	getSnapshot(): NKleinModelRegistrySnapshot;
	getSnapshot(): NKleinModelRegistrySnapshot | Promise<NKleinModelRegistrySnapshot> {
		if (!this.snapshot) {
			return this.load();
		}
		return {
			schemaVersion: this.snapshot.schemaVersion,
			updatedAt: this.snapshot.updatedAt,
			models: Object.fromEntries(
				Object.entries(this.snapshot.models).map(([key, entry]) => [key, cloneEntry(entry, this.now())]),
			),
		};
	}

	private async mutableSnapshot(): Promise<NKleinModelRegistrySnapshot> {
		if (!this.snapshot) {
			await this.load();
		}
		if (!this.snapshot) {
			this.snapshot = normalizeSnapshot(null, this.now());
		}
		return this.snapshot;
	}

	private getOrCreateEntry(
		snapshot: NKleinModelRegistrySnapshot,
		input: NKleinModelRegistryKeyInput,
		now: number,
	): NKleinModelRegistryEntry {
		const key = buildNKleinModelRegistryKey(input);
		const existing = snapshot.models[key];
		if (existing) {
			return existing;
		}
		const entry = createNKleinModelRegistryEntry(input, now);
		snapshot.models[entry.key] = entry;
		return entry;
	}

	private schedulePersist(snapshot: NKleinModelRegistrySnapshot): void {
		this.snapshotToPersist = snapshot;
		if (!this.pendingPersist) {
			this.pendingPersist = new Promise((resolve, reject) => {
				this.resolvePendingPersist = resolve;
				this.rejectPendingPersist = reject;
			});
			this.pendingPersist.catch(() => undefined);
		}
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			void this.drainPersistQueue();
		}, this.persistDebounceMs);
	}

	private async drainPersistQueue(): Promise<void> {
		if (this.persistInFlight) {
			await this.persistInFlight;
		}
		const snapshot = this.snapshotToPersist;
		if (!snapshot) {
			return;
		}
		const resolve = this.resolvePendingPersist;
		const reject = this.rejectPendingPersist;
		this.snapshotToPersist = null;
		this.pendingPersist = null;
		this.resolvePendingPersist = null;
		this.rejectPendingPersist = null;
		const persist = this.persist(snapshot);
		this.persistInFlight = persist;
		try {
			await persist;
			resolve?.();
		} catch (error) {
			reject?.(error);
			throw error;
		} finally {
			if (this.persistInFlight === persist) {
				this.persistInFlight = null;
			}
		}
		if (this.snapshotToPersist && !this.persistTimer) {
			await this.drainPersistQueue();
		}
	}

	private async persist(snapshot: NKleinModelRegistrySnapshot): Promise<void> {
		await lockedFileSystem.writeJsonFileAtomic(this.registryPath, snapshot, {
			lock: {
				path: dirname(this.registryPath),
				type: "directory",
				lockfileName: ".model-registry.lock",
			},
		});
	}
}

function inferDecodeMs(wallTimeMs: number, ttftMs: number | null): number | null {
	const wallTime = normalizePositiveNumber(wallTimeMs);
	if (!wallTime) {
		return null;
	}
	if (!ttftMs) {
		return wallTime;
	}
	const decoded = wallTime - ttftMs;
	return decoded > 0 ? decoded : null;
}

let defaultRegistry: NKleinModelRegistry | null = null;

export function getDefaultNKleinModelRegistry(): NKleinModelRegistry {
	defaultRegistry ??= new NKleinModelRegistry();
	return defaultRegistry;
}

export function resetDefaultNKleinModelRegistryForTests(): void {
	defaultRegistry = null;
}

export interface NKleinModelRegistryEventObservation extends NKleinModelRegistryRequestObservation {}

type NKleinSdkUsageEvent = Extract<NKleinSdkAgentEvent, { type: "usage" }>;

function readUsageTokens(usage: NKleinSdkUsageEvent): { promptTokens: number; outputTokens: number } | null {
	const promptTokens = normalizePositiveInteger(usage.inputTokens);
	const outputTokens = normalizePositiveInteger(usage.outputTokens);
	if (promptTokens === null || outputTokens === null) {
		return null;
	}
	return { promptTokens, outputTokens };
}

function readUsageEvent(event: NKleinSdkSessionEvent): NKleinSdkUsageEvent | null {
	if (event.type !== "agent_event") {
		return null;
	}
	return event.payload.event.type === "usage" ? event.payload.event : null;
}

export function extractNKleinModelRegistryObservationFromEvent(
	event: NKleinSdkSessionEvent,
	model: NKleinModelRegistryKeyInput & { contextWindow?: number | null },
	now: number,
	wallTimeMsFallback?: number | null,
): NKleinModelRegistryEventObservation | null {
	const usageEvent = readUsageEvent(event);
	if (!usageEvent) {
		return null;
	}
	const tokens = readUsageTokens(usageEvent);
	if (!tokens) {
		return null;
	}
	const durationMs = normalizePositiveNumber(wallTimeMsFallback);
	if (!durationMs) {
		return null;
	}
	return {
		providerId: model.providerId,
		modelId: model.modelId,
		endpoint: model.endpoint,
		contextWindow: model.contextWindow ?? null,
		promptTokens: tokens.promptTokens,
		outputTokens: tokens.outputTokens,
		cacheReadTokens: normalizePositiveInteger(usageEvent.cacheReadTokens) ?? 0,
		cacheWriteTokens: normalizePositiveInteger(usageEvent.cacheWriteTokens) ?? 0,
		wallTimeMs: durationMs,
		createdAt: now,
	};
}
