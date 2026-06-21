import type { SearchSelectOption } from "@/components/search-select-dropdown";
import { formatNKleinModelContextWindowLabel } from "@/runtime/nklein-context-window-policy";
import type { RuntimeNKleinProviderModel, RuntimeNKleinReasoningEffort } from "@/runtime/types";

export const NKLEIN_RECOMMENDED_MODEL_IDS = [] as const;

const NKLEIN_MODEL_NAME_BY_ID: Record<string, string> = {};

export const NKLEIN_REASONING_EFFORT_OPTIONS: SearchSelectOption[] = [
	{ value: "", label: "Default" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra high" },
];

export interface BuildNKleinAgentModelPickerOptionsResult {
	options: SearchSelectOption[];
	recommendedModelIds: string[];
	shouldPinSelectedModelToTop: boolean;
}

export function buildNKleinAgentModelPickerOptions(
	_providerId: string,
	providerModels: readonly RuntimeNKleinProviderModel[],
): BuildNKleinAgentModelPickerOptionsResult {
	const defaultOptions = providerModels.map((model) => ({
		value: model.id,
		label: formatNKleinModelContextWindowLabel(model),
	}));
	return {
		options: defaultOptions,
		recommendedModelIds: [],
		shouldPinSelectedModelToTop: true,
	};
}

export function formatNKleinReasoningEffortLabel(value: RuntimeNKleinReasoningEffort | "" | null | undefined): string {
	return NKLEIN_REASONING_EFFORT_OPTIONS.find((option) => option.value === (value ?? ""))?.label ?? "Default";
}

export function formatNKleinSelectedModelButtonText({
	modelName,
	reasoningEffort,
	showReasoningEffort = false,
}: {
	modelName: string;
	reasoningEffort?: RuntimeNKleinReasoningEffort | "" | null;
	showReasoningEffort?: boolean;
}): string {
	if (!showReasoningEffort || !reasoningEffort) {
		return modelName;
	}
	return `${modelName} (${formatNKleinReasoningEffortLabel(reasoningEffort)})`;
}

export function getNKleinReasoningEnabledModelIds(providerModels: readonly RuntimeNKleinProviderModel[]): string[] {
	return providerModels.filter((model) => model.supportsReasoningEffort).map((model) => model.id);
}

export function resolveNKleinModelDisplayName(modelId: string): string {
	const trimmedModelId = modelId.trim();
	if (!trimmedModelId) {
		return modelId;
	}
	const configuredName = NKLEIN_MODEL_NAME_BY_ID[trimmedModelId];
	if (configuredName) {
		return configuredName;
	}
	const modelName = trimmedModelId.split("/").at(-1) ?? trimmedModelId;
	if (/^gpt-/i.test(modelName)) {
		return modelName.replace(/^gpt-/i, "GPT-");
	}
	if (/^claude-/i.test(modelName)) {
		return modelName
			.split("-")
			.map((part) => (part.length > 0 ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part))
			.join(" ");
	}
	return trimmedModelId;
}

export function buildNKleinSelectedModelButtonText({
	modelOptions,
	selectedModelId,
	reasoningEffort,
	showReasoningEffort,
	isModelLoading = false,
	isModelSaving = false,
	loadingLabel = "Loading models...",
	savingLabel = "Saving model...",
	emptyLabel = "Select model",
}: {
	modelOptions: readonly SearchSelectOption[];
	selectedModelId: string;
	reasoningEffort?: RuntimeNKleinReasoningEffort | "" | null;
	showReasoningEffort: boolean;
	isModelLoading?: boolean;
	isModelSaving?: boolean;
	loadingLabel?: string;
	savingLabel?: string;
	emptyLabel?: string;
}): string {
	if (isModelSaving) {
		return savingLabel;
	}
	if (isModelLoading) {
		return loadingLabel;
	}
	const selectedOption = modelOptions.find((option) => option.value === selectedModelId);
	const trimmedModelId = selectedModelId.trim();
	const selectedModelName = selectedOption?.label ?? (trimmedModelId.length > 0 ? trimmedModelId : emptyLabel);
	return formatNKleinSelectedModelButtonText({
		modelName: selectedModelName,
		reasoningEffort,
		showReasoningEffort,
	});
}
