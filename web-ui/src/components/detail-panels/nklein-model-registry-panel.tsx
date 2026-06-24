import { Activity, Gauge, RotateCcw, Save, Server, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	formatNKleinContextWindowTokens,
	isLmStudioProviderId,
	NKLEIN_MIN_CONTEXT_WINDOW_TOKENS,
} from "@/runtime/nklein-context-window-policy";
import type { RuntimeNKleinModelRegistryEntry, RuntimeNKleinProviderModel } from "@/runtime/types";

export function findNKleinModelRegistryEntry(
	entries: readonly RuntimeNKleinModelRegistryEntry[],
	providerId: string,
	modelId: string,
): RuntimeNKleinModelRegistryEntry | null {
	const normalizedProviderId = providerId.trim().toLowerCase();
	const normalizedModelId = modelId.trim();
	if (!normalizedProviderId || !normalizedModelId) {
		return null;
	}
	return (
		entries.find(
			(entry) =>
				entry.providerId.trim().toLowerCase() === normalizedProviderId &&
				entry.modelId.trim() === normalizedModelId,
		) ?? null
	);
}

export function formatNKleinModelRegistryDisplay(entry: RuntimeNKleinModelRegistryEntry | null): string | null {
	if (!entry || entry.speed.samples <= 0) {
		return null;
	}
	const parts: string[] = [];
	if (entry.contextWindow.effective) {
		parts.push(`${Math.round(entry.contextWindow.effective / 1000)}k measured window`);
	}
	if (entry.speed.prefillTokensPerSecondEwma) {
		parts.push(`${Math.round(entry.speed.prefillTokensPerSecondEwma)} tok/s in`);
	}
	if (entry.speed.decodeTokensPerSecondEwma) {
		parts.push(`${Math.round(entry.speed.decodeTokensPerSecondEwma)} tok/s out`);
	}
	if (entry.speed.wallTimeMsPer1kPromptTokensEwma) {
		parts.push(`${Math.round(entry.speed.wallTimeMsPer1kPromptTokensEwma)} ms/1k`);
	}
	parts.push(`cap ${Math.round(entry.capability.effectiveScore)}`);
	return parts.length > 0 ? `Model telemetry: ${parts.join(" · ")}` : null;
}

function normalizeOnDeviceLocalProviderId(providerId: string): "lmstudio" | "ollama" | null {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (isLmStudioProviderId(normalizedProviderId)) {
		return "lmstudio";
	}
	if (normalizedProviderId === "ollama") {
		return "ollama";
	}
	return null;
}

export function isOnDeviceLocalProviderId(providerId: string): boolean {
	return normalizeOnDeviceLocalProviderId(providerId) !== null;
}

export function filterRegistryEntriesToLoadedModels(
	entries: readonly RuntimeNKleinModelRegistryEntry[],
	selectedProviderId: string,
	loadedProviderModels: readonly RuntimeNKleinProviderModel[],
): RuntimeNKleinModelRegistryEntry[] {
	const normalizedSelectedProviderId = normalizeOnDeviceLocalProviderId(selectedProviderId);
	if (normalizedSelectedProviderId === null) {
		return [...entries];
	}
	const loadedModelIds = new Set(
		loadedProviderModels.map((model) => model.id.trim()).filter((modelId) => modelId.length > 0),
	);
	if (loadedModelIds.size === 0) {
		return [];
	}
	return entries.filter((entry) => {
		if (normalizeOnDeviceLocalProviderId(entry.providerId) !== normalizedSelectedProviderId) {
			return false;
		}
		return loadedModelIds.has(entry.modelId.trim());
	});
}

function formatTokenWindow(value: number | null): string {
	return value ? `${Math.round(value / 1000)}k` : "unknown";
}

function formatExactTokenWindow(value: number | null): string {
	return value ? formatNKleinContextWindowTokens(value) : "unknown";
}

function formatRate(value: number | null): string {
	return value ? `${Math.round(value)} tok/s` : "unknown";
}

function formatLatency(value: number | null): string {
	return value ? `${Math.round(value)} ms/1k` : "unknown";
}

function formatObservationAge(nowMs: number, observedAt: number | null): string {
	if (!observedAt) {
		return "never";
	}
	const elapsedMs = Math.max(0, nowMs - observedAt);
	const elapsedMinutes = Math.floor(elapsedMs / 60_000);
	if (elapsedMinutes < 1) {
		return "<1m ago";
	}
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes}m ago`;
	}
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 48) {
		return `${elapsedHours}h ago`;
	}
	return `${Math.floor(elapsedHours / 24)}d ago`;
}

function formatEndpoint(entry: RuntimeNKleinModelRegistryEntry): string {
	return entry.constraints.sharedEndpointId ?? entry.endpoint ?? "dedicated";
}

function hasContextWindow(entry: RuntimeNKleinModelRegistryEntry): boolean {
	return entry.contextWindow.effective !== null;
}

export function formatNKleinModelRegistryPanelSummary(entry: RuntimeNKleinModelRegistryEntry, nowMs: number): string {
	return [
		`${entry.providerId}/${entry.modelId}`,
		`endpoint ${formatEndpoint(entry)}`,
		`window ${formatTokenWindow(entry.contextWindow.effective)}`,
		`in ${formatRate(entry.speed.prefillTokensPerSecondEwma)}`,
		`out ${formatRate(entry.speed.decodeTokensPerSecondEwma)}`,
		`latency ${formatLatency(entry.speed.wallTimeMsPer1kPromptTokensEwma)}`,
		`cap ${Math.round(entry.capability.effectiveScore)}`,
		`${entry.speed.samples} samples`,
		`last ${formatObservationAge(nowMs, entry.speed.lastObservedAt ?? entry.capability.lastObservedAt)}`,
	].join(" · ");
}

interface NKleinModelRegistryPanelProps {
	entries: readonly RuntimeNKleinModelRegistryEntry[];
	selectedProviderId: string;
	selectedModelId: string;
	nowMs: number;
	isLoading?: boolean;
	onContextWindowOverrideSave?: (
		entry: RuntimeNKleinModelRegistryEntry,
		contextWindow: number | null,
	) => Promise<void> | void;
	onMaxConcurrentRequestsSave?: (
		entry: RuntimeNKleinModelRegistryEntry,
		maxConcurrentRequests: number | null,
	) => Promise<void> | void;
	onRemoveEntry?: (entry: RuntimeNKleinModelRegistryEntry) => Promise<void> | void;
	onPruneStale?: () => Promise<void> | void;
}

export function NKleinModelRegistryPanel({
	entries,
	selectedProviderId,
	selectedModelId,
	nowMs,
	isLoading = false,
	onContextWindowOverrideSave,
	onMaxConcurrentRequestsSave,
	onRemoveEntry,
	onPruneStale,
}: NKleinModelRegistryPanelProps) {
	const selectedEntry = findNKleinModelRegistryEntry(entries, selectedProviderId, selectedModelId);
	const visibleEntries = useMemo(
		() => (selectedEntry ? [selectedEntry, ...entries.filter((entry) => entry.key !== selectedEntry.key)] : entries),
		[entries, selectedEntry],
	);
	const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
	const [concurrencyInputs, setConcurrencyInputs] = useState<Record<string, string>>({});
	const [savingKey, setSavingKey] = useState<string | null>(null);
	const [savingConcurrencyKey, setSavingConcurrencyKey] = useState<string | null>(null);
	const [removingKey, setRemovingKey] = useState<string | null>(null);
	const [isPruning, setIsPruning] = useState(false);
	const [saveErrorByKey, setSaveErrorByKey] = useState<Record<string, string>>({});
	const [concurrencyErrorByKey, setConcurrencyErrorByKey] = useState<Record<string, string>>({});
	const [removeErrorByKey, setRemoveErrorByKey] = useState<Record<string, string>>({});
	const [pruneError, setPruneError] = useState("");

	const saveOverride = async (entry: RuntimeNKleinModelRegistryEntry, contextWindow: number | null) => {
		if (!onContextWindowOverrideSave) {
			return;
		}
		setSavingKey(entry.key);
		setSaveErrorByKey((currentErrors) => ({ ...currentErrors, [entry.key]: "" }));
		try {
			await onContextWindowOverrideSave(entry, contextWindow);
			setOverrideInputs((currentInputs) => {
				const nextInputs = { ...currentInputs };
				if (contextWindow === null) {
					nextInputs[entry.key] = "";
				} else {
					nextInputs[entry.key] = String(contextWindow);
				}
				return nextInputs;
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setSaveErrorByKey((currentErrors) => ({ ...currentErrors, [entry.key]: message }));
		} finally {
			setSavingKey(null);
		}
	};

	const saveConcurrency = async (entry: RuntimeNKleinModelRegistryEntry, maxConcurrentRequests: number | null) => {
		if (!onMaxConcurrentRequestsSave) {
			return;
		}
		setSavingConcurrencyKey(entry.key);
		setConcurrencyErrorByKey((currentErrors) => ({ ...currentErrors, [entry.key]: "" }));
		try {
			await onMaxConcurrentRequestsSave(entry, maxConcurrentRequests);
			setConcurrencyInputs((currentInputs) => ({
				...currentInputs,
				[entry.key]: maxConcurrentRequests === null ? "" : String(maxConcurrentRequests),
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setConcurrencyErrorByKey((currentErrors) => ({ ...currentErrors, [entry.key]: message }));
		} finally {
			setSavingConcurrencyKey(null);
		}
	};

	const removeEntry = async (entry: RuntimeNKleinModelRegistryEntry) => {
		if (!onRemoveEntry) {
			return;
		}
		setRemovingKey(entry.key);
		setRemoveErrorByKey((currentErrors) => ({ ...currentErrors, [entry.key]: "" }));
		try {
			await onRemoveEntry(entry);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setRemoveErrorByKey((currentErrors) => ({ ...currentErrors, [entry.key]: message }));
		} finally {
			setRemovingKey(null);
		}
	};

	const pruneStale = async () => {
		if (!onPruneStale) {
			return;
		}
		setIsPruning(true);
		setPruneError("");
		try {
			await onPruneStale();
		} catch (error) {
			setPruneError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsPruning(false);
		}
	};

	return (
		<section className="mt-2 rounded-lg border border-border bg-surface-1 px-3 py-2" aria-label="Model telemetry">
			<div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-primary">
				<Activity size={14} className="text-status-green" />
				<span>Past telemetry</span>
				{onPruneStale ? (
					<Button
						size="sm"
						variant="ghost"
						icon={<Trash2 size={14} />}
						disabled={isPruning || isLoading}
						onClick={() => {
							void pruneStale();
						}}
						className="ml-auto"
					>
						{isPruning ? "Clearing..." : "Clear stale models"}
					</Button>
				) : null}
				{isLoading ? (
					<span className={cn(!onPruneStale && "ml-auto", "text-[11px] font-normal text-text-tertiary")}>
						Refreshing
					</span>
				) : null}
			</div>
			{pruneError ? <div className="mb-2 text-[11px] text-status-red">{pruneError}</div> : null}
			{visibleEntries.length === 0 ? (
				<div className="text-xs text-text-secondary">No model observations recorded yet.</div>
			) : (
				<div className="grid gap-2">
					{visibleEntries.map((entry) => {
						const isSelected = entry.key === selectedEntry?.key;
						const overrideInput = overrideInputs[entry.key] ?? String(entry.contextWindow.userOverride ?? "");
						const trimmedOverrideInput = overrideInput.trim();
						const parsedOverride =
							trimmedOverrideInput.length > 0 ? Number.parseInt(trimmedOverrideInput, 10) : null;
						const hasValidOverride =
							parsedOverride !== null &&
							Number.isFinite(parsedOverride) &&
							parsedOverride >= NKLEIN_MIN_CONTEXT_WINDOW_TOKENS;
						const canSaveOverride =
							Boolean(onContextWindowOverrideSave) &&
							hasValidOverride &&
							parsedOverride !== entry.contextWindow.userOverride;
						const currentConcurrency = entry.constraints.maxConcurrentRequests ?? null;
						const concurrencyInput = concurrencyInputs[entry.key] ?? String(currentConcurrency ?? "");
						const trimmedConcurrencyInput = concurrencyInput.trim();
						const parsedConcurrency =
							trimmedConcurrencyInput.length > 0 ? Number.parseInt(trimmedConcurrencyInput, 10) : null;
						const hasValidConcurrency =
							parsedConcurrency !== null && Number.isFinite(parsedConcurrency) && parsedConcurrency >= 1;
						const canSaveConcurrency =
							Boolean(onMaxConcurrentRequestsSave) &&
							hasValidConcurrency &&
							parsedConcurrency !== currentConcurrency;
						const isSaving = savingKey === entry.key;
						const isSavingConcurrency = savingConcurrencyKey === entry.key;
						const isRemoving = removingKey === entry.key;
						const saveError = saveErrorByKey[entry.key]?.trim();
						const concurrencyError = concurrencyErrorByKey[entry.key]?.trim();
						const removeError = removeErrorByKey[entry.key]?.trim();
						return (
							<div
								key={entry.key}
								className={cn(
									"rounded-md border px-2 py-2",
									isSelected ? "border-accent/60 bg-accent/10" : "border-border bg-surface-2",
								)}
							>
								<div className="flex min-w-0 items-center gap-2">
									<Server size={14} className="shrink-0 text-text-tertiary" />
									<div className="min-w-0 truncate text-xs font-medium text-text-primary">
										{entry.providerId}/{entry.modelId}
									</div>
									{isSelected ? (
										<span className="ml-auto shrink-0 rounded-sm border border-accent/50 px-1.5 py-0.5 text-[10px] text-accent">
											Selected
										</span>
									) : null}
									{!hasContextWindow(entry) ? (
										<span className="shrink-0 rounded-sm border border-status-orange/50 px-1.5 py-0.5 text-[10px] text-status-orange">
											Set context window
										</span>
									) : null}
									{onRemoveEntry ? (
										<Button
											size="sm"
											variant="ghost"
											icon={<Trash2 size={14} />}
											disabled={isRemoving}
											onClick={() => {
												void removeEntry(entry);
											}}
										>
											{isRemoving ? "Removing..." : "Remove"}
										</Button>
									) : null}
								</div>
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
									<span>Endpoint: {formatEndpoint(entry)}</span>
									<span>Effective context: {formatExactTokenWindow(entry.contextWindow.effective)}</span>
									<span>Context override: {formatExactTokenWindow(entry.contextWindow.userOverride)}</span>
									<span>Observed: {formatExactTokenWindow(entry.contextWindow.observed)}</span>
									<span>Advertised: {formatExactTokenWindow(entry.contextWindow.advertised)}</span>
									<span>Samples: {entry.speed.samples}</span>
									<span>
										Last:{" "}
										{formatObservationAge(
											nowMs,
											entry.speed.lastObservedAt ?? entry.capability.lastObservedAt,
										)}
									</span>
								</div>
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
									<span className="inline-flex items-center gap-1">
										<Gauge size={12} />
										In {formatRate(entry.speed.prefillTokensPerSecondEwma)}
									</span>
									<span>Out {formatRate(entry.speed.decodeTokensPerSecondEwma)}</span>
									<span>Latency {formatLatency(entry.speed.wallTimeMsPer1kPromptTokensEwma)}</span>
									<span>Capability {Math.round(entry.capability.effectiveScore)}</span>
								</div>
								{onContextWindowOverrideSave ? (
									<div className="mt-2 grid gap-1">
										<div className="flex flex-wrap items-center gap-2">
											<input
												type="number"
												min={NKLEIN_MIN_CONTEXT_WINDOW_TOKENS}
												step={1024}
												value={overrideInput}
												onChange={(event) => {
													const nextValue = event.currentTarget.value;
													setOverrideInputs((currentInputs) => ({
														...currentInputs,
														[entry.key]: nextValue,
													}));
												}}
												className="h-8 w-36 rounded-md border border-border bg-surface-0 px-2 text-xs text-text-primary outline-none focus:border-border-focus"
												placeholder="Context tokens"
												aria-label={`Context window override for ${entry.providerId}/${entry.modelId}`}
											/>
											<Button
												size="sm"
												variant="default"
												icon={<Save size={14} />}
												disabled={!canSaveOverride || isSaving}
												onClick={() => {
													if (hasValidOverride && parsedOverride !== null) {
														void saveOverride(entry, parsedOverride);
													}
												}}
											>
												{isSaving ? "Saving..." : "Save"}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												icon={<RotateCcw size={14} />}
												disabled={!entry.contextWindow.userOverride || isSaving}
												onClick={() => {
													void saveOverride(entry, null);
												}}
											>
												Clear
											</Button>
											<span className="text-[11px] text-text-tertiary">
												Minimum {formatNKleinContextWindowTokens(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS)}
											</span>
										</div>
										{trimmedOverrideInput && !hasValidOverride ? (
											<div className="text-[11px] text-status-orange">
												Use at least {formatNKleinContextWindowTokens(NKLEIN_MIN_CONTEXT_WINDOW_TOKENS)}{" "}
												tokens.
											</div>
										) : null}
										{saveError ? <div className="text-[11px] text-status-red">{saveError}</div> : null}
									</div>
								) : null}
								{onMaxConcurrentRequestsSave ? (
									<div className="mt-2 grid gap-1">
										<div className="flex flex-wrap items-center gap-2">
											<input
												type="number"
												min={1}
												step={1}
												value={concurrencyInput}
												onChange={(event) => {
													const nextValue = event.currentTarget.value;
													setConcurrencyInputs((currentInputs) => ({
														...currentInputs,
														[entry.key]: nextValue,
													}));
												}}
												className="h-8 w-36 rounded-md border border-border bg-surface-0 px-2 text-xs text-text-primary outline-none focus:border-border-focus"
												placeholder="Parallel requests"
												aria-label={`Max concurrent requests for ${entry.providerId}/${entry.modelId}`}
											/>
											<Button
												size="sm"
												variant="default"
												icon={<Save size={14} />}
												disabled={!canSaveConcurrency || isSavingConcurrency}
												onClick={() => {
													if (hasValidConcurrency && parsedConcurrency !== null) {
														void saveConcurrency(entry, parsedConcurrency);
													}
												}}
											>
												{isSavingConcurrency ? "Saving..." : "Save"}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												icon={<RotateCcw size={14} />}
												disabled={currentConcurrency === null || isSavingConcurrency}
												onClick={() => {
													void saveConcurrency(entry, null);
												}}
											>
												Clear
											</Button>
											<span className="text-[11px] text-text-tertiary">
												Parallel requests this model accepts (default 1).
											</span>
										</div>
										{trimmedConcurrencyInput && !hasValidConcurrency ? (
											<div className="text-[11px] text-status-orange">Use a whole number of 1 or more.</div>
										) : null}
										{concurrencyError ? (
											<div className="text-[11px] text-status-red">{concurrencyError}</div>
										) : null}
									</div>
								) : null}
								{removeError ? <div className="mt-2 text-[11px] text-status-red">{removeError}</div> : null}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
