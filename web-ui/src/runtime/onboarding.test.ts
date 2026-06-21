import { describe, expect, it } from "vitest";

import {
	buildFirstRunLocalModelRoles,
	isLocalNKleinProviderSettings,
	isSelectedAgentAuthenticated,
	shouldShowStartupOnboardingDialog,
} from "@/runtime/onboarding";

describe("runtime onboarding helpers", () => {
	it("treats non-nklein selections as authenticated", () => {
		expect(isSelectedAgentAuthenticated("claude", null)).toBe(true);
		expect(isSelectedAgentAuthenticated("codex", null)).toBe(true);
	});

	it("checks nklein authentication from provider settings", () => {
		expect(
			isSelectedAgentAuthenticated("nklein", {
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(false);
		expect(
			isSelectedAgentAuthenticated("nklein", {
				providerId: "anthropic",
				modelId: "claude-3-7-sonnet",
				baseUrl: null,
				apiKeyConfigured: true,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
	});

	it("shows startup onboarding at least once for configured users", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: false,
			}),
		).toBe(true);
	});

	it("does not reopen startup onboarding after it has been shown", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: true,
				selectedAgentId: "codex",
			}),
		).toBe(false);
	});

	it("reopens startup onboarding for NKlein without a configured local model", () => {
		expect(
			shouldShowStartupOnboardingDialog({
				hasShownOnboardingDialog: true,
				selectedAgentId: "nklein",
				nkleinProviderSettings: {
					providerId: "openrouter",
					modelId: "cloud-model",
					baseUrl: null,
					apiKeyConfigured: true,
					oauthProvider: null,
					oauthAccessTokenConfigured: false,
					oauthRefreshTokenConfigured: false,
					oauthAccountId: null,
					oauthExpiresAt: null,
				},
			}),
		).toBe(true);
	});

	it("recognizes built-in and local-endpoint NKlein providers", () => {
		expect(
			isLocalNKleinProviderSettings({
				providerId: "lm-studio",
				modelId: "qwen3",
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
		expect(
			isLocalNKleinProviderSettings({
				providerId: "openai-compatible",
				modelId: "local-model",
				baseUrl: "http://model-host.local:1234/v1",
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
		expect(
			isLocalNKleinProviderSettings({
				providerId: "openai-compatible",
				modelId: "local-model",
				baseUrl: "http://100.64.0.10:1234/v1",
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
	});

	it("seeds first-run local model roles when they are empty", () => {
		expect(
			buildFirstRunLocalModelRoles({
				existingRoles: undefined,
				providerId: " ollama ",
				modelId: " qwen3 ",
				reasoningEffort: "medium",
			}),
		).toEqual({
			architect: { providerId: "ollama", modelId: "qwen3", reasoningEffort: "medium" },
			worker: { providerId: "ollama", modelId: "qwen3", reasoningEffort: "medium" },
			reviewer: { providerId: "ollama", modelId: "qwen3", reasoningEffort: "medium" },
		});
	});

	it("preserves configured model roles while filling missing local-model roles", () => {
		expect(
			buildFirstRunLocalModelRoles({
				existingRoles: {
					architect: { providerId: "lmstudio", modelId: "architect-model" },
					worker: { providerId: "", modelId: "" },
					explorer: { providerId: "ollama", modelId: "explorer-model" },
				},
				providerId: "ollama",
				modelId: "qwen3",
			}),
		).toEqual({
			architect: { providerId: "lmstudio", modelId: "architect-model" },
			worker: { providerId: "ollama", modelId: "qwen3" },
			reviewer: { providerId: "ollama", modelId: "qwen3" },
			explorer: { providerId: "ollama", modelId: "explorer-model" },
		});
	});

	it("does not rewrite complete first-run local model roles", () => {
		expect(
			buildFirstRunLocalModelRoles({
				existingRoles: {
					architect: { providerId: "ollama", modelId: "architect-model" },
					worker: { providerId: "ollama", modelId: "worker-model" },
					reviewer: { providerId: "ollama", modelId: "reviewer-model" },
				},
				providerId: "ollama",
				modelId: "qwen3",
			}),
		).toBeNull();
	});

	it("does not seed first-run roles from a non-local provider", () => {
		expect(
			buildFirstRunLocalModelRoles({
				existingRoles: undefined,
				providerId: "openrouter",
				modelId: "cloud-model",
			}),
		).toBeNull();
		expect(
			buildFirstRunLocalModelRoles({
				existingRoles: undefined,
				providerId: "openai-compatible",
				modelId: "local-model",
				baseUrl: "http://192.168.1.20:1234/v1",
			}),
		).toEqual({
			architect: { providerId: "openai-compatible", modelId: "local-model" },
			worker: { providerId: "openai-compatible", modelId: "local-model" },
			reviewer: { providerId: "openai-compatible", modelId: "local-model" },
		});
	});
});
