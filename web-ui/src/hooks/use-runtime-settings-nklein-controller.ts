// Owns the NKlein-specific settings state machine inside the settings dialog.
// It loads provider data, drives model selection, saves settings, and runs
// OAuth login flows so the dialog component can stay presentation-focused.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRuntimeNKleinProviderSettings } from "@/runtime/native-agent";
import { findNKleinProviderModel, isLmStudioProviderId } from "@/runtime/nklein-context-window-policy";
import {
	addNKleinProvider,
	completeNKleinDeviceAuth,
	fetchNKleinProviderCatalog,
	fetchNKleinProviderModels,
	runNKleinProviderOauthLogin,
	saveNKleinProviderSettings,
	startNKleinDeviceAuth,
	updateNKleinProvider,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeNKleinOauthLoginResponse,
	RuntimeNKleinOauthProvider,
	RuntimeNKleinProviderCapability,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderSettings,
	RuntimeNKleinReasoningEffort,
	RuntimeTaskNKleinSettings,
} from "@/runtime/types";
import { isLocalhostAccess } from "@/utils/localhost-detection";

interface UseRuntimeSettingsNKleinControllerOptions {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeAgentId;
	config: RuntimeConfigResponse | null;
	taskNKleinSettings?: RuntimeTaskNKleinSettings;
}

interface SaveResult {
	ok: boolean;
	message?: string;
}

interface SaveProviderSettingsOverrides {
	providerId?: string;
	modelId?: string | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	region?: string | null;
	aws?: {
		accessKey?: string | null;
		secretKey?: string | null;
		sessionToken?: string | null;
		region?: string | null;
		profile?: string | null;
		authentication?: "iam" | "api-key" | "profile" | null;
		endpoint?: string | null;
	};
	gcp?: {
		projectId?: string | null;
		region?: string | null;
	};
}

export interface AddNKleinProviderInput {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string | null;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: RuntimeNKleinProviderCapability[];
}

export interface UpdateNKleinProviderInput {
	providerId: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string | null;
	headers?: Record<string, string> | null;
	timeoutMs?: number | null;
	models?: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: RuntimeNKleinProviderCapability[];
}

export interface UseRuntimeSettingsNKleinControllerResult {
	currentProviderSettings: RuntimeNKleinProviderSettings;
	providerId: string;
	setProviderId: Dispatch<SetStateAction<string>>;
	modelId: string;
	setModelId: Dispatch<SetStateAction<string>>;
	apiKey: string;
	setApiKey: Dispatch<SetStateAction<string>>;
	baseUrl: string;
	setBaseUrl: Dispatch<SetStateAction<string>>;
	region: string;
	setRegion: Dispatch<SetStateAction<string>>;
	reasoningEffort: RuntimeNKleinReasoningEffort | "";
	setReasoningEffort: Dispatch<SetStateAction<RuntimeNKleinReasoningEffort | "">>;
	awsAccessKey: string;
	setAwsAccessKey: Dispatch<SetStateAction<string>>;
	awsSecretKey: string;
	setAwsSecretKey: Dispatch<SetStateAction<string>>;
	awsSessionToken: string;
	setAwsSessionToken: Dispatch<SetStateAction<string>>;
	awsRegion: string;
	setAwsRegion: Dispatch<SetStateAction<string>>;
	awsProfile: string;
	setAwsProfile: Dispatch<SetStateAction<string>>;
	awsAuthentication: "" | "iam" | "api-key" | "profile";
	setAwsAuthentication: Dispatch<SetStateAction<"" | "iam" | "api-key" | "profile">>;
	awsEndpoint: string;
	setAwsEndpoint: Dispatch<SetStateAction<string>>;
	gcpProjectId: string;
	setGcpProjectId: Dispatch<SetStateAction<string>>;
	gcpRegion: string;
	setGcpRegion: Dispatch<SetStateAction<string>>;
	providerCatalog: RuntimeNKleinProviderCatalogItem[];
	providerModels: RuntimeNKleinProviderModel[];
	isLoadingProviderCatalog: boolean;
	isLoadingProviderModels: boolean;
	isRunningOauthLogin: boolean;
	deviceAuthInfo: { userCode: string; verificationUrl: string } | null;
	normalizedProviderId: string;
	managedOauthProvider: RuntimeNKleinOauthProvider | null;
	isOauthProviderSelected: boolean;
	apiKeyConfigured: boolean;
	oauthConfigured: boolean;
	oauthAccountId: string;
	oauthExpiresAt: string;
	selectedModelSupportsReasoningEffort: boolean;
	hasUnsavedChanges: boolean;
	saveProviderSettings: (overrides?: SaveProviderSettingsOverrides) => Promise<SaveResult>;
	refreshProviderModels: () => Promise<SaveResult>;
	addCustomProvider: (input: AddNKleinProviderInput) => Promise<SaveResult>;
	updateCustomProvider: (input: UpdateNKleinProviderInput) => Promise<SaveResult>;
	runOauthLogin: () => Promise<SaveResult>;
}

function toManagedNKleinOauthProvider(value: string): RuntimeNKleinOauthProvider | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "nklein" || normalized === "oca" || normalized === "openai-codex") {
		return normalized;
	}
	return null;
}

function normalizeBaseUrlForProvider(providerId: string, baseUrl: string | null | undefined): string {
	if (toManagedNKleinOauthProvider(providerId)) {
		return "";
	}
	return baseUrl ?? "";
}

function getDefaultBaseUrlForProvider(providers: RuntimeNKleinProviderCatalogItem[], providerId: string): string {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return "";
	}
	return (
		providers.find((provider) => provider.id.trim().toLowerCase() === normalizedProviderId)?.baseUrl?.trim() ?? ""
	);
}

function resolveBaseUrlForProvider(
	providers: RuntimeNKleinProviderCatalogItem[],
	providerId: string,
	baseUrl: string | null | undefined,
): string {
	const normalizedBaseUrl = normalizeBaseUrlForProvider(providerId, baseUrl).trim();
	if (normalizedBaseUrl.length > 0) {
		return normalizedBaseUrl;
	}
	return normalizeBaseUrlForProvider(providerId, getDefaultBaseUrlForProvider(providers, providerId));
}

function getEffectiveProviderSettings(
	config: RuntimeConfigResponse | null,
	override: RuntimeNKleinProviderSettings | null,
): RuntimeNKleinProviderSettings | null {
	return override ?? getRuntimeNKleinProviderSettings(config);
}

function getDefaultModelIdForProvider(providers: RuntimeNKleinProviderCatalogItem[], providerId: string): string {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return "";
	}

	return (
		providers.find((provider) => provider.id.trim().toLowerCase() === normalizedProviderId)?.defaultModelId?.trim() ??
		""
	);
}

export function useRuntimeSettingsNKleinController(
	options: UseRuntimeSettingsNKleinControllerOptions,
): UseRuntimeSettingsNKleinControllerResult {
	const { open, workspaceId, selectedAgentId, config, taskNKleinSettings } = options;
	const [providerId, setProviderId] = useState("");
	const [modelId, setModelId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [region, setRegion] = useState("");
	const [reasoningEffort, setReasoningEffort] = useState<RuntimeNKleinReasoningEffort | "">("");
	const [awsAccessKey, setAwsAccessKey] = useState("");
	const [awsSecretKey, setAwsSecretKey] = useState("");
	const [awsSessionToken, setAwsSessionToken] = useState("");
	const [awsRegion, setAwsRegion] = useState("");
	const [awsProfile, setAwsProfile] = useState("");
	const [awsAuthentication, setAwsAuthentication] = useState<"" | "iam" | "api-key" | "profile">("");
	const [awsEndpoint, setAwsEndpoint] = useState("");
	const [gcpProjectId, setGcpProjectId] = useState("");
	const [gcpRegion, setGcpRegion] = useState("");
	const [providerSettingsOverride, setProviderSettingsOverride] = useState<RuntimeNKleinProviderSettings | null>(null);
	const [providerCatalog, setProviderCatalog] = useState<RuntimeNKleinProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeNKleinProviderModel[]>([]);
	const [isLoadingProviderCatalog, setIsLoadingProviderCatalog] = useState(false);
	const [isLoadingProviderModels, setIsLoadingProviderModels] = useState(false);
	const providerModelsRequestIdRef = useRef(0);
	const [isRunningOauthLogin, setIsRunningOauthLogin] = useState(false);
	const [deviceAuthInfo, setDeviceAuthInfo] = useState<{
		userCode: string;
		verificationUrl: string;
	} | null>(null);

	const effectiveProviderSettings = getEffectiveProviderSettings(config, providerSettingsOverride);
	const configProviderSettings = getRuntimeNKleinProviderSettings(config);
	const hasTaskNKleinSettingsOverride = taskNKleinSettings !== undefined;
	const initialProviderId =
		taskNKleinSettings?.providerId ||
		effectiveProviderSettings?.providerId ||
		effectiveProviderSettings?.oauthProvider ||
		"";
	const initialModelId = taskNKleinSettings?.modelId || effectiveProviderSettings?.modelId || "";
	const initialBaseUrl = resolveBaseUrlForProvider(
		providerCatalog,
		initialProviderId,
		effectiveProviderSettings?.baseUrl,
	);
	const initialReasoningEffort = hasTaskNKleinSettingsOverride
		? (taskNKleinSettings?.reasoningEffort ?? "")
		: (effectiveProviderSettings?.reasoningEffort ?? "");
	const normalizedProviderId = providerId.trim().toLowerCase();
	const managedOauthProvider = toManagedNKleinOauthProvider(normalizedProviderId);
	const isOauthProviderSelected = managedOauthProvider !== null;
	const apiKeyConfigured = effectiveProviderSettings?.apiKeyConfigured ?? false;
	const oauthConfigured = effectiveProviderSettings?.oauthAccessTokenConfigured ?? false;
	const oauthAccountId = effectiveProviderSettings?.oauthAccountId ?? "";
	const oauthExpiresAt = effectiveProviderSettings?.oauthExpiresAt?.toString() ?? "";
	const currentProviderSettings = useMemo<RuntimeNKleinProviderSettings>(() => {
		const baseSettings = effectiveProviderSettings ?? getRuntimeNKleinProviderSettings(null);
		const isSelectedManagedOauthProvider =
			managedOauthProvider !== null && managedOauthProvider === baseSettings.oauthProvider;
		return {
			...baseSettings,
			providerId: managedOauthProvider === null ? providerId.trim() || null : null,
			modelId: modelId.trim() || null,
			baseUrl: managedOauthProvider === null ? baseUrl.trim() || null : null,
			reasoningEffort: reasoningEffort || null,
			apiKeyConfigured: managedOauthProvider === null ? baseSettings.apiKeyConfigured : false,
			oauthProvider: managedOauthProvider,
			oauthAccessTokenConfigured: isSelectedManagedOauthProvider ? baseSettings.oauthAccessTokenConfigured : false,
			oauthRefreshTokenConfigured: isSelectedManagedOauthProvider ? baseSettings.oauthRefreshTokenConfigured : false,
			oauthAccountId: isSelectedManagedOauthProvider ? baseSettings.oauthAccountId : null,
			oauthExpiresAt: isSelectedManagedOauthProvider ? baseSettings.oauthExpiresAt : null,
		};
	}, [baseUrl, effectiveProviderSettings, managedOauthProvider, modelId, providerId, reasoningEffort]);
	const selectedModelSupportsReasoningEffort = useMemo(() => {
		return providerModels.find((model) => model.id === modelId)?.supportsReasoningEffort ?? false;
	}, [modelId, providerModels]);

	const hasUnsavedChanges = useMemo(() => {
		if (!config) {
			return false;
		}
		if (providerId.trim() !== initialProviderId.trim()) {
			return true;
		}
		if (modelId.trim() !== initialModelId.trim()) {
			return true;
		}
		if (baseUrl.trim() !== initialBaseUrl.trim()) {
			return true;
		}
		if (reasoningEffort !== initialReasoningEffort) {
			return true;
		}
		if (region.trim().length > 0) {
			return true;
		}
		if (awsAccessKey.trim().length > 0 || awsSecretKey.trim().length > 0 || awsSessionToken.trim().length > 0) {
			return true;
		}
		if (awsRegion.trim().length > 0 || awsProfile.trim().length > 0 || awsAuthentication.trim().length > 0) {
			return true;
		}
		if (awsEndpoint.trim().length > 0 || gcpProjectId.trim().length > 0 || gcpRegion.trim().length > 0) {
			return true;
		}
		return apiKey.trim().length > 0;
	}, [
		apiKey,
		awsAccessKey,
		awsAuthentication,
		awsEndpoint,
		awsProfile,
		awsRegion,
		awsSecretKey,
		awsSessionToken,
		baseUrl,
		config,
		gcpProjectId,
		gcpRegion,
		initialBaseUrl,
		initialModelId,
		initialProviderId,
		initialReasoningEffort,
		modelId,
		providerId,
		region,
		reasoningEffort,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const nextProviderId =
			taskNKleinSettings?.providerId ||
			(configProviderSettings.providerId ?? configProviderSettings.oauthProvider ?? "");
		setProviderId(nextProviderId);
		setModelId(taskNKleinSettings?.modelId || (configProviderSettings.modelId ?? ""));
		setApiKey("");
		setBaseUrl(resolveBaseUrlForProvider(providerCatalog, nextProviderId, configProviderSettings.baseUrl));
		setRegion("");
		setReasoningEffort(
			hasTaskNKleinSettingsOverride
				? (taskNKleinSettings?.reasoningEffort ?? "")
				: (configProviderSettings.reasoningEffort ?? ""),
		);
		setAwsAccessKey("");
		setAwsSecretKey("");
		setAwsSessionToken("");
		setAwsRegion("");
		setAwsProfile("");
		setAwsAuthentication("");
		setAwsEndpoint("");
		setGcpProjectId("");
		setGcpRegion("");
		setProviderSettingsOverride(null);
	}, [
		configProviderSettings.baseUrl,
		configProviderSettings.modelId,
		configProviderSettings.oauthProvider,
		configProviderSettings.providerId,
		configProviderSettings.reasoningEffort,
		hasTaskNKleinSettingsOverride,
		open,
		taskNKleinSettings,
	]);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein") {
			setProviderCatalog([]);
			setIsLoadingProviderCatalog(false);
			return;
		}
		let cancelled = false;
		setIsLoadingProviderCatalog(true);
		void fetchNKleinProviderCatalog(workspaceId)
			.then((nextCatalog) => {
				if (cancelled) {
					return;
				}
				setProviderCatalog(nextCatalog);
			})
			.catch(() => {
				if (!cancelled) {
					setProviderCatalog([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingProviderCatalog(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, selectedAgentId, workspaceId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein") {
			return;
		}
		const normalizedProviderId = providerId.trim().toLowerCase();
		const providerIsInCatalog =
			normalizedProviderId.length > 0 &&
			providerCatalog.some((provider) => provider.id.trim().toLowerCase() === normalizedProviderId);
		if (providerIsInCatalog) {
			return;
		}
		if (normalizedProviderId.length > 0 && providerCatalog.length === 0) {
			return;
		}
		const defaultProvider =
			providerCatalog.find((provider) => provider.id.trim().toLowerCase() === "lmstudio") ??
			providerCatalog.find((provider) => provider.id.trim().toLowerCase() === "ollama") ??
			providerCatalog[0] ??
			null;
		if (!defaultProvider) {
			return;
		}
		const nextProviderId = defaultProvider.id.trim();
		if (!nextProviderId) {
			return;
		}
		setProviderId(nextProviderId);
		setModelId(defaultProvider.defaultModelId?.trim() ?? "");
		setBaseUrl(resolveBaseUrlForProvider(providerCatalog, nextProviderId, null));
	}, [open, providerCatalog, providerId, selectedAgentId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein") {
			return;
		}
		if (providerId.trim().length === 0 || modelId.trim().length > 0) {
			return;
		}
		const defaultModelId = getDefaultModelIdForProvider(providerCatalog, providerId);
		if (!defaultModelId) {
			return;
		}
		setModelId(defaultModelId);
	}, [modelId, open, providerCatalog, providerId, selectedAgentId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein") {
			return;
		}
		if (providerId.trim().length === 0 || baseUrl.trim().length > 0) {
			return;
		}
		const defaultBaseUrl = getDefaultBaseUrlForProvider(providerCatalog, providerId);
		if (!defaultBaseUrl) {
			return;
		}
		setBaseUrl(normalizeBaseUrlForProvider(providerId, defaultBaseUrl));
	}, [baseUrl, open, providerCatalog, providerId, selectedAgentId]);

	const nextProviderModelsRequestId = useCallback((): number => {
		providerModelsRequestIdRef.current += 1;
		return providerModelsRequestIdRef.current;
	}, []);

	const loadProviderModelsForProvider = useCallback(
		async (nextProviderId: string, requestId = nextProviderModelsRequestId()): Promise<void> => {
			setIsLoadingProviderModels(true);
			try {
				const nextModels = await fetchNKleinProviderModels(workspaceId, nextProviderId);
				if (providerModelsRequestIdRef.current === requestId) {
					setProviderModels(nextModels);
				}
			} catch (error) {
				if (providerModelsRequestIdRef.current === requestId) {
					setProviderModels([]);
				}
				throw error;
			} finally {
				if (providerModelsRequestIdRef.current === requestId) {
					setIsLoadingProviderModels(false);
				}
			}
		},
		[nextProviderModelsRequestId, workspaceId],
	);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein") {
			nextProviderModelsRequestId();
			setProviderModels([]);
			setIsLoadingProviderModels(false);
			return;
		}
		const trimmedProviderId = providerId.trim();
		if (trimmedProviderId.length === 0) {
			nextProviderModelsRequestId();
			setProviderModels([]);
			setIsLoadingProviderModels(false);
			return;
		}
		void loadProviderModelsForProvider(trimmedProviderId).catch(() => {});
		return () => {
			nextProviderModelsRequestId();
		};
	}, [loadProviderModelsForProvider, nextProviderModelsRequestId, open, providerId, selectedAgentId]);

	useEffect(() => {
		if (!open || selectedAgentId !== "nklein" || !isLmStudioProviderId(providerId)) {
			return;
		}
		if (isLoadingProviderModels || providerModels.length === 0) {
			return;
		}
		const trimmedModelId = modelId.trim();
		if (trimmedModelId && findNKleinProviderModel(providerModels, trimmedModelId)) {
			return;
		}
		setModelId(providerModels[0]?.id ?? "");
	}, [isLoadingProviderModels, modelId, open, providerId, providerModels, selectedAgentId]);

	const saveProviderSettingsDraft = useCallback(
		async (overrides?: SaveProviderSettingsOverrides): Promise<SaveResult> => {
			if (!overrides && !hasUnsavedChanges) {
				return { ok: true };
			}
			const trimmedProviderId = (overrides?.providerId ?? providerId).trim();
			if (trimmedProviderId.length === 0) {
				return {
					ok: false,
					message: "Choose a !Klein provider before saving.",
				};
			}
			const trimmedBaseUrl = toManagedNKleinOauthProvider(trimmedProviderId)
				? null
				: overrides && "baseUrl" in overrides
					? overrides.baseUrl?.trim() || null
					: baseUrl.trim() || null;
			const trimmedModelId =
				overrides && "modelId" in overrides ? overrides.modelId?.trim() || null : modelId.trim() || null;
			const trimmedApiKey =
				overrides && "apiKey" in overrides
					? overrides.apiKey?.trim() || null
					: managedOauthProvider
						? null
						: apiKey.trim() || undefined;
			const nextReasoningEffort =
				overrides && "reasoningEffort" in overrides ? (overrides.reasoningEffort ?? null) : reasoningEffort || null;
			const nextRegion =
				overrides && "region" in overrides ? overrides.region?.trim() || null : region.trim() || null;
			const normalizedProviderId = trimmedProviderId.toLowerCase();
			const isBedrockProvider = normalizedProviderId === "bedrock";
			const isVertexProvider = normalizedProviderId === "vertex";
			const nextAws =
				overrides && "aws" in overrides
					? overrides.aws
					: isBedrockProvider
						? {
								accessKey: awsAccessKey.trim() || null,
								secretKey: awsSecretKey.trim() || null,
								sessionToken: awsSessionToken.trim() || null,
								region: awsRegion.trim() || null,
								profile: awsProfile.trim() || null,
								authentication: awsAuthentication || null,
								endpoint: awsEndpoint.trim() || null,
							}
						: undefined;
			const nextGcp =
				overrides && "gcp" in overrides
					? overrides.gcp
					: isVertexProvider
						? {
								projectId: gcpProjectId.trim() || null,
								region: gcpRegion.trim() || null,
							}
						: undefined;
			const payloadRegion = isVertexProvider ? nextRegion : null;
			try {
				const savedSettings = await saveNKleinProviderSettings(workspaceId, {
					providerId: trimmedProviderId,
					modelId: trimmedModelId,
					baseUrl: trimmedBaseUrl,
					reasoningEffort: nextReasoningEffort,
					...(trimmedApiKey !== undefined ? { apiKey: trimmedApiKey } : {}),
					...(isVertexProvider ? { region: payloadRegion } : {}),
					...(nextAws !== undefined ? { aws: nextAws } : {}),
					...(nextGcp !== undefined ? { gcp: nextGcp } : {}),
				});
				setProviderId(savedSettings.providerId ?? savedSettings.oauthProvider ?? trimmedProviderId);
				setModelId(savedSettings.modelId ?? "");
				setApiKey("");
				setBaseUrl(savedSettings.baseUrl ?? "");
				setReasoningEffort(savedSettings.reasoningEffort ?? "");
				setProviderSettingsOverride(savedSettings);
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[
			apiKey,
			awsAccessKey,
			awsAuthentication,
			awsEndpoint,
			awsProfile,
			awsRegion,
			awsSecretKey,
			awsSessionToken,
			baseUrl,
			gcpProjectId,
			gcpRegion,
			hasUnsavedChanges,
			managedOauthProvider,
			modelId,
			providerId,
			region,
			reasoningEffort,
			workspaceId,
		],
	);

	const refreshProviderModels = useCallback(async (): Promise<SaveResult> => {
		const trimmedProviderId = providerId.trim();
		if (trimmedProviderId.length === 0) {
			return {
				ok: false,
				message: "Choose a !Klein provider before refreshing models.",
			};
		}

		setIsLoadingProviderModels(true);
		const requestId = nextProviderModelsRequestId();
		try {
			const saveResult = await saveProviderSettingsDraft({
				providerId: trimmedProviderId,
				modelId: modelId.trim() || null,
				baseUrl: baseUrl.trim() || null,
			});
			if (!saveResult.ok) {
				return saveResult;
			}

			await loadProviderModelsForProvider(trimmedProviderId, requestId);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			};
		} finally {
			if (providerModelsRequestIdRef.current === requestId) {
				setIsLoadingProviderModels(false);
			}
		}
	}, [
		baseUrl,
		loadProviderModelsForProvider,
		modelId,
		nextProviderModelsRequestId,
		providerId,
		saveProviderSettingsDraft,
	]);

	const addCustomProvider = useCallback(
		async (input: AddNKleinProviderInput): Promise<SaveResult> => {
			try {
				const savedSettings = await addNKleinProvider(workspaceId, input);
				const nextProviderId = savedSettings.providerId ?? input.providerId.trim().toLowerCase();
				setProviderId(nextProviderId);
				setModelId(savedSettings.modelId ?? input.defaultModelId?.trim() ?? input.models[0] ?? "");
				setApiKey("");
				setBaseUrl(savedSettings.baseUrl ?? input.baseUrl);
				setReasoningEffort(savedSettings.reasoningEffort ?? "");
				setProviderSettingsOverride(savedSettings);

				setIsLoadingProviderCatalog(true);
				try {
					setProviderCatalog(await fetchNKleinProviderCatalog(workspaceId));
				} finally {
					setIsLoadingProviderCatalog(false);
				}

				await loadProviderModelsForProvider(nextProviderId);

				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[loadProviderModelsForProvider, workspaceId],
	);

	const runOauthLogin = useCallback(async (): Promise<SaveResult> => {
		if (!managedOauthProvider) {
			return { ok: false, message: "Choose an OAuth provider from the Provider field first." };
		}
		setIsRunningOauthLogin(true);
		setDeviceAuthInfo(null);
		try {
			let response: RuntimeNKleinOauthLoginResponse;
			// Local users (accessing via localhost) get the smoother browser OAuth
			// flow. Remote/headless users fall back to the device-code flow since
			// the server may not be able to open the user's browser.
			const useDeviceAuth = managedOauthProvider === "nklein" && !isLocalhostAccess();
			if (useDeviceAuth) {
				// Two-phase device auth for remote/headless environments
				const startResult = await startNKleinDeviceAuth(workspaceId);
				setDeviceAuthInfo({
					userCode: startResult.userCode,
					verificationUrl: startResult.verificationUrl,
				});
				response = await completeNKleinDeviceAuth(workspaceId, {
					deviceCode: startResult.deviceCode,
					expiresInSeconds: startResult.expiresInSeconds,
					pollIntervalSeconds: startResult.pollIntervalSeconds,
				});
			} else {
				// Browser OAuth flow for local sessions and non-nklein providers
				response = await runNKleinProviderOauthLogin(workspaceId, {
					provider: managedOauthProvider,
				});
			}
			setDeviceAuthInfo(null);
			if (!response.ok) {
				return { ok: false, message: response.error ?? "OAuth login failed." };
			}
			const nextSettings = response.settings ?? null;
			if (nextSettings) {
				const nextProviderId = nextSettings.providerId ?? nextSettings.oauthProvider ?? providerId.trim();
				setProviderId(nextProviderId);
				setModelId(nextSettings.modelId ?? getDefaultModelIdForProvider(providerCatalog, nextProviderId));
				setApiKey("");
				setBaseUrl(nextSettings.baseUrl ?? "");
				setReasoningEffort(nextSettings.reasoningEffort ?? "");
			}
			setProviderSettingsOverride(nextSettings);
			return { ok: true };
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		} finally {
			setIsRunningOauthLogin(false);
			setDeviceAuthInfo(null);
		}
	}, [managedOauthProvider, providerCatalog, providerId, workspaceId]);

	const updateCustomProvider = useCallback(
		async (input: UpdateNKleinProviderInput): Promise<SaveResult> => {
			try {
				const savedSettings = await updateNKleinProvider(workspaceId, input);
				const nextProviderId = savedSettings.providerId ?? input.providerId.trim().toLowerCase();
				setProviderId(nextProviderId);
				setModelId(savedSettings.modelId ?? input.defaultModelId?.trim() ?? modelId);
				setApiKey("");
				setBaseUrl(savedSettings.baseUrl ?? input.baseUrl ?? baseUrl);
				setReasoningEffort(savedSettings.reasoningEffort ?? "");
				setProviderSettingsOverride(savedSettings);

				setIsLoadingProviderCatalog(true);
				try {
					setProviderCatalog(await fetchNKleinProviderCatalog(workspaceId));
				} finally {
					setIsLoadingProviderCatalog(false);
				}

				await loadProviderModelsForProvider(nextProviderId);

				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[baseUrl, loadProviderModelsForProvider, modelId, workspaceId],
	);

	return {
		currentProviderSettings,
		providerId,
		setProviderId,
		modelId,
		setModelId,
		apiKey,
		setApiKey,
		baseUrl,
		setBaseUrl,
		region,
		setRegion,
		reasoningEffort,
		setReasoningEffort,
		awsAccessKey,
		setAwsAccessKey,
		awsSecretKey,
		setAwsSecretKey,
		awsSessionToken,
		setAwsSessionToken,
		awsRegion,
		setAwsRegion,
		awsProfile,
		setAwsProfile,
		awsAuthentication,
		setAwsAuthentication,
		awsEndpoint,
		setAwsEndpoint,
		gcpProjectId,
		setGcpProjectId,
		gcpRegion,
		setGcpRegion,
		providerCatalog,
		providerModels,
		isLoadingProviderCatalog,
		isLoadingProviderModels,
		isRunningOauthLogin,
		deviceAuthInfo,
		normalizedProviderId,
		managedOauthProvider,
		isOauthProviderSelected,
		apiKeyConfigured,
		oauthConfigured,
		oauthAccountId,
		oauthExpiresAt,
		selectedModelSupportsReasoningEffort,
		hasUnsavedChanges,
		saveProviderSettings: saveProviderSettingsDraft,
		refreshProviderModels,
		addCustomProvider,
		updateCustomProvider,
		runOauthLogin,
	};
}
