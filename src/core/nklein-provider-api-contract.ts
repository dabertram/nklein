import { z } from "zod";
import {
	runtimeCodeEmbeddingSettingsSchema,
	runtimeNKleinReasoningEffortSchema,
} from "./runtime-config-api-contract.js";

// NKlein account / provider / model-registry contract domain: oauth provider, provider settings, account
// (profile / kanban-access / orgs / balance / switch), Featurebase token, provider catalog + models + endpoint
// discovery, the model registry (entry/response/context-window + max-concurrent overrides/remove/prune), and
// code-intelligence status. Split out of api-contract.ts (§5.X #2). Imports z + code-embedding + reasoning-effort
// from runtime-config — never the barrel.

export const runtimeNKleinOauthProviderSchema = z.enum(["nklein", "oca", "openai-codex"]);
export type RuntimeNKleinOauthProvider = z.infer<typeof runtimeNKleinOauthProviderSchema>;

export const runtimeNKleinProviderSettingsSchema = z.object({
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	baseUrl: z.string().nullable(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.nullable().optional(),
	apiKeyConfigured: z.boolean(),
	oauthProvider: runtimeNKleinOauthProviderSchema.nullable(),
	oauthAccessTokenConfigured: z.boolean(),
	oauthRefreshTokenConfigured: z.boolean(),
	oauthAccountId: z.string().nullable(),
	oauthExpiresAt: z.number().int().positive().nullable(),
});
export type RuntimeNKleinProviderSettings = z.infer<typeof runtimeNKleinProviderSettingsSchema>;

export const runtimeNKleinAccountProfileSchema = z.object({
	accountId: z.string().nullable(),
	email: z.string().nullable(),
	displayName: z.string().nullable(),
});
export type RuntimeNKleinAccountProfile = z.infer<typeof runtimeNKleinAccountProfileSchema>;

export const runtimeNKleinAccountProfileResponseSchema = z.object({
	profile: runtimeNKleinAccountProfileSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountProfileResponse = z.infer<typeof runtimeNKleinAccountProfileResponseSchema>;

export const runtimeNKleinKanbanAccessResponseSchema = z.object({
	enabled: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeNKleinKanbanAccessResponse = z.infer<typeof runtimeNKleinKanbanAccessResponseSchema>;

export const runtimeNKleinAccountOrganizationSchema = z.object({
	organizationId: z.string(),
	name: z.string(),
	active: z.boolean(),
	roles: z.array(z.string()),
});
export type RuntimeNKleinAccountOrganization = z.infer<typeof runtimeNKleinAccountOrganizationSchema>;

export const runtimeNKleinAccountOrganizationsResponseSchema = z.object({
	organizations: z.array(runtimeNKleinAccountOrganizationSchema),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountOrganizationsResponse = z.infer<typeof runtimeNKleinAccountOrganizationsResponseSchema>;

export const runtimeNKleinAccountBalanceResponseSchema = z.object({
	balance: z.number().nullable(),
	activeAccountLabel: z.string().nullable(),
	activeOrganizationId: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountBalanceResponse = z.infer<typeof runtimeNKleinAccountBalanceResponseSchema>;

export const runtimeNKleinAccountSwitchRequestSchema = z.object({
	organizationId: z.string().nullable(),
});
export type RuntimeNKleinAccountSwitchRequest = z.infer<typeof runtimeNKleinAccountSwitchRequestSchema>;

export const runtimeNKleinAccountSwitchResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountSwitchResponse = z.infer<typeof runtimeNKleinAccountSwitchResponseSchema>;

export const runtimeFeaturebaseTokenResponseSchema = z.object({
	featurebaseJwt: z.string(),
});
export type RuntimeFeaturebaseTokenResponse = z.infer<typeof runtimeFeaturebaseTokenResponseSchema>;

export const runtimeNKleinProviderCatalogItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	oauthSupported: z.boolean(),
	enabled: z.boolean(),
	defaultModelId: z.string().nullable(),
	baseUrl: z.string().nullable(),
	supportsBaseUrl: z.boolean(),
	env: z.array(z.string()).optional(),
});
export type RuntimeNKleinProviderCatalogItem = z.infer<typeof runtimeNKleinProviderCatalogItemSchema>;

export const runtimeNKleinProviderCatalogResponseSchema = z.object({
	providers: z.array(runtimeNKleinProviderCatalogItemSchema),
});
export type RuntimeNKleinProviderCatalogResponse = z.infer<typeof runtimeNKleinProviderCatalogResponseSchema>;

export const runtimeNKleinProviderModelsRequestSchema = z.object({
	providerId: z.string(),
});
export type RuntimeNKleinProviderModelsRequest = z.infer<typeof runtimeNKleinProviderModelsRequestSchema>;

export const runtimeNKleinProviderModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string().optional(),
	contextWindow: z.number().int().nonnegative().optional(),
	supportsVision: z.boolean().optional(),
	supportsAttachments: z.boolean().optional(),
	supportsReasoningEffort: z.boolean().optional(),
});
export type RuntimeNKleinProviderModel = z.infer<typeof runtimeNKleinProviderModelSchema>;

export const runtimeNKleinProviderModelsResponseSchema = z.object({
	providerId: z.string(),
	models: z.array(runtimeNKleinProviderModelSchema),
});
export type RuntimeNKleinProviderModelsResponse = z.infer<typeof runtimeNKleinProviderModelsResponseSchema>;

export const runtimeNKleinEndpointModelDiscoveryRequestSchema = z.object({
	baseUrl: z.string().min(1),
	apiKey: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	timeoutMs: z.number().int().positive().nullable().optional(),
});
export type RuntimeNKleinEndpointModelDiscoveryRequest = z.infer<
	typeof runtimeNKleinEndpointModelDiscoveryRequestSchema
>;

export const runtimeNKleinEndpointModelDiscoveryResponseSchema = z.object({
	modelSourceUrl: z.string(),
	models: z.array(runtimeNKleinProviderModelSchema),
});
export type RuntimeNKleinEndpointModelDiscoveryResponse = z.infer<
	typeof runtimeNKleinEndpointModelDiscoveryResponseSchema
>;

export const runtimeNKleinModelRegistryEntrySchema = z.object({
	key: z.string(),
	providerId: z.string(),
	modelId: z.string(),
	endpoint: z.string().nullable(),
	contextWindow: z.object({
		advertised: z.number().int().positive().nullable(),
		observed: z.number().int().positive().nullable(),
		userOverride: z.number().int().positive().nullable(),
		effective: z.number().int().positive().nullable(),
	}),
	speed: z.object({
		samples: z.number().int().nonnegative(),
		promptTokensEwma: z.number().nonnegative().nullable(),
		outputTokensEwma: z.number().nonnegative().nullable(),
		totalTokensEwma: z.number().nonnegative().nullable(),
		prefillTokensPerSecondEwma: z.number().nonnegative().nullable(),
		decodeTokensPerSecondEwma: z.number().nonnegative().nullable(),
		ttftMsEwma: z.number().nonnegative().nullable(),
		wallTimeMsEwma: z.number().nonnegative().nullable(),
		wallTimeMsPer1kPromptTokensEwma: z.number().nonnegative().nullable(),
		lastPromptTokens: z.number().int().nonnegative().nullable(),
		lastOutputTokens: z.number().int().nonnegative().nullable(),
		lastWallTimeMs: z.number().nonnegative().nullable(),
		lastObservedAt: z.number().int().nonnegative().nullable(),
	}),
	capability: z.object({
		samples: z.number().int().nonnegative(),
		staticPrior: z.number().min(0).max(100),
		evalScore: z.number().min(0).max(100).nullable(),
		externalScore: z.number().min(0).max(100).nullable(),
		observedPassRate: z.number().min(0).max(1).nullable(),
		effectiveScore: z.number().min(0).max(100),
		lastObservedAt: z.number().int().nonnegative().nullable(),
	}),
	constraints: z.object({
		sharedEndpointId: z.string().nullable(),
		inputCostPerMillionTokens: z.number().nonnegative().nullable(),
		outputCostPerMillionTokens: z.number().nonnegative().nullable(),
		// Per-model parallel-request capacity (e.g. LM Studio's per-model concurrent-requests setting). null/absent
		// means the default of 1 (serialize on the shared endpoint). Optional during rollout for older snapshots.
		maxConcurrentRequests: z.number().int().positive().nullable().optional(),
	}),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});
export type RuntimeNKleinModelRegistryEntry = z.infer<typeof runtimeNKleinModelRegistryEntrySchema>;

export const runtimeModelFleetSuggestionSchema = z.object({
	kind: z.enum(["no_agentic_model", "add_diverse_family", "add_reasoning_model"]),
	severity: z.enum(["info", "warn"]),
	title: z.string(),
	detail: z.string(),
});
export type RuntimeModelFleetSuggestion = z.infer<typeof runtimeModelFleetSuggestionSchema>;

export const runtimeNKleinModelRegistryResponseSchema = z.object({
	schemaVersion: z.number().int().positive(),
	updatedAt: z.number().int().nonnegative(),
	models: z.array(runtimeNKleinModelRegistryEntrySchema),
	fleetSuggestions: z.array(runtimeModelFleetSuggestionSchema),
});
export type RuntimeNKleinModelRegistryResponse = z.infer<typeof runtimeNKleinModelRegistryResponseSchema>;

export const runtimeLlmfitCatalogUpdateCheckResponseSchema = z.object({
	mode: z.enum(["off", "notify", "auto"]),
	action: z.enum(["noop", "up_to_date", "suggest_update", "pull_update"]),
	reason: z.string(),
	sourceUrl: z.string(),
	downloadUrl: z.string().nullable(),
	localRevision: z.string().nullable(),
	remoteRevision: z.string().nullable(),
	remoteModelCount: z.number().int().nonnegative().nullable(),
	remoteSizeBytes: z.number().int().nonnegative().nullable(),
	checkedAt: z.number().int().nonnegative(),
	error: z.string().optional(),
});
export type RuntimeLlmfitCatalogUpdateCheckResponse = z.infer<typeof runtimeLlmfitCatalogUpdateCheckResponseSchema>;

export const runtimeNKleinModelContextWindowOverrideRequestSchema = z.object({
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	endpoint: z.string().nullable().optional(),
	contextWindow: z.number().int().positive().nullable(),
});
export type RuntimeNKleinModelContextWindowOverrideRequest = z.infer<
	typeof runtimeNKleinModelContextWindowOverrideRequestSchema
>;

export const runtimeNKleinModelContextWindowOverrideResponseSchema = z.object({
	model: runtimeNKleinModelRegistryEntrySchema,
});
export type RuntimeNKleinModelContextWindowOverrideResponse = z.infer<
	typeof runtimeNKleinModelContextWindowOverrideResponseSchema
>;

export const runtimeNKleinModelMaxConcurrentRequestsRequestSchema = z.object({
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	endpoint: z.string().nullable().optional(),
	// null clears the override (back to the default of 1 concurrent request on the shared endpoint).
	maxConcurrentRequests: z.number().int().positive().nullable(),
});
export type RuntimeNKleinModelMaxConcurrentRequestsRequest = z.infer<
	typeof runtimeNKleinModelMaxConcurrentRequestsRequestSchema
>;

export const runtimeNKleinModelMaxConcurrentRequestsResponseSchema = z.object({
	model: runtimeNKleinModelRegistryEntrySchema,
});
export type RuntimeNKleinModelMaxConcurrentRequestsResponse = z.infer<
	typeof runtimeNKleinModelMaxConcurrentRequestsResponseSchema
>;

export const runtimeNKleinModelRegistryRemoveRequestSchema = z.object({
	key: z.string().min(1),
});
export type RuntimeNKleinModelRegistryRemoveRequest = z.infer<typeof runtimeNKleinModelRegistryRemoveRequestSchema>;

export const runtimeNKleinModelRegistryRemoveResponseSchema = z.object({
	removed: z.boolean(),
});
export type RuntimeNKleinModelRegistryRemoveResponse = z.infer<typeof runtimeNKleinModelRegistryRemoveResponseSchema>;

export const runtimeNKleinModelRegistryPruneResponseSchema = z.object({
	removed: z.number().int().nonnegative(),
});
export type RuntimeNKleinModelRegistryPruneResponse = z.infer<typeof runtimeNKleinModelRegistryPruneResponseSchema>;

export const runtimeNKleinCodeIntelligenceStatusResponseSchema = z.object({
	codeEmbeddingSettings: z.object({
		globalDefaults: runtimeCodeEmbeddingSettingsSchema,
		projectOverride: runtimeCodeEmbeddingSettingsSchema.nullable(),
		effective: runtimeCodeEmbeddingSettingsSchema,
		source: z.enum(["global", "project"]),
	}),
	/** Status of the built-in GGUF embedding model file, when the effective provider is `local_gguf`. */
	embeddingModelFile: z
		.object({
			modelId: z.string(),
			label: z.string(),
			installed: z.boolean(),
			sizeBytes: z.number().int().nonnegative().nullable(),
			/** True when the Python core that serves this model is enabled; otherwise it runs as lexical. */
			coreEnabled: z.boolean(),
		})
		.nullable(),
	repoMap: z.object({
		filesScanned: z.number().int().nonnegative(),
		symbols: z.number().int().nonnegative(),
		tokenCount: z.number().int().nonnegative(),
		truncated: z.boolean(),
		available: z.boolean(),
		error: z.string().nullable(),
	}),
	codeIndex: z.object({
		cachePath: z.string().nullable(),
		cacheExists: z.boolean(),
		embeddingProvider: z.string().nullable(),
		embeddingModel: z.string().nullable(),
		updatedAt: z.number().int().nonnegative().nullable(),
		totalFiles: z.number().int().nonnegative(),
		totalChunks: z.number().int().nonnegative(),
		indexedFiles: z.number().int().nonnegative(),
		indexedChunks: z.number().int().nonnegative(),
		staleFiles: z.number().int().nonnegative(),
		missingFiles: z.number().int().nonnegative(),
		searchAvailable: z.boolean(),
		progress: z.object({
			phase: z.enum(["idle", "scanning", "embedding", "persisting", "complete", "error"]),
			startedAt: z.number().int().nonnegative().nullable(),
			updatedAt: z.number().int().nonnegative().nullable(),
			filesTotal: z.number().int().nonnegative(),
			filesProcessed: z.number().int().nonnegative(),
			chunksTotal: z.number().int().nonnegative(),
			chunksProcessed: z.number().int().nonnegative(),
			cacheHitCount: z.number().int().nonnegative(),
			cacheMissCount: z.number().int().nonnegative(),
			message: z.string().nullable(),
		}),
		error: z.string().nullable(),
	}),
});
export type RuntimeNKleinCodeIntelligenceStatusResponse = z.infer<
	typeof runtimeNKleinCodeIntelligenceStatusResponseSchema
>;
