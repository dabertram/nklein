// NKlein-specific settings sub-panels (extracted from runtime-settings-dialog.tsx, §5.U — the dialog is the codebase's
// largest file). Three self-contained stateful child panels shown in the NKlein settings section:
//   - NKleinDogfoodSuggestion: write a self-improvement backlog suggestion via the dogfood engine.
//   - NKleinModelContextWindowSettingsPanel: inspect/refresh the model registry + observed context windows.
//   - NKleinSmokeEvalTrial: run the !Klein smoke eval and surface the evidence bundle.
import { ExternalLink, Play, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import {
	filterRegistryEntriesToLoadedModels,
	NKleinModelRegistryPanel,
} from "@/components/detail-panels/nklein-model-registry-panel";
import { KleinCorePyHealthLine } from "@/components/klein-core-py-health-line";
import { Button } from "@/components/ui/button";
import { findNKleinProviderModel, formatNKleinModelContextWindowLabel } from "@/runtime/nklein-context-window-policy";
import {
	checkLlmfitCatalogUpdate,
	fetchNKleinModelRegistry,
	openFileOnHost,
	pruneNKleinModelRegistry,
	removeNKleinModelRegistryEntry,
	runNKleinSmokeEval,
	saveNKleinModelContextWindowOverride,
	saveNKleinModelMaxConcurrentRequests,
	writeNKleinDogfoodBacklog,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeLlmfitCatalogUpdateCheckResponse,
	RuntimeModelFleetSuggestion,
	RuntimeNKleinDogfoodBacklogResponse,
	RuntimeNKleinModelRegistryEntry,
	RuntimeNKleinProviderModel,
	RuntimeNKleinSmokeEvalResponse,
} from "@/runtime/types";

export function NKleinDogfoodSuggestion({
	workspaceId,
	disabled,
	onError,
}: {
	workspaceId: string | null;
	disabled: boolean;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [suggestion, setSuggestion] = useState("");
	const [isWriting, setIsWriting] = useState(false);
	const [result, setResult] = useState<RuntimeNKleinDogfoodBacklogResponse | null>(null);

	const handleWriteBacklog = useCallback(() => {
		const trimmed = suggestion.trim();
		onError(null);
		setIsWriting(true);
		void writeNKleinDogfoodBacklog(workspaceId, trimmed ? { suggestion: trimmed } : {})
			.then((response) => {
				setResult(response);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not write self-improvement backlog: ${message}`);
			})
			.finally(() => {
				setIsWriting(false);
			});
	}, [onError, suggestion, workspaceId]);

	const handleOpenPlan = useCallback(() => {
		if (!result) {
			return;
		}
		void openFileOnHost(workspaceId, result.planPath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not open self-improvement plan: ${message}`);
		});
	}, [onError, result, workspaceId]);

	return (
		<div className="mt-4 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3 mb-2">
				<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
					Self-improvement
				</h6>
				<Button
					size="sm"
					variant="default"
					icon={<Plus size={14} />}
					disabled={disabled || isWriting}
					onClick={handleWriteBacklog}
				>
					{isWriting ? "Writing..." : "Suggest improvement"}
				</Button>
			</div>
			<textarea
				value={suggestion}
				onChange={(event) => setSuggestion(event.target.value)}
				rows={3}
				disabled={disabled || isWriting}
				placeholder="Describe a !Klein improvement to turn into guarded dogfood tasks."
				className="w-full resize-none rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
			/>
			{result ? (
				<div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="text-[13px] font-medium text-text-primary m-0">
								{result.taskCount} task{result.taskCount === 1 ? "" : "s"} drafted
							</p>
							<p className="text-[12px] text-text-secondary mt-0.5 mb-0 font-mono break-all">
								{result.taskGraphPath}
							</p>
						</div>
						<Button
							size="sm"
							variant="ghost"
							icon={<ExternalLink size={14} />}
							disabled={disabled}
							onClick={handleOpenPlan}
						>
							Open plan
						</Button>
					</div>
					<p className="text-[12px] text-text-secondary mt-3 mb-1">Next</p>
					<code className="block rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] text-text-primary break-all">
						{result.nextCommand}
					</code>
				</div>
			) : null}
		</div>
	);
}

export function NKleinModelContextWindowSettingsPanel({
	workspaceId,
	open,
	disabled,
	selectedProviderId,
	selectedModelId,
	selectedProviderModels,
	onRefreshProviderModels,
	onError,
}: {
	workspaceId: string | null;
	open: boolean;
	disabled: boolean;
	selectedProviderId: string;
	selectedModelId: string;
	selectedProviderModels: RuntimeNKleinProviderModel[];
	onRefreshProviderModels: () => Promise<void>;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [isLoading, setIsLoading] = useState(false);
	const [registryEntries, setRegistryEntries] = useState<RuntimeNKleinModelRegistryEntry[]>([]);
	const [fleetSuggestions, setFleetSuggestions] = useState<RuntimeModelFleetSuggestion[]>([]);
	const [catalogUpdateCheck, setCatalogUpdateCheck] = useState<RuntimeLlmfitCatalogUpdateCheckResponse | null>(null);
	const [nowMs, setNowMs] = useState(() => Date.now());
	const visibleRegistryEntries = useMemo(
		() => filterRegistryEntriesToLoadedModels(registryEntries, selectedProviderId, selectedProviderModels),
		[registryEntries, selectedProviderId, selectedProviderModels],
	);
	const selectedLoadedProviderModel = useMemo(
		() => findNKleinProviderModel(selectedProviderModels, selectedModelId),
		[selectedModelId, selectedProviderModels],
	);

	const refreshRegistry = useCallback(async () => {
		if (!open) {
			return;
		}
		onError(null);
		setIsLoading(true);
		try {
			await onRefreshProviderModels();
			const response = await fetchNKleinModelRegistry(workspaceId);
			setRegistryEntries(response.models);
			setFleetSuggestions(response.fleetSuggestions);
			setNowMs(Date.now());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not load model telemetry: ${message}`);
		} finally {
			setIsLoading(false);
		}
	}, [onError, onRefreshProviderModels, open, workspaceId]);

	useEffect(() => {
		void refreshRegistry();
	}, [refreshRegistry]);

	const saveOverride = useCallback(
		async (entry: RuntimeNKleinModelRegistryEntry, contextWindow: number | null) => {
			if (disabled) {
				return;
			}
			await saveNKleinModelContextWindowOverride(workspaceId, {
				providerId: entry.providerId,
				modelId: entry.modelId,
				endpoint: entry.endpoint,
				contextWindow,
			});
			await refreshRegistry();
		},
		[disabled, refreshRegistry, workspaceId],
	);

	const saveMaxConcurrentRequests = useCallback(
		async (entry: RuntimeNKleinModelRegistryEntry, maxConcurrentRequests: number | null) => {
			if (disabled) {
				return;
			}
			await saveNKleinModelMaxConcurrentRequests(workspaceId, {
				providerId: entry.providerId,
				modelId: entry.modelId,
				endpoint: entry.endpoint,
				maxConcurrentRequests,
			});
			await refreshRegistry();
		},
		[disabled, refreshRegistry, workspaceId],
	);

	const removeEntry = useCallback(
		async (entry: RuntimeNKleinModelRegistryEntry) => {
			if (disabled) {
				return;
			}
			const response = await removeNKleinModelRegistryEntry(workspaceId, { key: entry.key });
			await refreshRegistry();
			showAppToast({
				intent: response.removed ? "success" : "none",
				message: response.removed
					? `Removed model telemetry for ${entry.providerId}/${entry.modelId}.`
					: `Model telemetry for ${entry.providerId}/${entry.modelId} was already gone.`,
			});
		},
		[disabled, refreshRegistry, workspaceId],
	);

	const pruneStale = useCallback(async () => {
		if (disabled) {
			return;
		}
		const response = await pruneNKleinModelRegistry(workspaceId);
		await refreshRegistry();
		showAppToast({
			intent: "success",
			message: response.removed === 1 ? "Removed 1 stale model." : `Removed ${response.removed} stale models.`,
		});
	}, [disabled, refreshRegistry, workspaceId]);

	const checkCatalogUpdate = useCallback(async () => {
		if (disabled) {
			return;
		}
		const response = await checkLlmfitCatalogUpdate(workspaceId);
		setCatalogUpdateCheck(response);
		if (response.action === "suggest_update") {
			showAppToast({
				intent: "none",
				message: `llmfit catalog update available (${response.remoteModelCount ?? "unknown"} models).`,
			});
		}
	}, [disabled, workspaceId]);

	return (
		<div className="mt-4 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h6 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
						<SlidersHorizontal size={14} />
						Model context windows
					</h6>
					<p className="text-[12px] text-text-secondary mt-1 mb-0">
						{visibleRegistryEntries.length > 0
							? `${visibleRegistryEntries.length} local model${visibleRegistryEntries.length === 1 ? "" : "s"} tracked`
							: "No local model telemetry loaded"}
					</p>
					{selectedLoadedProviderModel ? (
						<p className="text-[12px] text-text-secondary mt-1 mb-0">
							Selected loaded model (live): {formatNKleinModelContextWindowLabel(selectedLoadedProviderModel)}
						</p>
					) : (
						<p className="text-[12px] text-text-tertiary mt-1 mb-0">
							Selected model is not currently loaded in LM Studio.
						</p>
					)}
				</div>
				<Button
					size="sm"
					variant="default"
					icon={<RefreshCw size={14} />}
					disabled={disabled || isLoading}
					onClick={() => {
						void refreshRegistry();
					}}
				>
					{isLoading ? "Refreshing..." : "Refresh"}
				</Button>
			</div>
			<NKleinModelRegistryPanel
				entries={visibleRegistryEntries}
				fleetSuggestions={fleetSuggestions}
				catalogUpdateCheck={catalogUpdateCheck}
				selectedProviderId={selectedProviderId}
				selectedModelId={selectedModelId}
				nowMs={nowMs}
				isLoading={isLoading}
				onContextWindowOverrideSave={disabled ? undefined : saveOverride}
				onMaxConcurrentRequestsSave={disabled ? undefined : saveMaxConcurrentRequests}
				onRemoveEntry={disabled ? undefined : removeEntry}
				onPruneStale={disabled ? undefined : pruneStale}
				onCheckCatalogUpdate={disabled ? undefined : checkCatalogUpdate}
			/>
			<KleinCorePyHealthLine workspaceId={workspaceId} />
		</div>
	);
}

export function NKleinSmokeEvalTrial({
	workspaceId,
	disabled,
	onError,
}: {
	workspaceId: string | null;
	disabled: boolean;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [isRunning, setIsRunning] = useState(false);
	const [result, setResult] = useState<RuntimeNKleinSmokeEvalResponse | null>(null);

	const handleRunEval = useCallback(() => {
		onError(null);
		setIsRunning(true);
		void runNKleinSmokeEval(workspaceId)
			.then((response) => {
				setResult(response);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not run !Klein smoke eval: ${message}`);
			})
			.finally(() => {
				setIsRunning(false);
			});
	}, [onError, workspaceId]);

	const handleOpenEvidence = useCallback(() => {
		if (!result) {
			return;
		}
		void openFileOnHost(workspaceId, result.evidenceBundlePath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			onError(`Could not open smoke eval evidence: ${message}`);
		});
	}, [onError, result, workspaceId]);

	return (
		<div className="mt-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
						Eval harness
					</h6>
					{result ? (
						<p className="text-[12px] text-text-secondary mt-1 mb-0">
							{result.providerId}:{result.modelId} {result.passed ? "passed" : "failed"}{" "}
							{result.acceptanceCommand}
						</p>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					{result ? (
						<Button
							size="sm"
							variant="ghost"
							icon={<ExternalLink size={14} />}
							disabled={disabled}
							onClick={handleOpenEvidence}
						>
							Evidence
						</Button>
					) : null}
					<Button
						size="sm"
						variant="default"
						icon={<Play size={14} />}
						disabled={disabled || isRunning}
						onClick={handleRunEval}
					>
						{isRunning ? "Running..." : "Run smoke eval"}
					</Button>
				</div>
			</div>
			{result ? (
				<p className="mt-2 mb-0 break-all font-mono text-[12px] text-text-secondary">{result.evidenceBundlePath}</p>
			) : null}
		</div>
	);
}
