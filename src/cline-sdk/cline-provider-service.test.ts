import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listSdkProviderModelsMock = vi.hoisted(() => vi.fn());
const getSdkProviderSettingsMock = vi.hoisted(() => vi.fn());
const getLastUsedSdkProviderSettingsMock = vi.hoisted(() => vi.fn());
const saveSdkProviderSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("./sdk-provider-boundary", () => ({
	addSdkCustomProvider: vi.fn(),
	completeClineDeviceAuth: vi.fn(),
	deleteSdkCustomProvider: vi.fn(),
	fetchSdkClineAccountBalance: vi.fn(),
	fetchSdkClineAccountProfile: vi.fn(),
	fetchSdkClineUserRemoteConfig: vi.fn(),
	fetchSdkFeaturebaseToken: vi.fn(),
	fetchSdkOrganizationBalance: vi.fn(),
	fetchSdkOrgData: vi.fn(),
	getLastUsedSdkProviderSettings: getLastUsedSdkProviderSettingsMock,
	getSdkProviderSettings: getSdkProviderSettingsMock,
	listSdkProviderCatalog: vi.fn(),
	listSdkProviderModels: listSdkProviderModelsMock,
	loginManagedOauthProvider: vi.fn(),
	refreshManagedOauthCredentials: vi.fn(),
	SDK_DEFAULT_MODEL_ID: "default-model",
	SDK_DEFAULT_PROVIDER_ID: "lmstudio",
	saveSdkProviderSettings: saveSdkProviderSettingsMock,
	startClineDeviceAuth: vi.fn(),
	switchSdkClineAccount: vi.fn(),
	updateSdkCustomProvider: vi.fn(),
}));

import type { ClineModelRegistryEntry } from "./cline-model-registry";
import {
	createClineProviderService,
	loadProviderModelsWithFallback,
	mergeProviderModelsWithModelRegistry,
} from "./cline-provider-service";

const providerSelectionPath = join(tmpdir(), "kanban-cline-provider-service-test-selection.json");

function resetProviderSelection(): void {
	rmSync(providerSelectionPath, { force: true });
	vi.stubEnv("KANBAN_CLINE_PROVIDER_SELECTION_PATH", providerSelectionPath);
}

function writeProviderSelection(providerId: string): void {
	mkdirSync(dirname(providerSelectionPath), { recursive: true });
	writeFileSync(providerSelectionPath, `${JSON.stringify({ providerId }, null, 2)}\n`, "utf8");
}

beforeEach(() => {
	resetProviderSelection();
});

afterEach(() => {
	rmSync(providerSelectionPath, { force: true });
	vi.unstubAllEnvs();
});

describe("createClineProviderService provider selection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("ignores SDK last-used cloud settings until Kanban explicitly selects a provider", async () => {
		getLastUsedSdkProviderSettingsMock.mockReturnValue({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});
		const service = createClineProviderService();

		expect(service.getProviderSettingsSummary()).toMatchObject({
			providerId: null,
			modelId: null,
		});
		await expect(service.resolveLaunchConfig()).rejects.toThrow("No native Cline provider is configured");

		writeProviderSelection("cline");
		expect(service.getProviderSettingsSummary()).toMatchObject({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
		});
	});

	it("persists a Kanban-owned provider selection when settings are saved", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "worker-model",
				name: "Worker Model",
				contextWindow: 32_000,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "anthropic",
			model: "worker-model",
		});
		const service = createClineProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "anthropic",
				modelId: "worker-model",
			}),
		).resolves.toMatchObject({
			providerId: "anthropic",
			modelId: "worker-model",
		});

		expect(JSON.parse(readFileSync(providerSelectionPath, "utf8"))).toMatchObject({ providerId: "anthropic" });
		expect(saveSdkProviderSettingsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				settings: expect.objectContaining({ provider: "anthropic", model: "worker-model" }),
				setLastUsed: true,
			}),
		);
	});
});

function createRegistryEntry(input: {
	key: string;
	providerId: string;
	modelId: string;
	contextWindow: number | null;
}): ClineModelRegistryEntry {
	return {
		key: input.key,
		providerId: input.providerId,
		modelId: input.modelId,
		endpoint: null,
		contextWindow: {
			advertised: null,
			observed: input.contextWindow,
			userOverride: null,
			effective: input.contextWindow,
		},
		speed: {
			samples: 0,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: null,
			decodeTokensPerSecondEwma: null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 0,
			staticPrior: 35,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: 35,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: null,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("loadProviderModelsWithFallback", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "lmstudio",
			baseUrl: "http://localhost:1234",
			timeout: 1000,
		} as never);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("keeps only live LM Studio models and fills missing metadata from the SDK catalog", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "model-a",
				name: "Model A",
				contextWindow: null,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
			{
				id: "unloaded-model",
				name: "Unloaded Model",
				contextWindow: 262144,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				object: "list",
				data: [
					{
						id: "model-a",
						name: "Model A",
						max_context_length: 256000,
					},
				],
			}),
		})) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models).toHaveLength(1);
		expect(models[0]?.id).toBe("model-a");
		expect(models[0]?.name).toBe("Model A");
		expect(models[0]?.contextWindow).toBe(256000);
	});

	it("prefers the currently loaded LM Studio context window over SDK catalog metadata", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "model-b",
				name: "Model B",
				contextWindow: 131072,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				object: "list",
				data: [
					{
						id: "model-b",
						name: "Model B",
						max_context_length: 256000,
					},
				],
			}),
		})) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models[0]?.contextWindow).toBe(256000);
	});

	it("loads LM Studio metadata when the SDK model list is empty", async () => {
		listSdkProviderModelsMock.mockResolvedValue([]);
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				object: "list",
				data: [
					{
						id: "qwen/qwen3.5-9b-legion5pro",
						name: "Qwen3.5 9B",
						max_context_length: 262144,
					},
				],
			}),
		})) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models).toEqual([
			{
				id: "qwen/qwen3.5-9b-legion5pro",
				name: "Qwen3.5 9B",
				contextWindow: 262144,
			},
		]);
	});

	it("prefers LM Studio loaded context length over the model maximum", async () => {
		listSdkProviderModelsMock.mockResolvedValue([]);
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				object: "list",
				data: [
					{
						id: "qwen/qwen3.5-9b-mtp-m1",
						name: "Qwen3.5 9B MTP",
						loaded_context_length: 80_000,
						max_context_length: 262_144,
					},
				],
			}),
		})) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models).toEqual([
			{
				id: "qwen/qwen3.5-9b-mtp-m1",
				name: "Qwen3.5 9B MTP",
				contextWindow: 80_000,
			},
		]);
	});

	it("discovers LM Studio metadata from the server root when the configured base URL ends with v1", async () => {
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "lmstudio",
			baseUrl: "http://linked-host.local:1234/v1",
			timeout: 1000,
		} as never);
		listSdkProviderModelsMock.mockResolvedValue([]);
		globalThis.fetch = vi.fn(async (input) => {
			if (input.toString() !== "http://linked-host.local:1234/api/v0/models") {
				throw new Error(`unexpected metadata URL: ${input.toString()}`);
			}
			return {
				ok: true,
				json: async () => ({
					data: [
						{
							id: "qwen/qwen3.5-9b-mtp-m1",
							name: "Qwen3.5 9B MTP",
							max_context_length: 262144,
						},
					],
				}),
			};
		}) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models).toEqual([
			{
				id: "qwen/qwen3.5-9b-mtp-m1",
				name: "Qwen3.5 9B MTP",
				contextWindow: 262144,
			},
		]);
		expect(globalThis.fetch).toHaveBeenCalledWith("http://linked-host.local:1234/api/v0/models", expect.any(Object));
	});

	it("uses LM Studio v1 loaded instance context windows", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "qwen/qwen3.5-9b-legion5pro",
				name: "Qwen3.5 9B",
				contextWindow: null,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		globalThis.fetch = vi.fn(async (input) => {
			if (input.toString().endsWith("/api/v0/models")) {
				return {
					ok: true,
					json: async () => ({ data: [] }),
				};
			}
			return {
				ok: true,
				json: async () => ({
					models: [
						{
							key: "qwen/qwen3.5-9b",
							display_name: "Qwen3.5 9B",
							max_context_length: 262144,
							loaded_instances: [
								{
									id: "qwen/qwen3.5-9b-legion5pro",
									config: {
										context_length: 262144,
									},
								},
							],
						},
					],
				}),
			};
		}) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models[0]?.id).toBe("qwen/qwen3.5-9b-legion5pro");
		expect(models[0]?.contextWindow).toBe(262144);
	});

	it("uses LM Studio v1 loaded instance active context over the model maximum", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "qwen/qwen3.5-9b-mtp-m1",
				name: "Qwen3.5 9B MTP",
				contextWindow: null,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		globalThis.fetch = vi.fn(async (input) => {
			if (input.toString().endsWith("/api/v0/models")) {
				return {
					ok: true,
					json: async () => ({ data: [] }),
				};
			}
			return {
				ok: true,
				json: async () => ({
					models: [
						{
							key: "qwen/qwen3.5-9b",
							display_name: "Qwen3.5 9B MTP",
							max_context_length: 262_144,
							loaded_instances: [
								{
									id: "qwen/qwen3.5-9b-mtp-m1",
									config: {
										loaded_context_length: 80_000,
										context_length: 262_144,
									},
								},
							],
						},
					],
				}),
			};
		}) as unknown as typeof globalThis.fetch;

		const models = await loadProviderModelsWithFallback("lmstudio");

		expect(models[0]?.id).toBe("qwen/qwen3.5-9b-mtp-m1");
		expect(models[0]?.contextWindow).toBe(80_000);
	});

	it("overrides provider context windows with measured model registry windows", () => {
		const models = mergeProviderModelsWithModelRegistry(
			"ollama",
			[
				{ id: "qwen", name: "Qwen", contextWindow: 32_000 },
				{ id: "other", name: "Other", contextWindow: 16_000 },
			],
			[
				createRegistryEntry({
					key: "ollama:qwen:default",
					providerId: "ollama",
					modelId: "qwen",
					contextWindow: 8_000,
				}),
				createRegistryEntry({
					key: "lmstudio:other:default",
					providerId: "lmstudio",
					modelId: "other",
					contextWindow: 128_000,
				}),
			],
		);

		expect(models[0]?.contextWindow).toBe(8_000);
		expect(models[1]?.contextWindow).toBe(16_000);
	});

	it("rejects saving an active model below the Kanban minimum context window", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "small-model",
				name: "Small Model",
				contextWindow: 16_000,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "anthropic",
			model: "small-model",
		} as never);
		const service = createClineProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "anthropic",
				modelId: "small-model",
			}),
		).rejects.toThrow("requires at least 32,000");
	});

	it("rejects saving an LM Studio model that is not currently loaded", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "configured-but-unloaded",
				name: "Configured But Unloaded",
				contextWindow: 262_144,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "lmstudio",
			model: "configured-but-unloaded",
			baseUrl: "http://localhost:1234",
			timeout: 1000,
		} as never);
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ data: [] }),
		})) as unknown as typeof globalThis.fetch;
		const service = createClineProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "lmstudio",
				modelId: "configured-but-unloaded",
				baseUrl: "http://localhost:1234",
			}),
		).rejects.toThrow("is not currently loaded");
	});

	it("allows saving an active model at the Kanban minimum context window", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "worker-model",
				name: "Worker Model",
				contextWindow: 32_000,
				supportsVision: false,
				supportsAttachments: false,
				supportsReasoningEffort: false,
			},
		]);
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "anthropic",
			model: "worker-model",
		} as never);
		const service = createClineProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "anthropic",
				modelId: "worker-model",
			}),
		).resolves.toMatchObject({
			providerId: "anthropic",
			modelId: "worker-model",
		});
	});
});
