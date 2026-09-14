import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09-15 (SWE-bench Claude arms): the `openai-compatible` provider resolved its roster from the SDK's STATIC
// placeholder catalog only, never asking the endpoint the user configured — so a model served there but absent from
// the placeholder had no context window and the 32k admission floor refused every session start. Discovery now probes
// the configured endpoint's `/v1/models` and lets its advertised window win.

const listSdkProviderModelsMock = vi.hoisted(() => vi.fn());
const getSdkProviderSettingsMock = vi.hoisted(() => vi.fn());
const listSdkProviderCatalogMock = vi.hoisted(() => vi.fn());
const modelDiscoveryCacheTtlMsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/nklein-agent/sdk-provider-boundary", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/nklein-agent/sdk-provider-boundary")>()),
	listSdkProviderModels: listSdkProviderModelsMock,
	getSdkProviderSettings: getSdkProviderSettingsMock,
	listSdkProviderCatalog: listSdkProviderCatalogMock,
}));

vi.mock("../../../src/core/model-discovery-throttle", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/core/model-discovery-throttle")>()),
	modelDiscoveryCacheTtlMs: modelDiscoveryCacheTtlMsMock,
}));

import {
	clearProviderModelDiscoveryCache,
	loadProviderModelsWithFallback,
} from "../../../src/nklein-agent/nklein-provider-model-discovery";

const ENDPOINT = "http://127.0.0.1:8096/v1";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("loadProviderModelsWithFallback — openai-compatible probes its configured endpoint", () => {
	const fetchMock = vi.fn<typeof globalThis.fetch>();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		clearProviderModelDiscoveryCache();
		modelDiscoveryCacheTtlMsMock.mockReset().mockReturnValue(0);
		listSdkProviderCatalogMock.mockReset().mockResolvedValue([]);
		listSdkProviderModelsMock
			.mockReset()
			.mockResolvedValue([{ id: "gpt-4o", name: "gpt-4o", contextWindow: 128000 }]);
		getSdkProviderSettingsMock
			.mockReset()
			.mockReturnValue({ provider: "openai-compatible", baseUrl: ENDPOINT, model: "claude-sonnet-5-hitl" });
		fetchMock.mockReset();
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("appends the endpoint's own models with their advertised context window", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				object: "list",
				data: [
					{
						id: "claude-sonnet-5-hitl",
						object: "model",
						max_context_length: 200000,
						loaded_context_length: 200000,
					},
				],
			}),
		);

		const models = await loadProviderModelsWithFallback("openai-compatible");

		expect(models.map((model) => model.id)).toEqual(["gpt-4o", "claude-sonnet-5-hitl"]);
		expect(models.find((model) => model.id === "claude-sonnet-5-hitl")?.contextWindow).toBe(200000);
		// Only the generic `/v1/models` route is probed — no LM Studio `/api/v*` 404 noise against a plain endpoint.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${ENDPOINT}/models`);
	});

	it("lets the endpoint's advertised window win over the placeholder catalog's", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ object: "list", data: [{ id: "gpt-4o", object: "model", context_length: 32768 }] }),
		);

		const models = await loadProviderModelsWithFallback("openai-compatible");

		expect(models).toEqual([{ id: "gpt-4o", name: "gpt-4o", contextWindow: 32768 }]);
	});

	it("keeps the placeholder catalog when the endpoint has no roster route", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: "not found" }, 404));

		const models = await loadProviderModelsWithFallback("openai-compatible");

		expect(models.map((model) => model.id)).toEqual(["gpt-4o"]);
	});

	it("does not probe when no base URL is configured", async () => {
		getSdkProviderSettingsMock.mockReturnValue({ provider: "openai-compatible", baseUrl: "", model: "x" });

		await loadProviderModelsWithFallback("openai-compatible");

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
