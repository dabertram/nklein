import type { RuntimeNKleinProviderModel } from "../core/api-contract";
import type { NKleinModelRegistryEntry } from "./nklein-model-registry";

/**
 * Pure parsing + normalization of discovered provider models, extracted from the oversized `nklein-provider-service.ts`
 * (todo §5.U). Turns raw model-list payloads (LM Studio's `/api/v0|v1/models`, generic OpenAI-style lists) into
 * `RuntimeNKleinProviderModel[]`, normalizes context windows, dedupes, and merges discovered models with a
 * context-window fallback or the measured model registry. No I/O — the provider service's fetchers feed these. LM
 * Studio pathnames are passed as plain `string` so this module stays decoupled from the service's pathname unions.
 */

function readObjectValue(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function readStringField(value: Record<string, unknown>, keys: readonly string[]): string | null {
	for (const key of keys) {
		const fieldValue = value[key];
		if (typeof fieldValue === "string") {
			const normalized = fieldValue.trim();
			if (normalized.length > 0) {
				return normalized;
			}
		}
	}
	return null;
}

function readNumberField(value: Record<string, unknown>, keys: readonly string[]): number | null {
	for (const key of keys) {
		const fieldValue = value[key];
		if (typeof fieldValue === "number" && Number.isFinite(fieldValue) && fieldValue > 0) {
			return Math.trunc(fieldValue);
		}
	}
	return null;
}

export function normalizeContextWindow(value: number | null | undefined): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	return null;
}

export function toRuntimeProviderModel(model: RuntimeNKleinProviderModel): RuntimeNKleinProviderModel {
	return {
		id: model.id,
		name: model.name?.trim() || model.id,
		...(model.type?.trim() ? { type: model.type.trim() } : {}),
		contextWindow: model.contextWindow,
		supportsVision: model.supportsVision || undefined,
		supportsAttachments: model.supportsAttachments || undefined,
		supportsReasoningEffort: model.supportsReasoningEffort || undefined,
	};
}

function getDiscoveredModelSortRank(model: RuntimeNKleinProviderModel): number {
	return model.type?.trim().toLowerCase() === "embeddings" ? 0 : 1;
}

export function sortDiscoveredProviderModels(models: RuntimeNKleinProviderModel[]): RuntimeNKleinProviderModel[] {
	return [...models].sort((left, right) => {
		const rankComparison = getDiscoveredModelSortRank(left) - getDiscoveredModelSortRank(right);
		return rankComparison !== 0 ? rankComparison : left.name.localeCompare(right.name);
	});
}

export function mergeProviderModelsWithContextWindowFallback(
	models: RuntimeNKleinProviderModel[],
	fallbackModels: RuntimeNKleinProviderModel[],
	options?: { preferFallbackContextWindow?: boolean },
): RuntimeNKleinProviderModel[] {
	const fallbackById = new Map(fallbackModels.map((model) => [model.id, model] as const));
	return models.map((model) => {
		const fallbackContextWindow = normalizeContextWindow(fallbackById.get(model.id)?.contextWindow);
		if (options?.preferFallbackContextWindow && fallbackContextWindow !== null) {
			return { ...model, contextWindow: fallbackContextWindow };
		}
		if (normalizeContextWindow(model.contextWindow) !== null) {
			return model;
		}
		return fallbackContextWindow ? { ...model, contextWindow: fallbackContextWindow } : model;
	});
}

export function mergeProviderModelsWithModelRegistry(
	providerId: string,
	models: RuntimeNKleinProviderModel[],
	registryEntries: readonly NKleinModelRegistryEntry[],
): RuntimeNKleinProviderModel[] {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId || registryEntries.length === 0) {
		return models;
	}
	const measuredWindowByModelId = new Map<string, number>();
	for (const entry of registryEntries) {
		if (entry.providerId.trim().toLowerCase() !== normalizedProviderId) {
			continue;
		}
		const measuredWindow = normalizeContextWindow(entry.contextWindow.effective);
		if (measuredWindow !== null) {
			measuredWindowByModelId.set(entry.modelId, measuredWindow);
		}
	}
	if (measuredWindowByModelId.size === 0) {
		return models;
	}
	return models.map((model) => {
		const measuredWindow = measuredWindowByModelId.get(model.id);
		return measuredWindow ? { ...model, contextWindow: measuredWindow } : model;
	});
}

function toLmStudioModel(item: unknown, pathname: string): RuntimeNKleinProviderModel | null {
	const record = readObjectValue(item);
	if (!record) {
		return null;
	}
	const id =
		pathname === "/api/v0/models"
			? readStringField(record, ["id"])
			: readStringField(record, ["id", "key", "model", "model_name", "name"]);
	if (!id) {
		return null;
	}
	const modelInfo = readObjectValue(record.model_info);
	const contextWindow =
		readNumberField(record, [
			"loaded_context_length",
			"loadedContextLength",
			"loaded_context_window",
			"max_context_length",
			"context_length",
			"contextWindow",
			"context_window",
			"max_input_tokens",
		]) ??
		(modelInfo
			? readNumberField(modelInfo, [
					"loaded_context_length",
					"loadedContextLength",
					"loaded_context_window",
					"context_length",
					"max_context_length",
					"max_input_tokens",
				])
			: null);
	const type = readStringField(record, ["type"]);
	return {
		id,
		name: readStringField(record, ["name", "display_name"]) ?? id,
		...(type ? { type } : {}),
		...(contextWindow ? { contextWindow } : {}),
	};
}

function readArrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function toLmStudioModels(item: unknown, pathname: string): RuntimeNKleinProviderModel[] {
	const model = toLmStudioModel(item, pathname);
	if (pathname !== "/api/v1/models" || !model) {
		return model ? [model] : [];
	}

	const record = readObjectValue(item);
	const loadedInstanceModels = readArrayValue(record?.loaded_instances).flatMap((loadedInstance) => {
		const loadedRecord = readObjectValue(loadedInstance);
		if (!loadedRecord) {
			return [];
		}
		const id = readStringField(loadedRecord, ["id"]);
		if (!id) {
			return [];
		}
		const config = readObjectValue(loadedRecord.config);
		const contextWindow =
			(config
				? readNumberField(config, [
						"loaded_context_length",
						"loadedContextLength",
						"loaded_context_window",
						"context_length",
						"max_context_length",
						"max_input_tokens",
					])
				: null) ?? model.contextWindow;
		const type = readStringField(loadedRecord, ["type"]) ?? model.type;
		return [
			{
				...model,
				id,
				name: model.name,
				...(type ? { type } : {}),
				...(contextWindow ? { contextWindow } : {}),
			},
		];
	});

	return loadedInstanceModels;
}

function toGenericProviderModel(item: unknown): RuntimeNKleinProviderModel | null {
	if (typeof item === "string") {
		const id = item.trim();
		return id ? { id, name: id } : null;
	}
	const record = readObjectValue(item);
	if (!record) {
		return null;
	}
	const id = readStringField(record, ["id", "model", "model_name", "key", "name"]);
	if (!id) {
		return null;
	}
	const contextWindow = readNumberField(record, [
		"context_length",
		"contextWindow",
		"context_window",
		"max_context_length",
		"max_input_tokens",
		"loaded_context_length",
		"loadedContextLength",
		"loaded_context_window",
	]);
	const type = readStringField(record, ["type"]);
	return {
		id,
		name: readStringField(record, ["name", "display_name", "model_name"]) ?? id,
		...(type ? { type } : {}),
		...(contextWindow ? { contextWindow } : {}),
	};
}

function dedupeProviderModels(models: RuntimeNKleinProviderModel[]): RuntimeNKleinProviderModel[] {
	const modelsById = new Map<string, RuntimeNKleinProviderModel>();
	for (const model of models) {
		const existing = modelsById.get(model.id);
		if (!existing) {
			modelsById.set(model.id, model);
			continue;
		}
		modelsById.set(model.id, {
			...existing,
			...model,
			contextWindow: existing.contextWindow ?? model.contextWindow,
		});
	}
	return [...modelsById.values()];
}

export function extractDiscoveredModelsFromPayload(value: unknown, sourceUrl: string): RuntimeNKleinProviderModel[] {
	const pathname = (() => {
		try {
			return new URL(sourceUrl).pathname.replace(/\/+$/u, "");
		} catch {
			return "";
		}
	})();
	const record = readObjectValue(value);
	const candidateItems = record
		? [...readArrayValue(record.data), ...readArrayValue(record.models)]
		: Array.isArray(value)
			? value
			: [];
	if (candidateItems.length === 0) {
		return [];
	}
	if (pathname === "/api/v0/models" || pathname === "/api/v1/models") {
		return dedupeProviderModels(candidateItems.flatMap((item) => toLmStudioModels(item, pathname)));
	}
	return dedupeProviderModels(
		candidateItems
			.map((item) => toGenericProviderModel(item))
			.filter((model): model is RuntimeNKleinProviderModel => model !== null),
	);
}
