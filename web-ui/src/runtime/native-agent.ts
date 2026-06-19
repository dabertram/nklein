import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";
import type {
	RuntimeAgentId,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
	RuntimeStateStreamTaskChatMessage,
	RuntimeTaskChatMessage,
} from "@/runtime/types";

export function isNativeClineAgentSelected(agentId: RuntimeAgentId | null | undefined): boolean {
	return agentId === "cline";
}

// Secondary UI screen only; the backend policy in src/cline-sdk/cline-local-only-policy.ts is authoritative.
const KNOWN_CLOUD_PROVIDER_IDS = new Set([
	"anthropic",
	"bedrock",
	"cline",
	"oca",
	"openai",
	"openai-codex",
	"openrouter",
	"vertex",
]);

export function isCloudProviderSupportEnabled(
	config: Pick<RuntimeConfigResponse, "cloudProviderSupportEnabled"> | null | undefined,
): boolean {
	return config?.cloudProviderSupportEnabled ?? false;
}

export function isKnownCloudProviderId(providerId: string | null | undefined): boolean {
	const normalized = providerId?.trim().toLowerCase();
	return normalized ? KNOWN_CLOUD_PROVIDER_IDS.has(normalized) : false;
}

export function filterVisibleClineProviderCatalog(
	providers: RuntimeClineProviderCatalogItem[],
	cloudProviderSupportEnabled: boolean,
): RuntimeClineProviderCatalogItem[] {
	if (cloudProviderSupportEnabled) {
		return providers;
	}
	return providers.filter((provider) => !isKnownCloudProviderId(provider.id));
}

export function getRuntimeClineProviderSettings(
	config: Pick<RuntimeConfigResponse, "clineProviderSettings"> | null | undefined,
): RuntimeClineProviderSettings {
	return (
		config?.clineProviderSettings ?? {
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

export function isClineProviderAuthenticated(settings: RuntimeClineProviderSettings | null | undefined): boolean {
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
 * Returns true only when the selected provider is the Cline managed OAuth
 * provider **and** an access token is configured.  This is stricter than
 * {@link isClineProviderAuthenticated} which accepts any configured provider
 * (Claude API key, Codex, etc.).
 *
 * Use this for features that require a Cline-issued token (e.g. Featurebase
 * JWT authentication).
 */
export function isClineOauthAuthenticated(settings: RuntimeClineProviderSettings | null | undefined): boolean {
	if (!settings) {
		return false;
	}
	return (
		settings.oauthProvider === "cline" &&
		settings.oauthAccessTokenConfigured === true &&
		settings.oauthRefreshTokenConfigured === true
	);
}

export function isTaskAgentSetupSatisfied(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents" | "clineProviderSettings"> | null | undefined,
): boolean | null {
	if (!config) {
		return null;
	}
	if (isNativeClineAgentSelected(config.selectedAgentId)) {
		if (isClineProviderAuthenticated(getRuntimeClineProviderSettings(config))) {
			return true;
		}
		return config.agents.some(
			(agent) => agent.id !== "cline" && isRuntimeAgentLaunchSupported(agent.id) && agent.installed,
		);
	}
	return config.agents.some((agent) => isRuntimeAgentLaunchSupported(agent.id) && agent.installed);
}

export function getTaskAgentNavbarHint(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents" | "clineProviderSettings"> | null | undefined,
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
