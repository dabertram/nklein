// The per-role model picker for the Settings dialog (§5.X #2 / settings-dialog sections), extracted from the oversized
// `runtime-settings-dialog.tsx`. Each role (architect / worker / reviewer) gets a provider + model + reasoning-effort
// select, an additional-models pool, and per-role availability/context warnings. Controlled: the parent owns the
// `modelRoles` value + onChange (the dialog's unified dirty/save path needs it); the shared role constants/labels and
// normalize/serialize helpers live in `runtime-settings-model-roles.ts`.
import { X } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";

import { MODEL_ROLE_IDS, MODEL_ROLE_LABELS, type ModelRoleId } from "@/components/runtime-settings-model-roles";
import {
	findProviderCatalogItem,
	formatProviderOptionLabel,
	normalizeProviderId,
} from "@/components/runtime-settings-provider-helpers";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import {
	filterVisibleNKleinProviderCatalog,
	isKnownCloudProviderId,
	isVisibleLocalNKleinProvider,
} from "@/runtime/native-agent";
import {
	findNKleinProviderModel,
	formatModelOptionLabel,
	getNKleinModelContextWindowWarning,
	isLmStudioProviderId,
} from "@/runtime/nklein-context-window-policy";
import type {
	RuntimeModelClassCap,
	RuntimeModelRoles,
	RuntimeModelSelectionMode,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeNKleinReasoningEffort,
} from "@/runtime/types";

const REASONING_EFFORT_OPTIONS: Array<RuntimeNKleinReasoningEffort | "inherit"> = [
	"inherit",
	"low",
	"medium",
	"high",
	"xhigh",
];

// §5.AE per-role model-class cap options ("inherit" = no cap, the default). `any` permits any class (cloud stays #1-locked).
const MODEL_CLASS_CAP_OPTIONS: Array<RuntimeModelClassCap | "inherit"> = ["inherit", "small_only", "any_local", "any"];
const MODEL_CLASS_CAP_LABELS: Record<RuntimeModelClassCap | "inherit", string> = {
	inherit: "No cap",
	small_only: "Small only",
	any_local: "Any local",
	any: "Any",
};
const MODEL_SELECTION_MODE_OPTIONS: RuntimeModelSelectionMode[] = ["auto", "pinned"];
const MODEL_SELECTION_MODE_LABELS: Record<RuntimeModelSelectionMode, string> = {
	auto: "Auto",
	pinned: "Pinned",
};

interface ModelRolesEditorProps {
	value: RuntimeModelRoles;
	onChange: Dispatch<SetStateAction<RuntimeModelRoles>>;
	disabled: boolean;
	nkleinProviderId: string;
	providerCatalog: RuntimeNKleinProviderCatalogItem[];
	providerModels: RuntimeNKleinProviderModel[];
	isLoadingProviderModels: boolean;
	modelRoleModelsByProviderId: Record<string, RuntimeNKleinProviderModel[]>;
	loadingModelRoleProviderIds: Record<string, boolean>;
	cloudProviderSupportEnabled: boolean;
}

export function ModelRolesEditor({
	value,
	onChange,
	disabled,
	nkleinProviderId,
	providerCatalog,
	providerModels,
	isLoadingProviderModels,
	modelRoleModelsByProviderId,
	loadingModelRoleProviderIds,
	cloudProviderSupportEnabled,
}: ModelRolesEditorProps): ReactElement {
	const getProviderModels = (providerId: string): RuntimeNKleinProviderModel[] => {
		const normalizedProviderId = normalizeProviderId(providerId || nkleinProviderId);
		if (!normalizedProviderId || normalizedProviderId === normalizeProviderId(nkleinProviderId)) {
			return providerModels;
		}
		return modelRoleModelsByProviderId[normalizedProviderId] ?? [];
	};

	const isProviderLoading = (providerId: string): boolean => {
		const normalizedProviderId = normalizeProviderId(providerId || nkleinProviderId);
		if (!normalizedProviderId || normalizedProviderId === normalizeProviderId(nkleinProviderId)) {
			return isLoadingProviderModels;
		}
		return loadingModelRoleProviderIds[normalizedProviderId] === true;
	};

	const getContextWarning = (roleId: ModelRoleId): string | null => {
		const roleSettings = value[roleId] ?? {};
		const roleProviderId = roleSettings.providerId ?? "";
		const effectiveProviderId = roleProviderId || nkleinProviderId;
		const providerDefaultModelId = roleProviderId
			? (findProviderCatalogItem(providerCatalog, roleProviderId)?.defaultModelId?.trim() ?? "")
			: "";
		const effectiveModelId = roleSettings.modelId?.trim() || providerDefaultModelId;
		if (!effectiveModelId) {
			return null;
		}
		const roleModels = getProviderModels(effectiveProviderId);
		return getNKleinModelContextWindowWarning({
			model: findNKleinProviderModel(roleModels, effectiveModelId),
			modelId: effectiveModelId,
			label: `${MODEL_ROLE_LABELS[roleId]} model`,
		});
	};

	const getAvailabilityWarning = (roleId: ModelRoleId): string | null => {
		const roleSettings = value[roleId] ?? {};
		const roleProviderId = roleSettings.providerId ?? "";
		const effectiveProviderId = roleProviderId || nkleinProviderId;
		if (!isLmStudioProviderId(effectiveProviderId)) {
			return null;
		}
		const roleModelId = roleSettings.modelId?.trim() ?? "";
		if (roleProviderId && !roleModelId) {
			return `${MODEL_ROLE_LABELS[roleId]} role uses LM Studio. Choose a loaded LM Studio model before saving.`;
		}
		if (!roleModelId) {
			return null;
		}
		const roleModels = getProviderModels(effectiveProviderId);
		if (findNKleinProviderModel(roleModels, roleModelId)) {
			return null;
		}
		return `${MODEL_ROLE_LABELS[roleId]} model "${roleModelId}" is not loaded in LM Studio. Load it, refresh models, then choose it before saving.`;
	};

	const handleProviderChange = (roleId: ModelRoleId, providerValue: string) => {
		const trimmedProviderId = providerValue.trim();
		const defaultModelId = trimmedProviderId
			? findProviderCatalogItem(providerCatalog, trimmedProviderId)?.defaultModelId?.trim()
			: undefined;
		onChange((prev) => {
			const next = { ...prev };
			const currentReasoningEffort = prev[roleId]?.reasoningEffort;
			if (!trimmedProviderId) {
				if (currentReasoningEffort) {
					next[roleId] = { reasoningEffort: currentReasoningEffort };
				} else {
					delete next[roleId];
				}
				return next;
			}
			next[roleId] = {
				...prev[roleId],
				providerId: trimmedProviderId,
				...(!isLmStudioProviderId(trimmedProviderId) && defaultModelId ? { modelId: defaultModelId } : {}),
			};
			if (!defaultModelId || isLmStudioProviderId(trimmedProviderId)) {
				delete next[roleId].modelId;
			}
			return next;
		});
	};

	const handleModelChange = (roleId: ModelRoleId, modelValue: string) => {
		const trimmedModelId = modelValue.trim();
		onChange((prev) => {
			const nextRole = { ...prev[roleId] };
			if (trimmedModelId) {
				nextRole.modelId = trimmedModelId;
			} else {
				delete nextRole.modelId;
			}
			return { ...prev, [roleId]: nextRole };
		});
	};

	const handlePoolToggle = (roleId: ModelRoleId, providerId: string, modelId: string) => {
		onChange((prev) => {
			const nextRole = { ...prev[roleId] };
			const existing = nextRole.additionalModels ?? [];
			const isInPool = existing.some((entry) => entry.modelId === modelId);
			const additionalModels = isInPool
				? existing.filter((entry) => entry.modelId !== modelId)
				: [...existing, { ...(providerId ? { providerId } : {}), modelId }];
			if (additionalModels.length > 0) {
				nextRole.additionalModels = additionalModels;
			} else {
				delete nextRole.additionalModels;
			}
			return { ...prev, [roleId]: nextRole };
		});
	};

	const handleReasoningChange = (roleId: ModelRoleId, reasoningValue: RuntimeNKleinReasoningEffort | "inherit") => {
		onChange((prev) => {
			const nextRole = { ...prev[roleId] };
			if (reasoningValue === "inherit") {
				delete nextRole.reasoningEffort;
			} else {
				nextRole.reasoningEffort = reasoningValue;
			}
			return { ...prev, [roleId]: nextRole };
		});
	};

	const handleModelClassCapChange = (roleId: ModelRoleId, capValue: RuntimeModelClassCap | "inherit") => {
		onChange((prev) => {
			const nextRole = { ...prev[roleId] };
			if (capValue === "inherit") {
				delete nextRole.modelClassCap;
			} else {
				nextRole.modelClassCap = capValue;
			}
			return { ...prev, [roleId]: nextRole };
		});
	};

	const handleModelSelectionModeChange = (roleId: ModelRoleId, mode: RuntimeModelSelectionMode) => {
		onChange((prev) => {
			const nextRole = { ...prev[roleId] };
			if (mode === "pinned") {
				nextRole.modelSelectionMode = "pinned";
			} else {
				delete nextRole.modelSelectionMode;
			}
			return { ...prev, [roleId]: nextRole };
		});
	};

	const handleResetRole = (roleId: ModelRoleId) => {
		onChange((prev) => {
			const next = { ...prev };
			delete next[roleId];
			return next;
		});
	};

	const visibleProviderCatalog = filterVisibleNKleinProviderCatalog(providerCatalog, cloudProviderSupportEnabled);

	return (
		<div className="grid gap-3">
			{MODEL_ROLE_IDS.map((roleId) => {
				const roleSettings = value[roleId] ?? {};
				const roleProviderId = roleSettings.providerId ?? "";
				const effectiveProviderId = roleProviderId || nkleinProviderId;
				const roleProvider = roleProviderId ? findProviderCatalogItem(providerCatalog, roleProviderId) : null;
				const roleProviderIsVisibleLocal = roleProvider !== null && isVisibleLocalNKleinProvider(roleProvider);
				const providerSelectId = `runtime-settings-model-role-${roleId}-provider`;
				const modelSelectId = `runtime-settings-model-role-${roleId}-model`;
				const reasoningSelectId = `runtime-settings-model-role-${roleId}-reasoning`;
				const assignmentSelectId = `runtime-settings-model-role-${roleId}-assignment`;
				const roleModels = getProviderModels(effectiveProviderId);
				const selectedRoleModelId = roleSettings.modelId ?? "";
				const selectedRoleModel = roleModels.find((model) => model.id === selectedRoleModelId) ?? null;
				const selectedRoleModelLabel = selectedRoleModel
					? formatModelOptionLabel(selectedRoleModel)
					: selectedRoleModelId || undefined;
				const isLmStudioRoleProvider = isLmStudioProviderId(effectiveProviderId);
				const hasSelectedRoleModel =
					selectedRoleModelId.length > 0 &&
					!isLmStudioRoleProvider &&
					!roleModels.some((model) => model.id === selectedRoleModelId);
				const isRoleProviderLoading = isProviderLoading(effectiveProviderId);
				const hasRoleOverride = Object.keys(roleSettings).length > 0;
				const shouldHideLegacyCloudRoleProvider =
					!cloudProviderSupportEnabled && (!roleProviderIsVisibleLocal || isKnownCloudProviderId(roleProviderId));
				const displayedRoleProviderId = shouldHideLegacyCloudRoleProvider ? "" : roleProviderId;
				const roleAvailabilityWarning = getAvailabilityWarning(roleId);
				const roleContextWarning = getContextWarning(roleId);
				return (
					<div key={roleId} className="grid gap-1">
						<div className="grid items-end gap-2 lg:grid-cols-[110px_minmax(150px,0.75fr)_minmax(330px,1.5fr)_110px_110px_110px_34px]">
							<div className="pb-2 text-[13px] font-medium capitalize text-text-primary">
								{MODEL_ROLE_LABELS[roleId]}
							</div>
							<label className="min-w-0" htmlFor={providerSelectId}>
								<span className="mb-1 block text-[12px] text-text-secondary">Provider</span>
								<NativeSelect
									id={providerSelectId}
									fill
									value={displayedRoleProviderId}
									onChange={(event) => handleProviderChange(roleId, event.target.value)}
									disabled={disabled}
								>
									<option value="">Default</option>
									{roleProvider &&
									roleProviderIsVisibleLocal &&
									!shouldHideLegacyCloudRoleProvider &&
									!visibleProviderCatalog.some((provider) => provider.id === roleProviderId) ? (
										<option value={roleProviderId}>{roleProviderId}</option>
									) : null}
									{visibleProviderCatalog.map((provider) => (
										<option key={provider.id} value={provider.id}>
											{formatProviderOptionLabel(provider)}
										</option>
									))}
									{roleProviderId &&
									!shouldHideLegacyCloudRoleProvider &&
									!roleProvider &&
									!visibleProviderCatalog.some((provider) => provider.id === roleProviderId) ? (
										<option value={roleProviderId}>{roleProviderId}</option>
									) : null}
								</NativeSelect>
							</label>
							<label className="min-w-0" htmlFor={modelSelectId}>
								<span className="mb-1 block text-[12px] text-text-secondary">Model</span>
								<NativeSelect
									id={modelSelectId}
									fill
									value={selectedRoleModelId}
									title={selectedRoleModelLabel}
									onChange={(event) => handleModelChange(roleId, event.target.value)}
									disabled={disabled || isRoleProviderLoading}
								>
									<option value="">
										{isRoleProviderLoading
											? "Loading models..."
											: isLmStudioRoleProvider && roleModels.length === 0
												? "No loaded LM Studio models"
												: "Default"}
									</option>
									{hasSelectedRoleModel ? (
										<option value={selectedRoleModelId}>{selectedRoleModelId}</option>
									) : null}
									{roleModels.map((model) => (
										<option key={model.id} value={model.id}>
											{formatModelOptionLabel(model)}
										</option>
									))}
								</NativeSelect>
							</label>
							<div className="min-w-0">
								<label className="mb-1 block text-[12px] text-text-secondary" htmlFor={assignmentSelectId}>
									Assignment
								</label>
								<NativeSelect
									id={assignmentSelectId}
									fill
									value={roleSettings.modelSelectionMode ?? "auto"}
									onChange={(event) =>
										handleModelSelectionModeChange(roleId, event.target.value as RuntimeModelSelectionMode)
									}
									disabled={disabled}
								>
									{MODEL_SELECTION_MODE_OPTIONS.map((option) => (
										<option key={option} value={option}>
											{MODEL_SELECTION_MODE_LABELS[option]}
										</option>
									))}
								</NativeSelect>
							</div>
							<div className="min-w-0">
								<label className="mb-1 block text-[12px] text-text-secondary" htmlFor={reasoningSelectId}>
									Reasoning
								</label>
								<NativeSelect
									id={reasoningSelectId}
									fill
									value={roleSettings.reasoningEffort ?? "inherit"}
									onChange={(event) =>
										handleReasoningChange(
											roleId,
											event.target.value as RuntimeNKleinReasoningEffort | "inherit",
										)
									}
									disabled={disabled}
								>
									{REASONING_EFFORT_OPTIONS.map((option) => (
										<option key={option} value={option}>
											{option === "inherit" ? "Default" : option}
										</option>
									))}
								</NativeSelect>
							</div>
							<div className="min-w-0">
								<span className="mb-1 block text-[12px] text-text-secondary">Model class</span>
								<NativeSelect
									fill
									value={roleSettings.modelClassCap ?? "inherit"}
									onChange={(event) =>
										handleModelClassCapChange(roleId, event.target.value as RuntimeModelClassCap | "inherit")
									}
									disabled={disabled}
								>
									{MODEL_CLASS_CAP_OPTIONS.map((option) => (
										<option key={option} value={option}>
											{MODEL_CLASS_CAP_LABELS[option]}
										</option>
									))}
								</NativeSelect>
							</div>
							<Button
								variant="ghost"
								size="sm"
								icon={<X size={14} />}
								aria-label={`Reset ${MODEL_ROLE_LABELS[roleId]} role`}
								disabled={disabled || !hasRoleOverride}
								onClick={() => {
									handleResetRole(roleId);
								}}
							/>
						</div>
						{roleModels.length > 1 ? (
							<div className="lg:ml-[118px]">
								<span className="mb-1 block text-[11px] text-text-tertiary">
									Additional models — pool; tasks fan out across the free ones
								</span>
								<div className="flex flex-wrap gap-1">
									{roleModels
										.filter((model) => model.id !== selectedRoleModelId)
										.map((model) => {
											const inPool = (roleSettings.additionalModels ?? []).some(
												(entry) => entry.modelId === model.id,
											);
											return (
												<button
													type="button"
													key={model.id}
													disabled={disabled}
													onClick={() => handlePoolToggle(roleId, roleProviderId, model.id)}
													className={cn(
														"rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-50",
														inPool
															? "border-accent bg-accent/15 text-text-primary"
															: "border-border bg-surface-2 text-text-secondary hover:bg-surface-3",
													)}
												>
													{formatModelOptionLabel(model)}
												</button>
											);
										})}
								</div>
							</div>
						) : null}
						{roleAvailabilityWarning ? (
							<p className="m-0 text-[12px] text-status-orange lg:ml-[118px]">{roleAvailabilityWarning}</p>
						) : null}
						{!roleAvailabilityWarning && roleContextWarning ? (
							<p className="m-0 text-[12px] text-status-orange lg:ml-[118px]">{roleContextWarning}</p>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
