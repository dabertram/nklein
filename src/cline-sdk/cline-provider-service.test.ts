import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listSdkProviderModelsMock = vi.hoisted(() => vi.fn());
const getSdkProviderSettingsMock = vi.hoisted(() => vi.fn());

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
	getLastUsedSdkProviderSettings: vi.fn(),
	getSdkProviderSettings: getSdkProviderSettingsMock,
	listSdkProviderCatalog: vi.fn(),
	listSdkProviderModels: listSdkProviderModelsMock,
	loginManagedOauthProvider: vi.fn(),
	refreshManagedOauthCredentials: vi.fn(),
	SDK_DEFAULT_MODEL_ID: "default-model",
	SDK_DEFAULT_PROVIDER_ID: "lmstudio",
	saveSdkProviderSettings: vi.fn(),
	startClineDeviceAuth: vi.fn(),
	switchSdkClineAccount: vi.fn(),
	updateSdkCustomProvider: vi.fn(),
}));

import { loadProviderModelsWithFallback } from "./cline-provider-service";

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

	it("keeps SDK context windows and fills missing LM Studio model metadata", async () => {
		listSdkProviderModelsMock.mockResolvedValue([
			{
				id: "model-a",
				name: "Model A",
				contextWindow: null,
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

	it("does not replace an SDK supplied context window", async () => {
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

		expect(models[0]?.contextWindow).toBe(131072);
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
});
