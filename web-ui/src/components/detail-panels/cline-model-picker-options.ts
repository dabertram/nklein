import type { SearchSelectOption } from "@/components/search-select-dropdown";
import { formatClineModelContextWindowLabel } from "@/runtime/cline-context-window-policy";
import type { RuntimeClineProviderModel, RuntimeClineReasoningEffort } from "@/runtime/types";

export const CLINE_RECOMMENDED_MODEL_IDS = [] as const;

const CLINE_MODEL_NAME_BY_ID: Record<string, string> = {};

export const CLINE_REASONING_EFFORT_OPTIONS: SearchSelectOption[] = [
	{ value: "", label: "Default" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra high" },
];

export interface BuildClineAgentModelPickerOptionsResult {
	options: SearchSelectOption[];
	recommendedModelIds: string[];
	shouldPinSelectedModelToTop: boolean;
}

export function buildClineAgentModelPickerOptions(
	_providerId: string,
	providerModels: readonly RuntimeClineProviderModel[],
): BuildClineAgentModelPickerOptionsResult {
	const defaultOptions = providerModels.map((model) => ({
		value: model.id,
		label: formatClineModelContextWindowLabel(model),
	}));
	return {
		options: defaultOptions,
		recommendedModelIds: [],
		shouldPinSelectedModelToTop: true,
	};
}

export function formatClineReasoningEffortLabel(value: RuntimeClineReasoningEffort | "" | null | undefined): string {
	return CLINE_REASONING_EFFORT_OPTIONS.find((option) => option.value === (value ?? ""))?.label ?? "Default";
}

export function formatClineSelectedModelButtonText({
	modelName,
	reasoningEffort,
	showReasoningEffort = false,
}: {
	modelName: string;
	reasoningEffort?: RuntimeClineReasoningEffort | "" | null;
	showReasoningEffort?: boolean;
}): string {
	if (!showReasoningEffort || !reasoningEffort) {
		return modelName;
	}
	return `${modelName} (${formatClineReasoningEffortLabel(reasoningEffort)})`;
}

export function getClineReasoningEnabledModelIds(providerModels: readonly RuntimeClineProviderModel[]): string[] {
	return providerModels.filter((model) => model.supportsReasoningEffort).map((model) => model.id);
}

export function resolveClineModelDisplayName(modelId: string): string {
	const trimmedModelId = modelId.trim();
	if (!trimmedModelId) {
		return modelId;
	}
	const configuredName = CLINE_MODEL_NAME_BY_ID[trimmedModelId];
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

export function buildClineSelectedModelButtonText({
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
	reasoningEffort?: RuntimeClineReasoningEffort | "" | null;
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
	return formatClineSelectedModelButtonText({
		modelName: selectedModelName,
		reasoningEffort,
		showReasoningEffort,
	});
}
