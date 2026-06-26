import { TRPCError } from "@trpc/server";
import type { RuntimeConfigState } from "../../config/runtime-config";
import type {
	RuntimeNKleinModelContextWindowOverrideResponse,
	RuntimeNKleinModelMaxConcurrentRequestsResponse,
	RuntimeNKleinModelRegistryPruneResponse,
	RuntimeNKleinModelRegistryRemoveResponse,
	RuntimeNKleinModelRegistryResponse,
	RuntimeNKleinProviderSettings,
} from "../../core/api-contract";
import {
	parseNKleinModelContextWindowOverrideRequest,
	parseNKleinModelMaxConcurrentRequestsRequest,
	parseNKleinModelRegistryRemoveRequest,
} from "../../core/api-validation";
import { assertNKleinContextWindowPolicy } from "../../nklein-sdk/nklein-context-window-policy";
import { isLocalProvider } from "../../nklein-sdk/nklein-local-only-policy";
import {
	buildNKleinModelRegistryKey,
	createNKleinModelRegistryEntry,
	getDefaultNKleinModelRegistry,
	type NKleinModelRegistryEntry,
	type NKleinModelRegistryKeyInput,
} from "../../nklein-sdk/nklein-model-registry";
import type { createNKleinProviderService, ResolvedNKleinLaunchConfig } from "../../nklein-sdk/nklein-provider-service";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Handlers for the NKlein model-registry procedures, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). They read/mutate the local model-telemetry registry and surface its
 * configured local entries. The two list/prune handlers depend on a `{ loadScopedRuntimeConfig, nkleinProviderService }`
 * deps slice; the remove/override handlers depend only on their input plus the module-level registry. Behavior and
 * wire contract are unchanged. The local `addConfiguredLocalModelRegistryEntries` helper moved here with them (it was
 * used only by these handlers).
 */
export interface ModelRegistryDeps {
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	nkleinProviderService: ReturnType<typeof createNKleinProviderService>;
}

export function addConfiguredLocalModelRegistryEntries(input: {
	models: Record<string, NKleinModelRegistryEntry>;
	runtimeConfig: RuntimeConfigState | null;
	launchConfig: ResolvedNKleinLaunchConfig | null;
	providerSettings: RuntimeNKleinProviderSettings | null;
	now: number;
}): Record<string, NKleinModelRegistryEntry> {
	const nextModels = { ...input.models };
	const candidates: NKleinModelRegistryKeyInput[] = [];
	if (input.launchConfig?.providerId && input.launchConfig.modelId) {
		candidates.push({
			providerId: input.launchConfig.providerId,
			modelId: input.launchConfig.modelId,
			endpoint: input.launchConfig.baseUrl ?? null,
		});
	}
	if (input.providerSettings?.providerId && input.providerSettings.modelId) {
		candidates.push({
			providerId: input.providerSettings.providerId,
			modelId: input.providerSettings.modelId,
			endpoint: input.providerSettings.baseUrl ?? null,
		});
	}
	for (const settings of Object.values(input.runtimeConfig?.effectiveModelRoles ?? {})) {
		const providerId = settings.providerId?.trim();
		const modelId = settings.modelId?.trim();
		if (!providerId || !modelId) {
			continue;
		}
		candidates.push({ providerId, modelId, endpoint: null });
	}
	for (const candidate of candidates) {
		if (!isLocalProvider(candidate.providerId, candidate.endpoint)) {
			continue;
		}
		const key = buildNKleinModelRegistryKey(candidate);
		if (nextModels[key]) {
			continue;
		}
		nextModels[key] = createNKleinModelRegistryEntry(candidate, input.now);
	}
	return nextModels;
}

export async function handleGetNKleinModelRegistry(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	deps: ModelRegistryDeps,
): Promise<RuntimeNKleinModelRegistryResponse> {
	const snapshot = await getDefaultNKleinModelRegistry().getSnapshot();
	const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
	const launchConfig =
		runtimeConfig?.effectiveSelectedAgentId === "nklein"
			? await deps.nkleinProviderService.resolveLaunchConfig().catch(() => null)
			: null;
	const providerSettings =
		runtimeConfig?.effectiveSelectedAgentId === "nklein"
			? deps.nkleinProviderService.getProviderSettingsSummary()
			: null;
	const models = addConfiguredLocalModelRegistryEntries({
		models: snapshot.models,
		runtimeConfig,
		launchConfig,
		providerSettings,
		now: Date.now(),
	});
	return {
		schemaVersion: snapshot.schemaVersion,
		updatedAt: snapshot.updatedAt,
		models: Object.values(models)
			.filter((entry) => isLocalProvider(entry.providerId, entry.endpoint))
			.sort((left, right) => {
				const updatedDelta = right.updatedAt - left.updatedAt;
				return updatedDelta !== 0 ? updatedDelta : left.key.localeCompare(right.key);
			}),
	};
}

export async function handleRemoveNKleinModelRegistryEntry(
	input: unknown,
): Promise<RuntimeNKleinModelRegistryRemoveResponse> {
	const body = parseNKleinModelRegistryRemoveRequest(input);
	const snapshot = await getDefaultNKleinModelRegistry().getSnapshot();
	const entry = snapshot.models[body.key] ?? null;
	if (entry && !isLocalProvider(entry.providerId, entry.endpoint)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Only local !Klein model telemetry can be removed.",
		});
	}
	const removed = await getDefaultNKleinModelRegistry().removeEntry(body.key);
	return { removed };
}

export async function handlePruneNKleinModelRegistry(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	deps: ModelRegistryDeps,
): Promise<RuntimeNKleinModelRegistryPruneResponse> {
	const registry = getDefaultNKleinModelRegistry();
	const snapshot = await registry.getSnapshot();
	const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
	const launchConfig =
		runtimeConfig?.effectiveSelectedAgentId === "nklein"
			? await deps.nkleinProviderService.resolveLaunchConfig().catch(() => null)
			: null;
	const providerSettings =
		runtimeConfig?.effectiveSelectedAgentId === "nklein"
			? deps.nkleinProviderService.getProviderSettingsSummary()
			: null;
	const configuredModels = addConfiguredLocalModelRegistryEntries({
		models: {},
		runtimeConfig,
		launchConfig,
		providerSettings,
		now: Date.now(),
	});
	const keepKeys = new Set(Object.keys(configuredModels));
	const providerId = providerSettings?.providerId?.trim();
	const providerBaseUrl = providerSettings?.baseUrl ?? null;
	if (providerId && isLocalProvider(providerId, providerBaseUrl)) {
		const loadedModelsResponse = await deps.nkleinProviderService.getProviderModels(providerId).catch(() => null);
		for (const model of loadedModelsResponse?.models ?? []) {
			keepKeys.add(
				buildNKleinModelRegistryKey({
					providerId,
					modelId: model.id,
					endpoint: providerBaseUrl,
				}),
			);
			for (const entry of Object.values(snapshot.models)) {
				if (entry.providerId === providerId && entry.modelId === model.id) {
					keepKeys.add(entry.key);
				}
			}
		}
	}
	const removeKeys = Object.values(snapshot.models)
		.filter((entry) => isLocalProvider(entry.providerId, entry.endpoint))
		.filter((entry) => !keepKeys.has(entry.key))
		.map((entry) => entry.key);
	const removed = await registry.removeEntries(removeKeys);
	return { removed };
}

export async function handleSaveNKleinModelContextWindowOverride(
	input: unknown,
): Promise<RuntimeNKleinModelContextWindowOverrideResponse> {
	const body = parseNKleinModelContextWindowOverrideRequest(input);
	if (!isLocalProvider(body.providerId, body.endpoint)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Context window overrides are only available for local !Klein models.",
		});
	}
	if (body.contextWindow !== null) {
		assertNKleinContextWindowPolicy({
			providerId: body.providerId,
			modelId: body.modelId,
			contextWindow: body.contextWindow,
			label: "Context window override for",
		});
	}
	const model = await getDefaultNKleinModelRegistry().setContextWindowOverride({
		providerId: body.providerId,
		modelId: body.modelId,
		endpoint: body.endpoint,
		contextWindow: body.contextWindow,
	});
	return { model };
}

export async function handleSaveNKleinModelMaxConcurrentRequests(
	input: unknown,
): Promise<RuntimeNKleinModelMaxConcurrentRequestsResponse> {
	const body = parseNKleinModelMaxConcurrentRequestsRequest(input);
	if (!isLocalProvider(body.providerId, body.endpoint)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Per-model concurrency limits are only available for local !Klein models.",
		});
	}
	const model = await getDefaultNKleinModelRegistry().setMaxConcurrentRequests({
		providerId: body.providerId,
		modelId: body.modelId,
		endpoint: body.endpoint,
		maxConcurrentRequests: body.maxConcurrentRequests,
	});
	return { model };
}
