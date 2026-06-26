import { z } from "zod";
import {
	runtimeNKleinOauthProviderSchema,
	runtimeNKleinProviderSettingsSchema,
} from "./nklein-provider-api-contract.js";
import { runtimeNKleinReasoningEffortSchema } from "./runtime-config-api-contract.js";

// NKlein provider-mutation + auth contract domain: provider capability, add / update provider, OAuth login,
// device auth (start / complete), and provider-settings save. Split out of api-contract.ts (§5.X #2). Imports
// oauth-provider + provider-settings (nklein-provider) and reasoning-effort (runtime-config) — never the barrel.

export const runtimeNKleinProviderCapabilitySchema = z.enum([
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"prompt-cache",
]);
export type RuntimeNKleinProviderCapability = z.infer<typeof runtimeNKleinProviderCapabilitySchema>;

export const runtimeNKleinAddProviderRequestSchema = z.object({
	providerId: z.string(),
	name: z.string(),
	baseUrl: z.string(),
	apiKey: z.string().nullable().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	timeoutMs: z.number().int().positive().optional(),
	models: z.array(z.string()),
	defaultModelId: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	capabilities: z.array(runtimeNKleinProviderCapabilitySchema).optional(),
});
export type RuntimeNKleinAddProviderRequest = z.infer<typeof runtimeNKleinAddProviderRequestSchema>;

export const runtimeNKleinAddProviderResponseSchema = runtimeNKleinProviderSettingsSchema;
export type RuntimeNKleinAddProviderResponse = z.infer<typeof runtimeNKleinAddProviderResponseSchema>;

export const runtimeNKleinUpdateProviderRequestSchema = z.object({
	providerId: z.string(),
	name: z.string().optional(),
	baseUrl: z.string().optional(),
	apiKey: z.string().nullable().optional(),
	headers: z.record(z.string(), z.string()).nullable().optional(),
	timeoutMs: z.number().int().positive().nullable().optional(),
	models: z.array(z.string()).optional(),
	defaultModelId: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	capabilities: z.array(runtimeNKleinProviderCapabilitySchema).optional(),
});
export type RuntimeNKleinUpdateProviderRequest = z.infer<typeof runtimeNKleinUpdateProviderRequestSchema>;

export const runtimeNKleinUpdateProviderResponseSchema = runtimeNKleinProviderSettingsSchema;
export type RuntimeNKleinUpdateProviderResponse = z.infer<typeof runtimeNKleinUpdateProviderResponseSchema>;

export const runtimeNKleinOauthLoginRequestSchema = z.object({
	provider: runtimeNKleinOauthProviderSchema,
	baseUrl: z.string().nullable().optional(),
});
export type RuntimeNKleinOauthLoginRequest = z.infer<typeof runtimeNKleinOauthLoginRequestSchema>;

export const runtimeNKleinOauthLoginResponseSchema = z.object({
	ok: z.boolean(),
	provider: runtimeNKleinOauthProviderSchema,
	settings: runtimeNKleinProviderSettingsSchema.optional(),
	error: z.string().optional(),
});
export type RuntimeNKleinOauthLoginResponse = z.infer<typeof runtimeNKleinOauthLoginResponseSchema>;

export const runtimeNKleinDeviceAuthStartResponseSchema = z.object({
	deviceCode: z.string(),
	userCode: z.string(),
	verificationUrl: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
});
export type RuntimeNKleinDeviceAuthStartResponse = z.infer<typeof runtimeNKleinDeviceAuthStartResponseSchema>;

export const runtimeNKleinDeviceAuthCompleteRequestSchema = z.object({
	deviceCode: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
	baseUrl: z.string().nullable().optional(),
});
export type RuntimeNKleinDeviceAuthCompleteRequest = z.infer<typeof runtimeNKleinDeviceAuthCompleteRequestSchema>;

export const runtimeNKleinDeviceAuthCompleteResponseSchema = runtimeNKleinOauthLoginResponseSchema;
export type RuntimeNKleinDeviceAuthCompleteResponse = z.infer<typeof runtimeNKleinDeviceAuthCompleteResponseSchema>;

export const runtimeNKleinProviderSettingsSaveRequestSchema = z.object({
	providerId: z.string(),
	modelId: z.string().nullable().optional(),
	apiKey: z.string().nullable().optional(),
	baseUrl: z.string().nullable().optional(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.nullable().optional(),
	region: z.string().nullable().optional(),
	aws: z
		.object({
			accessKey: z.string().nullable().optional(),
			secretKey: z.string().nullable().optional(),
			sessionToken: z.string().nullable().optional(),
			region: z.string().nullable().optional(),
			profile: z.string().nullable().optional(),
			authentication: z.enum(["iam", "api-key", "profile"]).nullable().optional(),
			endpoint: z.string().nullable().optional(),
		})
		.optional(),
	gcp: z
		.object({
			projectId: z.string().nullable().optional(),
			region: z.string().nullable().optional(),
		})
		.optional(),
});
export type RuntimeNKleinProviderSettingsSaveRequest = z.infer<typeof runtimeNKleinProviderSettingsSaveRequestSchema>;

export const runtimeNKleinProviderSettingsSaveResponseSchema = runtimeNKleinProviderSettingsSchema;
export type RuntimeNKleinProviderSettingsSaveResponse = z.infer<typeof runtimeNKleinProviderSettingsSaveResponseSchema>;
