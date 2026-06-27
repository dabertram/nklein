// Browser-side query helpers: NKlein provider settings, catalog/model discovery, accounts, and auth.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeFeaturebaseTokenResponse,
	RuntimeNKleinAccountBalanceResponse,
	RuntimeNKleinAccountOrganizationsResponse,
	RuntimeNKleinAccountProfileResponse,
	RuntimeNKleinAccountSwitchResponse,
	RuntimeNKleinAddProviderResponse,
	RuntimeNKleinDeviceAuthCompleteRequest,
	RuntimeNKleinDeviceAuthCompleteResponse,
	RuntimeNKleinDeviceAuthStartResponse,
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinKanbanAccessResponse,
	RuntimeNKleinOauthLoginResponse,
	RuntimeNKleinOauthProvider,
	RuntimeNKleinProviderCapability,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderSettings,
	RuntimeNKleinReasoningEffort,
	RuntimeNKleinUpdateProviderResponse,
} from "@/runtime/types";

export async function saveNKleinProviderSettings(
	workspaceId: string | null,
	input: {
		providerId: string;
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
	},
): Promise<RuntimeNKleinProviderSettings> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinProviderSettings.mutate(input);
}

export async function addNKleinProvider(
	workspaceId: string | null,
	input: {
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
	},
): Promise<RuntimeNKleinAddProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.addNKleinProvider.mutate(input);
}

export async function updateNKleinProvider(
	workspaceId: string | null,
	input: {
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
	},
): Promise<RuntimeNKleinUpdateProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.updateNKleinProvider.mutate(input);
}

export async function fetchNKleinProviderCatalog(
	workspaceId: string | null,
): Promise<RuntimeNKleinProviderCatalogItem[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getNKleinProviderCatalog.query();
	return response.providers;
}

/**
 * Discovering live provider models (e.g. LM Studio `/v1/models`) can hang if the local endpoint is slow or
 * unreachable. Bound it so the settings spinner can never spin forever — on timeout the caller surfaces an
 * error and stops loading instead of stalling.
 */
const NKLEIN_PROVIDER_MODELS_TIMEOUT_MS = 15_000;

export async function fetchNKleinProviderModels(
	workspaceId: string | null,
	providerId: string,
): Promise<RuntimeNKleinProviderModel[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getNKleinProviderModels.query(
		{ providerId },
		{ signal: AbortSignal.timeout(NKLEIN_PROVIDER_MODELS_TIMEOUT_MS) },
	);
	return response.models;
}

export async function discoverNKleinEndpointModels(
	workspaceId: string | null,
	input: {
		baseUrl: string;
		apiKey?: string | null;
		modelsSourceUrl?: string | null;
		timeoutMs?: number | null;
	},
): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.discoverNKleinEndpointModels.query(input);
}

export async function fetchNKleinAccountProfile(
	workspaceId: string | null,
): Promise<RuntimeNKleinAccountProfileResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinAccountProfile.query();
}

export async function fetchNKleinKanbanAccess(workspaceId: string | null): Promise<RuntimeNKleinKanbanAccessResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinKanbanAccess.query();
}

export async function fetchFeaturebaseToken(workspaceId: string | null): Promise<RuntimeFeaturebaseTokenResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getFeaturebaseToken.query();
}

export async function runNKleinProviderOauthLogin(
	workspaceId: string | null,
	input: {
		provider: RuntimeNKleinOauthProvider;
		baseUrl?: string | null;
	},
): Promise<RuntimeNKleinOauthLoginResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runNKleinProviderOAuthLogin.mutate(input);
}

export async function startNKleinDeviceAuth(workspaceId: string | null): Promise<RuntimeNKleinDeviceAuthStartResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.startNKleinDeviceAuth.mutate();
}

export async function completeNKleinDeviceAuth(
	workspaceId: string | null,
	input: RuntimeNKleinDeviceAuthCompleteRequest,
): Promise<RuntimeNKleinDeviceAuthCompleteResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.completeNKleinDeviceAuth.mutate(input);
}

export async function fetchNKleinAccountBalance(
	workspaceId: string | null,
): Promise<RuntimeNKleinAccountBalanceResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinAccountBalance.query();
}

export async function fetchNKleinAccountOrganizations(
	workspaceId: string | null,
): Promise<RuntimeNKleinAccountOrganizationsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinAccountOrganizations.query();
}

export async function switchNKleinAccount(
	workspaceId: string | null,
	organizationId: string | null,
): Promise<RuntimeNKleinAccountSwitchResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.switchNKleinAccount.mutate({ organizationId });
}
