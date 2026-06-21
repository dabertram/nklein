import * as Collapsible from "@radix-ui/react-collapsible";
import { getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { NKleinChatModelSelector } from "@/components/detail-panels/nklein-chat-model-selector";
import {
	buildNKleinAgentModelPickerOptions,
	buildNKleinSelectedModelButtonText,
	getNKleinReasoningEnabledModelIds,
} from "@/components/detail-panels/nklein-model-picker-options";
import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { filterVisibleNKleinProviderCatalog, isKnownCloudProviderId } from "@/runtime/native-agent";
import { isLmStudioProviderId } from "@/runtime/nklein-context-window-policy";
import { fetchNKleinProviderCatalog, fetchNKleinProviderModels } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeNKleinReasoningEffort,
	RuntimeTaskNKleinSettings,
} from "@/runtime/types";

// ---------------------------------------------------------------------------
// Hook: manages fetch state for NKlein provider catalog + model lists
// ---------------------------------------------------------------------------

export interface UseTaskAgentModelPickerInput {
	active: boolean;
	workspaceId: string | null;
	agentId: RuntimeAgentId | undefined;
	nkleinSettings?: RuntimeTaskNKleinSettings;
	/** The default agent ID from runtimeConfig.selectedAgentId — used to build the first option label */
	defaultAgentId?: RuntimeAgentId | null;
	/** The default NKlein provider ID from runtimeConfig.nkleinProviderSettings.providerId */
	defaultProviderId?: string | null;
	/** The default NKlein model ID from runtimeConfig.nkleinProviderSettings.modelId */
	defaultModelId?: string | null;
	/** Ignored in local-only builds; retained for older call sites/tests. */
	cloudProviderSupportEnabled?: boolean;
}

export interface UseTaskAgentModelPickerResult {
	agentOptions: Array<{ value: string; label: string }>;
	nkleinProviderOptions: Array<{ value: string; label: string }>;
	nkleinModelOptions: Array<{ value: string; label: string }>;
	effectiveDefaultModelId: string | null;
	providerModels: RuntimeNKleinProviderModel[];
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	/** Map of provider ID → its default model ID (from the provider catalog). */
	providerDefaultModels: Record<string, string>;
}

export function useTaskAgentModelPicker({
	active,
	workspaceId,
	agentId,
	nkleinSettings,
	defaultAgentId,
	defaultProviderId,
	defaultModelId,
	cloudProviderSupportEnabled: _cloudProviderSupportEnabled = false,
}: UseTaskAgentModelPickerInput): UseTaskAgentModelPickerResult {
	void _cloudProviderSupportEnabled;
	const [providerCatalog, setProviderCatalog] = useState<RuntimeNKleinProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeNKleinProviderModel[]>([]);
	const [isLoadingProviders, setIsLoadingProviders] = useState(false);
	const [isLoadingModels, setIsLoadingModels] = useState(false);

	// Derive the effective agent: explicit override takes precedence, then the global default
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;

	useEffect(() => {
		if (!active || effectiveAgentId !== "nklein") {
			return;
		}
		let cancelled = false;
		setIsLoadingProviders(true);
		void fetchNKleinProviderCatalog(workspaceId)
			.then((catalog) => {
				if (!cancelled) {
					setProviderCatalog(filterVisibleNKleinProviderCatalog(catalog, false));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProviderCatalog([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingProviders(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId, workspaceId]);

	// Derive the effective provider: explicit override takes precedence, then the global default
	const nkleinProviderId = nkleinSettings?.providerId;
	const requestedProviderId = (nkleinProviderId ?? defaultProviderId ?? "").trim();
	const effectiveProviderId = useMemo(() => {
		if (!requestedProviderId) {
			return null;
		}
		if (providerCatalog.some((provider) => provider.id.trim().toLowerCase() === requestedProviderId.toLowerCase())) {
			return requestedProviderId;
		}
		if (isKnownCloudProviderId(requestedProviderId)) {
			return null;
		}
		return providerCatalog.length === 0 ? requestedProviderId : null;
	}, [providerCatalog, requestedProviderId]);

	useEffect(() => {
		if (!active || effectiveAgentId !== "nklein" || !effectiveProviderId) {
			setProviderModels([]);
			return;
		}
		let cancelled = false;
		setIsLoadingModels(true);
		void fetchNKleinProviderModels(workspaceId, effectiveProviderId)
			.then((models) => {
				if (!cancelled) {
					setProviderModels(models);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProviderModels([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId, effectiveProviderId, workspaceId]);

	const agentOptions = useMemo(() => {
		const catalog = getRuntimeLaunchSupportedAgentCatalog();
		let firstLabel = "Default";
		if (defaultAgentId) {
			const defaultAgent = catalog.find((a) => a.id === defaultAgentId);
			if (defaultAgent) {
				firstLabel = defaultAgent.label;
			}
		}
		return [
			{ value: "", label: firstLabel },
			// Exclude the default agent from the explicit list — it's already represented by the first option
			...catalog
				.filter((agent) => agent.id !== defaultAgentId)
				.map((agent) => ({ value: agent.id, label: agent.label })),
		];
	}, [defaultAgentId]);

	const nkleinProviderOptions = useMemo(() => {
		let firstLabel = "Default";
		if (defaultProviderId) {
			const defaultProvider = providerCatalog.find((p) => p.id === defaultProviderId);
			firstLabel = defaultProvider ? defaultProvider.name : "Default";
		}
		return [
			{ value: "", label: firstLabel },
			// Exclude the default provider from the explicit list — it's already represented by the first option
			...providerCatalog.filter((p) => p.id !== defaultProviderId).map((p) => ({ value: p.id, label: p.name })),
		];
	}, [providerCatalog, defaultProviderId]);

	// Map of provider ID → its catalog default model ID. Used by the component to
	// auto-select the right model when the user switches providers.
	const providerDefaultModels = useMemo(() => {
		const map: Record<string, string> = {};
		for (const p of providerCatalog) {
			if (p.defaultModelId) {
				map[p.id] = p.defaultModelId;
			}
		}
		return map;
	}, [providerCatalog]);

	// When an explicit provider override is selected, the "Default" model label should
	// reflect that provider's default model — not the global settings model.
	const effectiveDefaultModelId = useMemo(() => {
		if (nkleinProviderId) {
			if (isLmStudioProviderId(nkleinProviderId)) {
				return null;
			}
			if (!effectiveProviderId) {
				return null;
			}
			const provider = providerCatalog.find((p) => p.id === nkleinProviderId);
			return provider?.defaultModelId ?? null;
		}
		const inheritedProviderDefaultModelId =
			providerCatalog.find((p) => p.id === defaultProviderId)?.defaultModelId ?? null;
		return effectiveProviderId ? (defaultModelId ?? inheritedProviderDefaultModelId) : null;
	}, [nkleinProviderId, effectiveProviderId, defaultModelId, defaultProviderId, providerCatalog]);

	const nkleinModelOptions = useMemo(() => {
		let defaultLabel = "Default";
		if (effectiveDefaultModelId) {
			const defaultModel = providerModels.find((m) => m.id === effectiveDefaultModelId);
			defaultLabel = defaultModel ? defaultModel.name : effectiveDefaultModelId;
		}
		const defaultOptions =
			nkleinProviderId && isLmStudioProviderId(nkleinProviderId) ? [] : [{ value: "", label: defaultLabel }];
		return [
			...defaultOptions,
			// Exclude the default model from the explicit list — it's already represented by the first option
			...providerModels.filter((m) => m.id !== effectiveDefaultModelId).map((m) => ({ value: m.id, label: m.name })),
		];
	}, [nkleinProviderId, providerModels, effectiveDefaultModelId]);

	return {
		agentOptions,
		nkleinProviderOptions,
		nkleinModelOptions,
		effectiveDefaultModelId,
		providerModels,
		isLoadingProviders,
		isLoadingModels,
		providerDefaultModels,
	};
}

function cloneTaskNKleinSettings(settings?: RuntimeTaskNKleinSettings): RuntimeTaskNKleinSettings | undefined {
	if (settings === undefined) {
		return undefined;
	}
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
	};
}

// ---------------------------------------------------------------------------
// Component: renders Agent, NKlein provider, and NKlein model pickers
// ---------------------------------------------------------------------------

export function TaskAgentModelPicker({
	agentId,
	onAgentIdChange,
	nkleinSettings,
	onNKleinSettingsChange,
	agentOptions,
	nkleinProviderOptions,
	nkleinModelOptions,
	effectiveDefaultModelId = null,
	providerModels = [],
	isLoadingProviders,
	isLoadingModels,
	onPopoverOpenChange,
	defaultAgentId,
	defaultProviderId,
	defaultReasoningEffort,
	providerDefaultModels,
}: {
	agentId: RuntimeAgentId | undefined;
	onAgentIdChange: (value: RuntimeAgentId | undefined) => void;
	nkleinSettings?: RuntimeTaskNKleinSettings | undefined;
	onNKleinSettingsChange?: (value: RuntimeTaskNKleinSettings | undefined) => void;
	agentOptions: Array<{ value: string; label: string }>;
	nkleinProviderOptions: Array<{ value: string; label: string }>;
	nkleinModelOptions: Array<{ value: string; label: string }>;
	effectiveDefaultModelId?: string | null;
	providerModels?: RuntimeNKleinProviderModel[];
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	onPopoverOpenChange?: (open: boolean) => void;
	/** The default agent ID from runtimeConfig — used to decide if NKlein pickers should show by default */
	defaultAgentId?: RuntimeAgentId | null;
	/** The default NKlein provider ID from runtimeConfig — used to decide if model picker should show by default */
	defaultProviderId?: string | null;
	/** The global default reasoning effort from runtimeConfig.nkleinProviderSettings.reasoningEffort */
	defaultReasoningEffort?: RuntimeNKleinReasoningEffort | null;
	/** Map of provider ID → its default model ID (from the provider catalog). */
	providerDefaultModels?: Record<string, string>;
}): ReactElement {
	const nkleinProviderId = nkleinSettings?.providerId;
	const nkleinModelId = nkleinSettings?.modelId;
	const nkleinReasoningEffort = nkleinSettings?.reasoningEffort;

	const updateTaskNKleinSettings = useCallback(
		(updater: (current: RuntimeTaskNKleinSettings | undefined) => RuntimeTaskNKleinSettings | undefined) => {
			onNKleinSettingsChange?.(updater(cloneTaskNKleinSettings(nkleinSettings)));
		},
		[nkleinSettings, onNKleinSettingsChange],
	);

	// Show the NKlein provider picker when the effective agent is "nklein"
	// (either explicitly overridden to nklein, or defaulting to nklein)
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const showNKleinProviderPicker = effectiveAgentId === "nklein";

	// Show the NKlein model picker when a provider is effectively selected
	// (either explicitly overridden, or the global default provider is set)
	const effectiveProviderId = nkleinProviderId ?? defaultProviderId ?? null;
	const hasExplicitLmStudioProviderOverride = nkleinProviderId !== undefined && isLmStudioProviderId(nkleinProviderId);
	const showNKleinModelPicker = showNKleinProviderPicker && Boolean(effectiveProviderId);
	const hasTaskNKleinSettingsOverride = nkleinSettings !== undefined;
	const selectedTaskReasoningEffort = nkleinReasoningEffort ?? "";
	const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
	const [isProviderPopoverOpen, setIsProviderPopoverOpen] = useState(false);
	const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
	const [reasoningEffort, setReasoningEffort] = useState<RuntimeNKleinReasoningEffort | "">(
		hasTaskNKleinSettingsOverride ? selectedTaskReasoningEffort : (defaultReasoningEffort ?? ""),
	);
	const setReasoningEffortWithOverride = useCallback(
		(nextReasoningEffort: RuntimeNKleinReasoningEffort | "") => {
			setReasoningEffort(nextReasoningEffort);
			updateTaskNKleinSettings((currentSettings) => {
				const nextSettings = cloneTaskNKleinSettings(currentSettings) ?? {};
				if (nextReasoningEffort) {
					nextSettings.reasoningEffort = nextReasoningEffort;
					return nextSettings;
				}
				delete nextSettings.reasoningEffort;
				if (
					nextSettings.providerId ||
					nextSettings.modelId ||
					currentSettings !== undefined ||
					defaultReasoningEffort
				) {
					return nextSettings;
				}
				return undefined;
			});
		},
		[defaultReasoningEffort, updateTaskNKleinSettings],
	);

	const modelPickerOptions = useMemo(() => {
		const defaultOption = nkleinModelOptions.find((option) => option.value === "");
		const explicitOptions = nkleinModelOptions.filter((option) => option.value !== "");
		const providerId = (effectiveProviderId ?? "").trim();

		if (!providerId || explicitOptions.length === 0) {
			return {
				options: defaultOption ? [defaultOption, ...explicitOptions] : explicitOptions,
				recommendedModelIds: [] as string[],
				shouldPinSelectedModelToTop: true,
			};
		}

		const orderedOptions = buildNKleinAgentModelPickerOptions(providerId, providerModels);
		const explicitOptionByValue = new Map(explicitOptions.map((option) => [option.value, option] as const));
		const orderedExplicit = orderedOptions.options
			.map((option) => explicitOptionByValue.get(option.value))
			.filter((option): option is { value: string; label: string } => option !== undefined);
		const orderedExplicitValueSet = new Set(orderedExplicit.map((option) => option.value));
		const remainingExplicit = explicitOptions.filter((option) => !orderedExplicitValueSet.has(option.value));

		return {
			options: defaultOption ? [defaultOption, ...orderedExplicit, ...remainingExplicit] : orderedExplicit,
			recommendedModelIds: orderedOptions.recommendedModelIds,
			shouldPinSelectedModelToTop: orderedOptions.shouldPinSelectedModelToTop,
		};
	}, [nkleinModelOptions, effectiveProviderId, providerModels]);

	const reasoningEnabledModelIds = useMemo(() => getNKleinReasoningEnabledModelIds(providerModels), [providerModels]);
	const reasoningEnabledModelIdSet = useMemo(() => new Set(reasoningEnabledModelIds), [reasoningEnabledModelIds]);
	const effectiveSelectedModelId = (nkleinModelId ?? effectiveDefaultModelId ?? "").trim();
	const selectedModelCapabilityKnown = useMemo(
		() => providerModels.some((model) => model.id === effectiveSelectedModelId),
		[effectiveSelectedModelId, providerModels],
	);
	const selectedModelSupportsReasoningEffort = reasoningEnabledModelIdSet.has(effectiveSelectedModelId);

	useEffect(() => {
		if (!hasTaskNKleinSettingsOverride) {
			return;
		}
		if (selectedTaskReasoningEffort !== reasoningEffort) {
			setReasoningEffort(selectedTaskReasoningEffort);
		}
	}, [hasTaskNKleinSettingsOverride, reasoningEffort, selectedTaskReasoningEffort]);

	useEffect(() => {
		if (hasTaskNKleinSettingsOverride) {
			return;
		}
		const inheritedReasoningEffort = defaultReasoningEffort ?? "";
		if (reasoningEffort !== inheritedReasoningEffort) {
			setReasoningEffort(inheritedReasoningEffort);
		}
	}, [defaultReasoningEffort, hasTaskNKleinSettingsOverride, reasoningEffort]);

	useEffect(() => {
		if (!isSettingsExpanded) {
			setIsProviderPopoverOpen(false);
			setIsModelPopoverOpen(false);
		}
	}, [isSettingsExpanded]);

	useEffect(() => {
		onPopoverOpenChange?.(isProviderPopoverOpen || isModelPopoverOpen);
	}, [isModelPopoverOpen, isProviderPopoverOpen, onPopoverOpenChange]);

	useEffect(() => {
		if (!selectedModelCapabilityKnown) {
			return;
		}
		if (!selectedModelSupportsReasoningEffort && reasoningEffort) {
			setReasoningEffortWithOverride("");
		}
	}, [
		reasoningEffort,
		selectedModelCapabilityKnown,
		selectedModelSupportsReasoningEffort,
		setReasoningEffortWithOverride,
	]);

	const selectedModelButtonText = useMemo(
		() =>
			buildNKleinSelectedModelButtonText({
				modelOptions: modelPickerOptions.options,
				selectedModelId: nkleinModelId ?? "",
				reasoningEffort,
				showReasoningEffort: selectedModelSupportsReasoningEffort,
				isModelLoading: isLoadingModels,
			}),
		[
			nkleinModelId,
			isLoadingModels,
			modelPickerOptions.options,
			reasoningEffort,
			selectedModelSupportsReasoningEffort,
		],
	);

	// When models finish loading and the currently selected model isn't in the
	// options list, auto-select the first real model so the button never shows
	// "No models available". Pick the first non-empty option (skipping the
	// "Default" placeholder) so the user immediately sees a concrete model name.
	//
	// Guard: also skip when model options only contains the "Default"
	// placeholder (length <= 1). This prevents a race condition where the
	// effect fires on the initial render before models have been fetched —
	// at that point isLoadingModels is still false (hasn't been set to true
	// yet by the fetch effect) and the stale/empty options list would
	// incorrectly clear a valid saved nkleinModelId.
	useEffect(() => {
		if (isLoadingModels || !nkleinModelId || modelPickerOptions.options.length <= 1) {
			return;
		}
		const modelExists = modelPickerOptions.options.some((opt) => opt.value === nkleinModelId);
		if (!modelExists) {
			const firstRealModel = modelPickerOptions.options.find((opt) => opt.value !== "");
			updateTaskNKleinSettings((currentSettings) => {
				const nextSettings = cloneTaskNKleinSettings(currentSettings) ?? {};
				if (firstRealModel?.value) {
					nextSettings.modelId = firstRealModel.value;
					return nextSettings;
				}
				delete nextSettings.modelId;
				const preserveEmptyOverride = currentSettings !== undefined && Object.keys(currentSettings).length === 0;
				return nextSettings.providerId || nextSettings.reasoningEffort || preserveEmptyOverride
					? nextSettings
					: undefined;
			});
		}
	}, [nkleinModelId, isLoadingModels, modelPickerOptions.options, updateTaskNKleinSettings]);

	useEffect(() => {
		if (isLoadingModels || !hasExplicitLmStudioProviderOverride || nkleinModelId) {
			return;
		}
		const firstLoadedModel = modelPickerOptions.options.find((option) => option.value !== "");
		if (!firstLoadedModel) {
			return;
		}
		updateTaskNKleinSettings((currentSettings) => ({
			...(cloneTaskNKleinSettings(currentSettings) ?? {}),
			modelId: firstLoadedModel.value,
		}));
	}, [
		nkleinModelId,
		hasExplicitLmStudioProviderOverride,
		isLoadingModels,
		modelPickerOptions.options,
		updateTaskNKleinSettings,
	]);

	return (
		<div className="flex flex-col gap-2">
			<Collapsible.Root open={isSettingsExpanded} onOpenChange={setIsSettingsExpanded}>
				<Collapsible.Trigger asChild>
					<button
						type="button"
						className="inline-flex w-fit items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary cursor-pointer bg-transparent border-none p-0"
					>
						<ChevronDown
							size={12}
							className={cn("transition-transform", isSettingsExpanded ? "rotate-0" : "-rotate-90")}
						/>
						Override Agent Settings
					</button>
				</Collapsible.Trigger>
				<Collapsible.Content className="pt-2">
					<div className="flex flex-col gap-2">
						<div className="w-full sm:w-1/2 min-w-0">
							<span className="text-[11px] text-text-secondary block mb-1">Agent</span>
							<NativeSelect
								size="sm"
								fill
								value={agentId ?? ""}
								onChange={(e) => {
									const value = e.currentTarget.value;
									onAgentIdChange(value ? (value as RuntimeAgentId) : undefined);
									if (value !== "nklein") {
										onNKleinSettingsChange?.(undefined);
										setReasoningEffort("");
									}
								}}
							>
								{agentOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</NativeSelect>
						</div>
						{showNKleinProviderPicker ? (
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								<div className="min-w-0">
									<span className="text-[11px] text-text-secondary block mb-1">
										Provider{isLoadingProviders ? " (loading\u2026)" : ""}
									</span>
									<SearchSelectDropdown
										options={nkleinProviderOptions}
										selectedValue={nkleinProviderId ?? ""}
										onSelect={(value) => {
											const newProviderId = value || undefined;
											const newDefaultModel =
												newProviderId && providerDefaultModels && !isLmStudioProviderId(newProviderId)
													? providerDefaultModels[newProviderId]
													: undefined;
											updateTaskNKleinSettings((currentSettings) => {
												const nextSettings = cloneTaskNKleinSettings(currentSettings) ?? {};
												if (newProviderId) {
													nextSettings.providerId = newProviderId;
												} else {
													delete nextSettings.providerId;
												}
												if (newDefaultModel) {
													nextSettings.modelId = newDefaultModel;
												} else {
													delete nextSettings.modelId;
												}
												delete nextSettings.reasoningEffort;
												const preserveEmptyOverride =
													newProviderId !== undefined ||
													(currentSettings !== undefined && Object.keys(currentSettings).length === 0);
												return nextSettings.providerId || nextSettings.modelId || preserveEmptyOverride
													? nextSettings
													: undefined;
											});
											setReasoningEffort(
												newProviderId ||
													(nkleinSettings !== undefined && Object.keys(nkleinSettings).length === 0)
													? ""
													: (defaultReasoningEffort ?? ""),
											);
										}}
										disabled={isLoadingProviders}
										fill
										size="sm"
										placeholder="Search providers..."
										emptyText="No providers available"
										noResultsText="No matching providers"
										showSelectedIndicator
										onPopoverOpenChange={setIsProviderPopoverOpen}
									/>
								</div>
								{showNKleinModelPicker ? (
									<div className="min-w-0">
										<span className="text-[11px] text-text-secondary block mb-1">
											Model{isLoadingModels ? " (loading\u2026)" : ""}
										</span>
										<NKleinChatModelSelector
											modelOptions={modelPickerOptions.options}
											recommendedModelIds={modelPickerOptions.recommendedModelIds}
											pinSelectedModelToTop={modelPickerOptions.shouldPinSelectedModelToTop}
											selectedModelId={nkleinModelId ?? ""}
											selectedModelButtonText={selectedModelButtonText}
											onSelectModel={(value) => {
												updateTaskNKleinSettings((currentSettings) => {
													const nextSettings = cloneTaskNKleinSettings(currentSettings) ?? {};
													if (value) {
														nextSettings.modelId = value;
													} else {
														delete nextSettings.modelId;
													}
													if (!value || !reasoningEnabledModelIdSet.has(value)) {
														delete nextSettings.reasoningEffort;
													}
													const preserveEmptyOverride =
														currentSettings !== undefined && Object.keys(currentSettings).length === 0;
													return nextSettings.providerId ||
														nextSettings.modelId ||
														nextSettings.reasoningEffort ||
														preserveEmptyOverride
														? nextSettings
														: undefined;
												});
												if (!value && !nkleinProviderId) {
													setReasoningEffort(
														nkleinSettings !== undefined && Object.keys(nkleinSettings).length === 0
															? ""
															: (defaultReasoningEffort ?? ""),
													);
													return;
												}
												if (!value || !reasoningEnabledModelIdSet.has(value)) {
													setReasoningEffortWithOverride("");
												}
											}}
											reasoningEnabledModelIds={reasoningEnabledModelIds}
											defaultOptionSupportsReasoningEffort={
												!nkleinModelId && selectedModelSupportsReasoningEffort
											}
											selectedReasoningEffort={reasoningEffort}
											onSelectReasoningEffort={(nextReasoningEffort) =>
												setReasoningEffortWithOverride(nextReasoningEffort)
											}
											disabled={isLoadingModels}
											isModelLoading={isLoadingModels}
											fill
											triggerVariant="default"
											onPopoverOpenChange={setIsModelPopoverOpen}
										/>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
	);
}
