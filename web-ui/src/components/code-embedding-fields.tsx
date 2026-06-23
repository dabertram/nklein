import { Check, RefreshCw } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { isLocalEmbeddingEndpointUrl } from "@/runtime/code-embedding-endpoint";
import { formatModelOptionLabel } from "@/runtime/nklein-context-window-policy";
import { discoverNKleinEndpointModels } from "@/runtime/runtime-config-query";
import type {
	RuntimeCodeEmbeddingSettings,
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinProviderModel,
} from "@/runtime/types";
import { useDebouncedEffect } from "@/utils/react-use";

export const LOCAL_CODE_EMBEDDING_MODEL = "kanban-local-lexical-vector-v1";
export const CODE_EMBEDDING_PROVIDER_OPTIONS: Array<{
	value: RuntimeCodeEmbeddingSettings["provider"];
	label: string;
}> = [
	{ value: "local_lexical", label: "Local lexical fallback" },
	{ value: "openai_compatible", label: "OpenAI-compatible endpoint" },
];

export function buildCodeEmbeddingSettings(
	provider: RuntimeCodeEmbeddingSettings["provider"],
	model: string,
	baseUrl: string,
): RuntimeCodeEmbeddingSettings {
	if (provider === "local_lexical") {
		return {
			provider,
			model: LOCAL_CODE_EMBEDDING_MODEL,
			baseUrl: null,
		};
	}
	return {
		provider,
		model: model.trim() || null,
		baseUrl: baseUrl.trim() || null,
	};
}

export function areCodeEmbeddingSettingsEqual(
	left: RuntimeCodeEmbeddingSettings | null,
	right: RuntimeCodeEmbeddingSettings | null,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function formatCodeEmbeddingSettings(settings: RuntimeCodeEmbeddingSettings): string {
	if (settings.provider === "local_lexical") {
		return "Local lexical fallback";
	}
	return `${settings.model ?? "No model"} at ${settings.baseUrl ?? "no endpoint"}`;
}

export function EmbeddingEndpointFields({
	workspaceId,
	labelPrefix,
	disabled,
	provider,
	baseUrl,
	model,
	suggestedBaseUrl,
	endpointPlaceholder,
	modelPlaceholder,
	onBaseUrlChange,
	onModelChange,
	onError,
}: {
	workspaceId: string | null;
	labelPrefix: string;
	disabled: boolean;
	provider: RuntimeCodeEmbeddingSettings["provider"];
	baseUrl: string;
	model: string;
	suggestedBaseUrl?: string | null;
	endpointPlaceholder: string;
	modelPlaceholder: string;
	onBaseUrlChange: (value: string) => void;
	onModelChange: (value: string) => void;
	onError: (message: string | null) => void;
}): ReactElement {
	const [isDiscovering, setIsDiscovering] = useState(false);
	const [isTestingEndpoint, setIsTestingEndpoint] = useState(false);
	const [discoveredModels, setDiscoveredModels] = useState<RuntimeNKleinProviderModel[]>([]);
	const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);
	const baseUrlRef = useRef(baseUrl);
	const discoveryRequestIdRef = useRef(0);
	const lastDiscoveredBaseUrlRef = useRef<string | null>(null);

	useEffect(() => {
		baseUrlRef.current = baseUrl;
	}, [baseUrl]);

	useEffect(() => {
		if (disabled || provider !== "openai_compatible" || baseUrl.trim().length > 0) {
			return;
		}
		const normalizedSuggestedBaseUrl = suggestedBaseUrl?.trim() ?? "";
		if (normalizedSuggestedBaseUrl.length > 0) {
			onBaseUrlChange(normalizedSuggestedBaseUrl);
		}
	}, [baseUrl, disabled, onBaseUrlChange, provider, suggestedBaseUrl]);

	useEffect(() => {
		if (provider !== "openai_compatible") {
			setDiscoveredModels([]);
			setDiscoveryMessage(null);
			lastDiscoveredBaseUrlRef.current = null;
		}
	}, [provider]);

	const selectedDiscoveredModel = useMemo(
		() => discoveredModels.find((entry) => entry.id === model) ?? null,
		[discoveredModels, model],
	);

	const runModelDiscovery = useCallback(
		async ({ quiet }: { quiet: boolean }) => {
			const normalizedBaseUrl = baseUrlRef.current.trim();
			if (!normalizedBaseUrl) {
				if (!quiet) {
					onError(`Enter a ${labelPrefix.toLowerCase()} endpoint URL before discovering models.`);
				}
				return;
			}
			const requestId = discoveryRequestIdRef.current + 1;
			discoveryRequestIdRef.current = requestId;
			setIsDiscovering(true);
			setDiscoveryMessage(null);
			if (!quiet) {
				onError(null);
			}
			try {
				const response: RuntimeNKleinEndpointModelDiscoveryResponse = await discoverNKleinEndpointModels(
					workspaceId,
					{
						baseUrl: normalizedBaseUrl,
					},
				);
				if (discoveryRequestIdRef.current !== requestId || baseUrlRef.current.trim() !== normalizedBaseUrl) {
					return;
				}
				setDiscoveredModels(response.models);
				lastDiscoveredBaseUrlRef.current = normalizedBaseUrl;
				if (response.models.length > 0) {
					const nextModelId =
						response.models.some((entry) => entry.id === model) && model.trim().length > 0
							? model
							: (response.models[0]?.id ?? "");
					onModelChange(nextModelId);
				}
				setDiscoveryMessage(
					response.models.length > 0
						? `Loaded ${response.models.length} model${response.models.length === 1 ? "" : "s"} from ${response.modelSourceUrl}.`
						: `No models returned from ${response.modelSourceUrl}.`,
				);
			} catch (error) {
				if (discoveryRequestIdRef.current !== requestId || baseUrlRef.current.trim() !== normalizedBaseUrl) {
					return;
				}
				if (quiet) {
					setDiscoveryMessage("Could not automatically discover models from the local embedding endpoint.");
				} else {
					onError(error instanceof Error ? error.message : "Could not discover embedding models.");
				}
			} finally {
				if (discoveryRequestIdRef.current === requestId) {
					setIsDiscovering(false);
				}
			}
		},
		[labelPrefix, model, onError, onModelChange, workspaceId],
	);

	useDebouncedEffect(
		() => {
			const normalizedBaseUrl = baseUrl.trim();
			if (
				disabled ||
				provider !== "openai_compatible" ||
				!isLocalEmbeddingEndpointUrl(normalizedBaseUrl) ||
				(lastDiscoveredBaseUrlRef.current === normalizedBaseUrl && discoveredModels.length > 0)
			) {
				return;
			}
			void runModelDiscovery({ quiet: true });
		},
		500,
		[baseUrl, disabled, discoveredModels.length, provider, runModelDiscovery],
	);

	const handleDiscoverModels = useCallback(async () => {
		await runModelDiscovery({ quiet: false });
	}, [runModelDiscovery]);

	const handleTestEndpoint = useCallback(async () => {
		const normalizedBaseUrl = baseUrl.trim();
		if (!normalizedBaseUrl) {
			onError(`Enter a ${labelPrefix.toLowerCase()} endpoint URL before testing the endpoint.`);
			return;
		}
		setIsTestingEndpoint(true);
		setDiscoveryMessage(null);
		onError(null);
		try {
			const response = await discoverNKleinEndpointModels(workspaceId, {
				baseUrl: normalizedBaseUrl,
			});
			setDiscoveryMessage(
				`Endpoint reachable: ${response.models.length} model${response.models.length === 1 ? "" : "s"} at ${response.modelSourceUrl}.`,
			);
		} catch (error) {
			onError(error instanceof Error ? error.message : "Could not reach the embedding endpoint.");
		} finally {
			setIsTestingEndpoint(false);
		}
	}, [baseUrl, labelPrefix, onError, workspaceId]);

	return (
		<div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)]">
			<label className="min-w-0">
				<span className="mb-1 block text-[12px] text-text-secondary">{labelPrefix} endpoint URL</span>
				<input
					type="text"
					value={baseUrl}
					onChange={(event) => onBaseUrlChange(event.target.value)}
					disabled={disabled || provider === "local_lexical"}
					placeholder={endpointPlaceholder}
					className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-focus disabled:opacity-50"
				/>
			</label>
			<div className="flex flex-wrap items-end gap-2">
				<Button
					variant="ghost"
					size="sm"
					icon={<RefreshCw size={14} className={isDiscovering ? "animate-spin" : undefined} />}
					disabled={
						disabled ||
						provider === "local_lexical" ||
						baseUrl.trim().length === 0 ||
						isDiscovering ||
						isTestingEndpoint
					}
					onClick={() => void handleDiscoverModels()}
				>
					{isDiscovering ? "Discovering..." : "Discover models"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					icon={<Check size={14} />}
					disabled={
						disabled ||
						provider === "local_lexical" ||
						baseUrl.trim().length === 0 ||
						isDiscovering ||
						isTestingEndpoint
					}
					onClick={() => void handleTestEndpoint()}
				>
					{isTestingEndpoint ? "Testing..." : "Test endpoint"}
				</Button>
			</div>
			<div className="min-w-0">
				<span className="mb-1 block text-[12px] text-text-secondary">{labelPrefix} embedding model</span>
				{discoveredModels.length > 0 ? (
					<NativeSelect
						fill
						value={selectedDiscoveredModel?.id ?? model}
						onChange={(event) => onModelChange(event.target.value)}
						disabled={disabled || provider === "local_lexical"}
					>
						{discoveredModels.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{formatModelOptionLabel(entry)}
							</option>
						))}
					</NativeSelect>
				) : (
					<input
						type="text"
						value={model}
						onChange={(event) => onModelChange(event.target.value)}
						disabled={disabled || provider === "local_lexical"}
						placeholder={modelPlaceholder}
						className="h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-focus disabled:opacity-50"
					/>
				)}
			</div>
			<div className="lg:col-span-3">
				<p className="m-0 text-[12px] text-text-tertiary">
					LM Studio usually works with `http://127.0.0.1:1234/v1/embeddings`; Ollama usually works with
					`http://127.0.0.1:11434/v1/embeddings`.
				</p>
				{discoveryMessage ? <p className="mt-1 mb-0 text-[12px] text-text-secondary">{discoveryMessage}</p> : null}
			</div>
		</div>
	);
}
