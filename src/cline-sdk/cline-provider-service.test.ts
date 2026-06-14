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
});
