import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderSettings,
	RuntimeStateStreamTaskChatMessage,
	RuntimeTaskChatMessage,
} from "@/runtime/types";

export function isNativeNKleinAgentSelected(agentId: RuntimeAgentId | null | undefined): boolean {
	return agentId === "nklein";
}

// Secondary UI screen only; the backend policy in src/nklein-agent/nklein-local-only-policy.ts is authoritative.
const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio", "lm-studio"]);
const KNOWN_CLOUD_PROVIDER_IDS = new Set([
	"anthropic",
	"bedrock",
	"deepseek",
	"fireworks",
	"gemini",
	"groq",
	"mistral",
	"nklein",
	"oca",
	"openai",
	"openai-codex",
	"openai-native",
	"openrouter",
	"together",
	"vertex",
	"xai",
]);

export function isCloudProviderSupportEnabled(
	config: Pick<RuntimeConfigResponse, "cloudProviderSupportEnabled"> | null | undefined,
): boolean {
	void config;
	return false;
}

export function isKnownCloudProviderId(providerId: string | null | undefined): boolean {
	const normalized = providerId?.trim().toLowerCase();
	return normalized ? KNOWN_CLOUD_PROVIDER_IDS.has(normalized) : false;
}

function normalizeHost(baseUrl: string | null | undefined): string | null {
	const value = baseUrl?.trim();
	if (!value) {
		return null;
	}
	try {
		const url = new URL(value.includes("://") ? value : `http://${value}`);
		return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	} catch {
		return null;
	}
}

function isLocalBaseUrl(baseUrl: string | null | undefined): boolean {
	const host = normalizeHost(baseUrl);
	if (!host) {
		return false;
	}
	if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
		return true;
	}
	if (host.endsWith(".local") || host.endsWith(".localhost")) {
		return true;
	}
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!ipv4) {
		return false;
	}
	const first = Number(ipv4[1]);
	const second = Number(ipv4[2]);
	if (first === 10 || first === 127) {
		return true;
	}
	if (first === 192 && second === 168) {
		return true;
	}
	if (first === 172 && second >= 16 && second <= 31) {
		return true;
	}
	if (first === 169 && second === 254) {
		return true;
	}
	return first === 100 && second >= 64 && second <= 127;
}

export function isVisibleLocalNKleinProvider(provider: RuntimeNKleinProviderCatalogItem): boolean {
	const normalizedProviderId = provider.id.trim().toLowerCase();
	if (!normalizedProviderId || isKnownCloudProviderId(normalizedProviderId)) {
		return false;
	}
	if (LOCAL_PROVIDER_IDS.has(normalizedProviderId)) {
		return true;
	}
	return isLocalBaseUrl(provider.baseUrl);
}

export function filterVisibleNKleinProviderCatalog(
	providers: RuntimeNKleinProviderCatalogItem[],
	cloudProviderSupportEnabled: boolean,
): RuntimeNKleinProviderCatalogItem[] {
	void cloudProviderSupportEnabled;
	return providers.filter(isVisibleLocalNKleinProvider);
}

export function getRuntimeNKleinProviderSettings(
	config: Pick<RuntimeConfigResponse, "nkleinProviderSettings"> | null | undefined,
): RuntimeNKleinProviderSettings {
	return (
		config?.nkleinProviderSettings ?? {
			providerId: null,
			modelId: null,
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		}
	);
}

export function isNKleinProviderAuthenticated(settings: RuntimeNKleinProviderSettings | null | undefined): boolean {
	if (!settings) {
		return false;
	}
	const hasProviderSelection =
		(settings.providerId?.trim().length ?? 0) > 0 || (settings.oauthProvider?.trim().length ?? 0) > 0;
	if (!hasProviderSelection) {
		return false;
	}
	return settings.apiKeyConfigured || settings.oauthAccessTokenConfigured;
}

/**
 * Local-only readiness: the native NKlein agent is "configured" when a LOCAL model provider is selected, even
 * before a specific model/endpoint is persisted — the runtime auto-discovers a loaded model and falls back to
 * the catalog base URL at launch (§6.10). This is the local counterpart to {@link isNKleinProviderAuthenticated}
 * (which is cloud-oriented: it requires an API key / OAuth token that a local provider never has), so a pure
 * local-only setup (e.g. LM Studio) is no longer wrongly flagged as "No agent configured".
 */
export function isNKleinLocalModelConfigured(settings: RuntimeNKleinProviderSettings | null | undefined): boolean {
	if (!settings) {
		return false;
	}
	const providerId = settings.providerId?.trim().toLowerCase() ?? "";
	if (!providerId) {
		return false;
	}
	if (LOCAL_PROVIDER_IDS.has(providerId)) {
		return true;
	}
	if (isKnownCloudProviderId(providerId)) {
		return false;
	}
	// Custom / unknown provider: treat as a configured local model when it carries a model id or points at a
	// local endpoint.
	return (settings.modelId?.trim().length ?? 0) > 0 || isLocalBaseUrl(settings.baseUrl);
}

/**
 * Returns true only when the selected provider is the NKlein managed OAuth
 * provider **and** an access token is configured.  This is stricter than
 * {@link isNKleinProviderAuthenticated} which accepts any configured provider
 * (Claude API key, Codex, etc.).
 *
 * Use this for features that require a NKlein-issued token (e.g. Featurebase
 * JWT authentication).
 */
export function isNKleinOauthAuthenticated(settings: RuntimeNKleinProviderSettings | null | undefined): boolean {
	if (!settings) {
		return false;
	}
	return (
		settings.oauthProvider === "nklein" &&
		settings.oauthAccessTokenConfigured === true &&
		settings.oauthRefreshTokenConfigured === true
	);
}

export function isTaskAgentSetupSatisfied(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents" | "nkleinProviderSettings"> | null | undefined,
): boolean | null {
	if (!config) {
		return null;
	}
	if (isNativeNKleinAgentSelected(config.selectedAgentId)) {
		// Local-only: ready when a local model provider is configured; the cloud auth path stays valid too.
		const settings = getRuntimeNKleinProviderSettings(config);
		return isNKleinProviderAuthenticated(settings) || isNKleinLocalModelConfigured(settings);
	}
	return config.agents.some((agent) => isRuntimeAgentLaunchSupported(agent.id) && agent.installed);
}

export function getTaskAgentNavbarHint(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents" | "nkleinProviderSettings"> | null | undefined,
	options?: {
		shouldUseNavigationPath?: boolean;
	},
): string | undefined {
	if (options?.shouldUseNavigationPath) {
		return undefined;
	}
	const isTaskAgentReady = isTaskAgentSetupSatisfied(config);
	if (isTaskAgentReady === null || isTaskAgentReady) {
		return undefined;
	}
	return "No agent configured";
}

export function selectLatestTaskChatMessageForTask(
	taskId: string | null | undefined,
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null,
): RuntimeTaskChatMessage | null {
	if (!taskId || !latestTaskChatMessage || latestTaskChatMessage.taskId !== taskId) {
		return null;
	}
	return latestTaskChatMessage.message;
}

export function selectTaskChatMessagesForTask(
	taskId: string | null | undefined,
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>,
): RuntimeTaskChatMessage[] | null {
	if (!taskId) {
		return null;
	}
	return taskChatMessagesByTaskId[taskId] ?? null;
}
