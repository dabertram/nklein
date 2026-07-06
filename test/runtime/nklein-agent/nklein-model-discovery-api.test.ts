import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK provider store; keep toRuntimeProviderModel as identity (its own module is separately tested). The
// local-only policy + provider-id classification are REAL so the catalog's cloud filtering + discover fail-closed
// gate are exercised, not stubbed.
const sdk = vi.hoisted(() => ({
	listSdkProviderCatalog: vi.fn(async () => [] as Array<Record<string, unknown>>),
	getSdkProviderSettings: vi.fn((_id: string) => undefined as { baseUrl?: string; model?: string } | undefined),
}));
vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => sdk);
vi.mock("../../../src/nklein-agent/nklein-provider-model-parsing", () => ({
	toRuntimeProviderModel: (m: unknown) => m,
}));

import {
	createModelDiscoveryApi,
	type ModelDiscoveryApiDeps,
} from "../../../src/nklein-agent/nklein-model-discovery-api";

function deps(over: Partial<ModelDiscoveryApiDeps> = {}): ModelDiscoveryApiDeps {
	return {
		getProviderSettingsSummary: () => ({ providerId: "lmstudio", modelId: null, baseUrl: null }) as never,
		loadProviderModelsWithMeasuredWindows: vi.fn(async () => []),
		discoverModelsFromEndpoint: vi.fn(async () => ({ modelSourceUrl: "http://localhost/models", models: [] })),
		...over,
	};
}

beforeEach(() => vi.clearAllMocks());

describe("createModelDiscoveryApi — getProviderCatalog", () => {
	it("filters out cloud providers, floats LM Studio to the top, and flags the selected one enabled", async () => {
		sdk.listSdkProviderCatalog.mockResolvedValueOnce([
			{ id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai", capabilities: ["oauth"] },
			{ id: "custom-a", name: "Alpha", baseUrl: "http://localhost:5000" },
			{ id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234" },
		]);
		const { providers } = await createModelDiscoveryApi(deps()).getProviderCatalog();

		expect(providers.map((p) => p.id)).toEqual(["lmstudio", "custom-a"]); // openrouter (cloud) dropped; lmstudio first
		expect(providers.find((p) => p.id === "lmstudio")?.enabled).toBe(true); // selected
		expect(providers.find((p) => p.id === "custom-a")?.enabled).toBe(false);
	});

	it("ensures the selected local provider appears even when the catalog omits it", async () => {
		sdk.listSdkProviderCatalog.mockResolvedValueOnce([]);
		sdk.getSdkProviderSettings.mockReturnValue({ baseUrl: "http://localhost:1234" });
		const { providers } = await createModelDiscoveryApi(
			deps({ getProviderSettingsSummary: () => ({ providerId: "ollama", modelId: "m", baseUrl: "x" }) as never }),
		).getProviderCatalog();

		expect(providers).toHaveLength(1);
		expect(providers[0]).toMatchObject({ id: "ollama", enabled: true });
	});
});

describe("createModelDiscoveryApi — getProviderModels", () => {
	it("returns no models for a cloud provider (never loads them)", async () => {
		sdk.getSdkProviderSettings.mockReturnValue({ baseUrl: "https://openrouter.ai" });
		const load = vi.fn(async () => []);
		const res = await createModelDiscoveryApi(
			deps({ loadProviderModelsWithMeasuredWindows: load }),
		).getProviderModels("openrouter");
		expect(res.models).toEqual([]);
		expect(load).not.toHaveBeenCalled();
	});

	it("loads + name-sorts models for a local provider", async () => {
		sdk.getSdkProviderSettings.mockReturnValue({ baseUrl: "http://localhost:1234" });
		const load = vi.fn(async () => [
			{ id: "b", name: "Beta" },
			{ id: "a", name: "Alpha" },
		]);
		const res = await createModelDiscoveryApi(
			deps({ loadProviderModelsWithMeasuredWindows: load as never }),
		).getProviderModels("custom-a");
		expect(res.models.map((m) => m.name)).toEqual(["Alpha", "Beta"]);
	});

	it("falls back to the configured model when discovery yields nothing (non-live-only)", async () => {
		sdk.getSdkProviderSettings.mockReturnValue({ baseUrl: "http://localhost:1234", model: "my-model" });
		const res = await createModelDiscoveryApi(deps()).getProviderModels("custom-a");
		expect(res.models).toEqual([{ id: "my-model", name: "my-model" }]);
	});
});

describe("createModelDiscoveryApi — discoverEndpointModels", () => {
	it("delegates to the endpoint discovery for a local base URL", async () => {
		const discover = vi.fn(async () => ({ modelSourceUrl: "http://localhost:1234/models", models: [] }));
		await createModelDiscoveryApi(deps({ discoverModelsFromEndpoint: discover })).discoverEndpointModels({
			baseUrl: "http://localhost:1234",
		});
		expect(discover).toHaveBeenCalled();
	});

	it("FAILS CLOSED on a non-local base URL — the local-only gate throws before discovery", async () => {
		const discover = vi.fn(async () => ({ modelSourceUrl: "", models: [] }));
		await expect(
			createModelDiscoveryApi(deps({ discoverModelsFromEndpoint: discover })).discoverEndpointModels({
				baseUrl: "https://api.openai.com",
			}),
		).rejects.toThrow();
		expect(discover).not.toHaveBeenCalled();
	});
});
