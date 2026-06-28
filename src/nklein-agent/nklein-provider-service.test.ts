import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listSdkProviderModelsMock = vi.hoisted(() => vi.fn());
const listSdkProviderCatalogMock = vi.hoisted(() => vi.fn());
const getSdkProviderSettingsMock = vi.hoisted(() => vi.fn());
const getLastUsedSdkProviderSettingsMock = vi.hoisted(() => vi.fn());
const saveSdkProviderSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("./sdk-provider-boundary", () => ({
	addSdkCustomProvider: vi.fn(),
	completeNKleinDeviceAuth: vi.fn(),
	deleteSdkCustomProvider: vi.fn(),
	fetchSdkNKleinAccountBalance: vi.fn(),
	fetchSdkNKleinAccountProfile: vi.fn(),
	fetchSdkNKleinUserRemoteConfig: vi.fn(),
	fetchSdkFeaturebaseToken: vi.fn(),
	fetchSdkOrganizationBalance: vi.fn(),
	fetchSdkOrgData: vi.fn(),
	getLastUsedSdkProviderSettings: getLastUsedSdkProviderSettingsMock,
	getSdkProviderSettings: getSdkProviderSettingsMock,
	listSdkProviderCatalog: listSdkProviderCatalogMock,
	listSdkProviderModels: listSdkProviderModelsMock,
	loginManagedOauthProvider: vi.fn(),
	refreshManagedOauthCredentials: vi.fn(),
	SDK_DEFAULT_MODEL_ID: "default-model",
	SDK_DEFAULT_PROVIDER_ID: "lmstudio",
	saveSdkProviderSettings: saveSdkProviderSettingsMock,
	startNKleinDeviceAuth: vi.fn(),
	switchSdkNKleinAccount: vi.fn(),
	updateSdkCustomProvider: vi.fn(),
}));

import type { NKleinModelRegistryEntry } from "./nklein-model-registry";
import { mergeProviderModelsWithModelRegistry } from "./nklein-provider-model-parsing";
import {
	clearProviderModelDiscoveryCache,
	createNKleinProviderService,
	loadProviderModelsWithFallback,
} from "./nklein-provider-service";

const providerSelectionPath = join(tmpdir(), "kanban-nklein-provider-service-test-selection.json");

function resetProviderSelection(): void {
	rmSync(providerSelectionPath, { force: true });
	vi.stubEnv("KANBAN_NKLEIN_PROVIDER_SELECTION_PATH", providerSelectionPath);
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

describe("createNKleinProviderService provider selection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listSdkProviderCatalogMock.mockResolvedValue([]);
	});

	it("ignores SDK last-used cloud settings until !Klein explicitly selects a provider", async () => {
		getLastUsedSdkProviderSettingsMock.mockReturnValue({
			provider: "nklein",
			model: "anthropic/claude-sonnet-4.6",
		});
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "nklein",
			model: "anthropic/claude-sonnet-4.6",
		});
		const service = createNKleinProviderService();

		expect(service.getProviderSettingsSummary()).toMatchObject({
			providerId: null,
			modelId: null,
		});
		await expect(service.resolveLaunchConfig()).rejects.toThrow("No native !Klein provider is configured");

		writeProviderSelection("nklein");
		expect(service.getProviderSettingsSummary()).toMatchObject({
			providerId: null,
			modelId: null,
		});
	});

	it("persists a !Klein-owned local provider selection when settings are saved", async () => {
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
			provider: "ollama",
			model: "worker-model",
		});
		const service = createNKleinProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "ollama",
				modelId: "worker-model",
			}),
		).resolves.toMatchObject({
			providerId: "ollama",
			modelId: "worker-model",
		});

		expect(JSON.parse(readFileSync(providerSelectionPath, "utf8"))).toMatchObject({ providerId: "ollama" });
		expect(saveSdkProviderSettingsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				settings: expect.objectContaining({ provider: "ollama", model: "worker-model" }),
				setLastUsed: true,
			}),
		);
	});

	it("does not expose stale catalog defaults for live-only LM Studio selection", async () => {
		listSdkProviderCatalogMock.mockResolvedValue([
			{
				id: "lmstudio",
				name: "LM Studio",
				capabilities: [],
				defaultModelId: "openai/gpt-oss-20b",
				baseUrl: "http://localhost:1234/v1",
				env: ["LMSTUDIO_API_KEY"],
			},
		]);
		writeProviderSelection("lmstudio");
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "lmstudio",
			model: "openai/gpt-oss-20b",
			baseUrl: "http://localhost:1234/v1",
		});
		const service = createNKleinProviderService();

		await expect(service.getProviderCatalog()).resolves.toMatchObject({
			providers: [
				{
					id: "lmstudio",
					defaultModelId: null,
					baseUrl: "http://localhost:1234/v1",
				},
			],
		});
	});

	it("rejects cloud provider settings before persisting them", async () => {
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "anthropic",
			model: "worker-model",
		});
		const service = createNKleinProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "anthropic",
				modelId: "worker-model",
			}),
		).rejects.toThrow("Cloud models are disabled");
		expect(saveSdkProviderSettingsMock).not.toHaveBeenCalled();
		expect(() => readFileSync(providerSelectionPath, "utf8")).toThrow();
	});

	it("omits cloud providers from the catalog and does not re-add a cloud selection", async () => {
		writeProviderSelection("openrouter");
		listSdkProviderCatalogMock.mockResolvedValue([
			{ id: "nklein", name: "!Klein", defaultModelId: "anthropic/claude-sonnet-4.6" },
			{ id: "openrouter", name: "OpenRouter", defaultModelId: "anthropic/claude-sonnet-4.6" },
			{ id: "ollama", name: "Ollama" },
			{ id: "lmstudio", name: "LM Studio" },
		]);
		getSdkProviderSettingsMock.mockImplementation((providerId: string) => ({
			provider: providerId,
			model: providerId === "openrouter" ? "anthropic/claude-sonnet-4.6" : undefined,
		}));
		const service = createNKleinProviderService();

		await expect(service.getProviderCatalog()).resolves.toMatchObject({
			providers: [expect.objectContaining({ id: "lmstudio" }), expect.objectContaining({ id: "ollama" })],
		});
		const catalog = await service.getProviderCatalog();
		expect(catalog.providers.map((provider) => provider.id)).not.toContain("nklein");
		expect(catalog.providers.map((provider) => provider.id)).not.toContain("openrouter");
	});
});

function createRegistryEntry(input: {
	key: string;
	providerId: string;
	modelId: string;
	contextWindow: number | null;
}): NKleinModelRegistryEntry {
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
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("loadProviderModelsWithFallback", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
		clearProviderModelDiscoveryCache();
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

	it("throttles roster discovery with a TTL cache — no /models re-hit within TTL; refetches after clear", async () => {
		// The cache is disabled by default under the test runner; opt in for this test, then restore.
		const priorTtl = process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "30000";
		try {
			await runTtlCacheAssertions();
		} finally {
			if (priorTtl === undefined) {
				delete process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
			} else {
				process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = priorTtl;
			}
		}
	});

	async function runTtlCacheAssertions(): Promise<void> {
		clearProviderModelDiscoveryCache();
		listSdkProviderModelsMock.mockResolvedValue([]);
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ object: "list", data: [{ id: "model-c", name: "Model C", max_context_length: 4096 }] }),
		})) as unknown as typeof globalThis.fetch;
		globalThis.fetch = fetchMock;
		const calls = () => (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

		const first = await loadProviderModelsWithFallback("lmstudio");
		const afterFirst = calls();
		expect(afterFirst).toBeGreaterThan(0);

		// Within the TTL → served from cache, the live /models catalog is NOT hit again.
		const second = await loadProviderModelsWithFallback("lmstudio");
		expect(calls()).toBe(afterFirst);
		expect(second).toEqual(first);

		// Explicit clear → the next call re-discovers.
		clearProviderModelDiscoveryCache();
		await loadProviderModelsWithFallback("lmstudio");
		expect(calls()).toBeGreaterThan(afterFirst);
	}

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

	it("sorts discovered LM Studio embedding models before other model types", async () => {
		globalThis.fetch = vi.fn(async (input) => {
			if (!input.toString().endsWith("/api/v0/models")) {
				return {
					ok: false,
					json: async () => ({}),
				};
			}
			return {
				ok: true,
				json: async () => ({
					data: [
						{ id: "qwen-chat", name: "Qwen Chat", type: "llm" },
						{ id: "bge-large", name: "BGE Large", type: "embeddings" },
						{ id: "all-minilm", name: "All MiniLM", type: "embeddings" },
					],
				}),
			};
		}) as unknown as typeof globalThis.fetch;
		const service = createNKleinProviderService();

		const response = await service.discoverEndpointModels({
			baseUrl: "http://localhost:1234/v1/embeddings",
		});

		expect(response.modelSourceUrl).toBe("http://localhost:1234/api/v0/models");
		expect(response.models.map((model) => `${model.id}:${model.type ?? "unknown"}`)).toEqual([
			"all-minilm:embeddings",
			"bge-large:embeddings",
			"qwen-chat:llm",
		]);
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

	it("rejects saving an active model below the !Klein minimum context window", async () => {
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
			provider: "ollama",
			model: "small-model",
		} as never);
		const service = createNKleinProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "ollama",
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
		const service = createNKleinProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "lmstudio",
				modelId: "configured-but-unloaded",
				baseUrl: "http://localhost:1234",
			}),
		).rejects.toThrow("is not currently loaded");
	});

	it("discovers loaded LM Studio models from the catalog base URL when settings omit a base URL", async () => {
		listSdkProviderCatalogMock.mockResolvedValue([
			{
				id: "lmstudio",
				name: "LM Studio",
				capabilities: [],
				defaultModelId: "openai/gpt-oss-20b",
				baseUrl: "http://localhost:1234/v1",
			},
		]);
		listSdkProviderModelsMock.mockResolvedValue([]);
		getSdkProviderSettingsMock.mockReturnValue({
			provider: "lmstudio",
		});
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [
					{
						id: "lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx",
						loaded_context_length: 40_000,
					},
				],
			}),
		})) as unknown as typeof globalThis.fetch;

		await expect(loadProviderModelsWithFallback("lmstudio")).resolves.toEqual([
			{
				id: "lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx",
				name: "lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx",
				contextWindow: 40_000,
			},
		]);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:1234/api/v0/models",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("allows saving an active model at the !Klein minimum context window", async () => {
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
			provider: "ollama",
			model: "worker-model",
		} as never);
		const service = createNKleinProviderService();

		await expect(
			service.saveProviderSettings({
				providerId: "ollama",
				modelId: "worker-model",
			}),
		).resolves.toMatchObject({
			providerId: "ollama",
			modelId: "worker-model",
		});
	});
});
