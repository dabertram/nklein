import type {
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderSettingsSaveResponse,
	RuntimeNKleinReasoningEffort,
} from "../core/api-contract";
import { assertNKleinContextWindowPolicy } from "./nklein-context-window-policy";
import { assertLocalProviderAllowed } from "./nklein-local-only-policy";
import { hasOauthAccessToken } from "./nklein-provider-credential-helpers";
import { isLiveOnlyProviderId, isManagedOauthProviderId } from "./nklein-provider-id-classification";
import { writeKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import { toProviderSettingsSummary } from "./nklein-provider-settings-summary";
import { getSdkProviderSettings, type SdkProviderSettings, saveSdkProviderSettings } from "./sdk-provider-boundary";

export interface SaveProviderSettingsInput {
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
}

/**
 * Service touchpoint: `loadProviderModelsWithMeasuredWindows` stays defined in nklein-provider-service (shared with the
 * catalog/launch-config paths) and is injected so the settings writer doesn't drag the model-fetch subsystem with it.
 */
export interface ProviderSettingsWriterDeps {
	loadProviderModelsWithMeasuredWindows(
		providerId: string,
		settingsOverride?: SdkProviderSettings | null,
	): Promise<RuntimeNKleinProviderModel[]>;
}

export interface ProviderSettingsWriter {
	saveProviderSettings(input: SaveProviderSettingsInput): Promise<RuntimeNKleinProviderSettingsSaveResponse>;
}

/**
 * The provider settings-WRITE chokepoint, extracted verbatim from createNKleinProviderService. Normalizes each field
 * onto the existing settings (trim + delete-on-empty for model/baseUrl/apiKey/reasoning/region/aws/gcp), validates
 * provider-specific requirements (Vertex needs a GCP project id; a Vertex Claude model needs a region), strips managed
 * OAuth `auth` from non-managed providers, enforces the LOCAL-ONLY lockdown before persistence, checks the model meets
 * the context-window policy, then persists + selects the provider.
 */
export function createProviderSettingsWriter(deps: ProviderSettingsWriterDeps): ProviderSettingsWriter {
	async function assertProviderModelMeetsContextRequirement(input: {
		providerId: string;
		modelId: string | null | undefined;
		settings?: SdkProviderSettings | null;
		label?: string;
	}): Promise<void> {
		const modelId = input.modelId?.trim();
		if (!modelId) {
			return;
		}
		const providerModels = await deps.loadProviderModelsWithMeasuredWindows(input.providerId, input.settings);
		const resolvedModel = providerModels.find((model) => model.id === modelId) ?? null;
		if (isLiveOnlyProviderId(input.providerId) && !resolvedModel) {
			throw new Error(
				`Selected LM Studio model "${modelId}" is not currently loaded. Load it in LM Studio, refresh models, then choose it before activation.`,
			);
		}
		assertNKleinContextWindowPolicy({
			providerId: input.providerId,
			modelId,
			contextWindow: resolvedModel?.contextWindow ?? null,
			label: input.label ?? "Selected !Klein model",
		});
	}

	async function saveProviderSettings(
		input: SaveProviderSettingsInput,
	): Promise<RuntimeNKleinProviderSettingsSaveResponse> {
		const providerId = input.providerId.trim().toLowerCase();
		if (!providerId) {
			throw new Error("Provider ID cannot be empty.");
		}

		const existingSettings = getSdkProviderSettings(providerId) ?? {
			provider: providerId,
		};
		const nextSettings: SdkProviderSettings = {
			...existingSettings,
			provider: providerId,
		};

		if (input.modelId !== undefined) {
			const modelId = input.modelId?.trim() ?? "";
			if (modelId) {
				nextSettings.model = modelId;
			} else {
				delete nextSettings.model;
			}
		}

		if (input.baseUrl !== undefined) {
			const baseUrl = input.baseUrl?.trim() ?? "";
			if (baseUrl) {
				nextSettings.baseUrl = baseUrl;
			} else {
				delete nextSettings.baseUrl;
			}
		}

		if (input.apiKey !== undefined) {
			const apiKey = input.apiKey?.trim() ?? "";
			if (apiKey) {
				nextSettings.apiKey = apiKey;
			} else {
				delete nextSettings.apiKey;
			}
		}

		if (input.reasoningEffort !== undefined) {
			const nextReasoning = { ...(nextSettings.reasoning ?? {}) };
			if (input.reasoningEffort) {
				nextReasoning.effort = input.reasoningEffort;
			} else {
				delete nextReasoning.effort;
			}
			if (
				nextReasoning.enabled === undefined &&
				nextReasoning.effort === undefined &&
				nextReasoning.budgetTokens === undefined
			) {
				delete nextSettings.reasoning;
			} else {
				nextSettings.reasoning = nextReasoning;
			}
		}

		if (input.region !== undefined) {
			const region = input.region?.trim() ?? "";
			if (region) {
				nextSettings.region = region;
			} else {
				delete nextSettings.region;
			}
		}

		if (input.aws !== undefined) {
			const nextAws = { ...(nextSettings.aws ?? {}) } as NonNullable<SdkProviderSettings["aws"]>;
			if (input.aws.accessKey !== undefined) {
				const accessKey = input.aws.accessKey?.trim() ?? "";
				if (accessKey) nextAws.accessKey = accessKey;
				else delete nextAws.accessKey;
			}
			if (input.aws.secretKey !== undefined) {
				const secretKey = input.aws.secretKey?.trim() ?? "";
				if (secretKey) nextAws.secretKey = secretKey;
				else delete nextAws.secretKey;
			}
			if (input.aws.sessionToken !== undefined) {
				const sessionToken = input.aws.sessionToken?.trim() ?? "";
				if (sessionToken) nextAws.sessionToken = sessionToken;
				else delete nextAws.sessionToken;
			}
			if (input.aws.region !== undefined) {
				const awsRegion = input.aws.region?.trim() ?? "";
				if (awsRegion) nextAws.region = awsRegion;
				else delete nextAws.region;
			}
			if (input.aws.profile !== undefined) {
				const profile = input.aws.profile?.trim() ?? "";
				if (profile) nextAws.profile = profile;
				else delete nextAws.profile;
			}
			if (input.aws.authentication !== undefined) {
				const authentication = input.aws.authentication;
				if (authentication) nextAws.authentication = authentication;
				else delete nextAws.authentication;
			}
			if (input.aws.endpoint !== undefined) {
				const endpoint = input.aws.endpoint?.trim() ?? "";
				if (endpoint) nextAws.endpoint = endpoint;
				else delete nextAws.endpoint;
			}

			if (
				nextAws.accessKey === undefined &&
				nextAws.secretKey === undefined &&
				nextAws.sessionToken === undefined &&
				nextAws.region === undefined &&
				nextAws.profile === undefined &&
				nextAws.authentication === undefined &&
				nextAws.usePromptCache === undefined &&
				nextAws.useCrossRegionInference === undefined &&
				nextAws.useGlobalInference === undefined &&
				nextAws.endpoint === undefined &&
				nextAws.customModelBaseId === undefined
			) {
				delete nextSettings.aws;
			} else {
				nextSettings.aws = nextAws;
			}
		}

		if (input.gcp !== undefined) {
			const nextGcp = { ...(nextSettings.gcp ?? {}) } as NonNullable<SdkProviderSettings["gcp"]>;
			if (input.gcp.projectId !== undefined) {
				const projectId = input.gcp.projectId?.trim() ?? "";
				if (projectId) nextGcp.projectId = projectId;
				else delete nextGcp.projectId;
			}
			if (input.gcp.region !== undefined) {
				const gcpRegion = input.gcp.region?.trim() ?? "";
				if (gcpRegion) nextGcp.region = gcpRegion;
				else delete nextGcp.region;
			}
			if (nextGcp.projectId === undefined && nextGcp.region === undefined) {
				delete nextSettings.gcp;
			} else {
				nextSettings.gcp = nextGcp;
			}
		}

		if (providerId === "vertex") {
			const projectId = nextSettings.gcp?.projectId?.trim() ?? "";
			if (!projectId) {
				throw new Error("Vertex provider requires GCP Project ID.");
			}
			const modelId = nextSettings.model?.trim().toLowerCase() ?? "";
			const isClaudeModel = modelId.includes("claude");
			const resolvedRegion = nextSettings.gcp?.region?.trim() || nextSettings.region?.trim() || "";
			if (isClaudeModel && !resolvedRegion) {
				throw new Error("Vertex Claude models require GCP Region (or Region).");
			}
		}

		if (!isManagedOauthProviderId(providerId)) {
			delete nextSettings.auth;
		}
		assertLocalProviderAllowed({ providerId, baseUrl: nextSettings.baseUrl });

		await assertProviderModelMeetsContextRequirement({
			providerId,
			modelId: nextSettings.model,
			settings: nextSettings,
			label: "Selected !Klein model",
		});

		saveSdkProviderSettings({
			settings: nextSettings,
			tokenSource: hasOauthAccessToken(nextSettings) ? "oauth" : "manual",
			setLastUsed: true,
		});
		writeKanbanSelectedProviderId(providerId);

		return toProviderSettingsSummary(nextSettings);
	}

	return { saveProviderSettings };
}
