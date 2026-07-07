import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// §5.V coverage for the provider model-discovery TTL cache (loadProviderModelsWithFallback). Cache correctness is subtle
// — a hit must skip the underlying provider fetch, a miss after TTL must refetch, TTL<=0 must disable caching, an explicit
// clear must force a refetch, and distinct providers must not collide. A non-litellm/lmstudio provider ("openai") resolves
// straight from listSdkProviderModels, so only two modules need overriding (importOriginal keeps their other exports).

const listSdkProviderModelsMock = vi.hoisted(() => vi.fn());
const getSdkProviderSettingsMock = vi.hoisted(() => vi.fn());
const modelDiscoveryCacheTtlMsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/nklein-agent/sdk-provider-boundary", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/nklein-agent/sdk-provider-boundary")>()),
	listSdkProviderModels: listSdkProviderModelsMock,
	getSdkProviderSettings: getSdkProviderSettingsMock,
}));

vi.mock("../../../src/core/model-discovery-throttle", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/core/model-discovery-throttle")>()),
	modelDiscoveryCacheTtlMs: modelDiscoveryCacheTtlMsMock,
}));

import {
	clearProviderModelDiscoveryCache,
	loadProviderModelsWithFallback,
} from "../../../src/nklein-agent/nklein-provider-model-discovery";

describe("loadProviderModelsWithFallback — TTL cache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		clearProviderModelDiscoveryCache();
		listSdkProviderModelsMock.mockReset().mockResolvedValue([{ id: "m1" }]);
		getSdkProviderSettingsMock.mockReset().mockReturnValue({ baseUrl: "http://endpoint" });
		modelDiscoveryCacheTtlMsMock.mockReset().mockReturnValue(30_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("serves a second call within the TTL from cache without refetching", async () => {
		const first = await loadProviderModelsWithFallback("openai");
		const second = await loadProviderModelsWithFallback("openai");

		expect(first.map((m) => m.id)).toEqual(["m1"]);
		expect(second.map((m) => m.id)).toEqual(["m1"]);
		expect(listSdkProviderModelsMock).toHaveBeenCalledTimes(1);
	});

	it("refetches once the TTL has elapsed", async () => {
		await loadProviderModelsWithFallback("openai");
		vi.setSystemTime(new Date("2026-01-01T00:00:31Z")); // 31s > 30s TTL
		await loadProviderModelsWithFallback("openai");

		expect(listSdkProviderModelsMock).toHaveBeenCalledTimes(2);
	});

	it("disables caching when the TTL is zero", async () => {
		modelDiscoveryCacheTtlMsMock.mockReturnValue(0);
		await loadProviderModelsWithFallback("openai");
		await loadProviderModelsWithFallback("openai");

		expect(listSdkProviderModelsMock).toHaveBeenCalledTimes(2);
	});

	it("refetches after the cache is explicitly cleared", async () => {
		await loadProviderModelsWithFallback("openai");
		clearProviderModelDiscoveryCache();
		await loadProviderModelsWithFallback("openai");

		expect(listSdkProviderModelsMock).toHaveBeenCalledTimes(2);
	});

	it("keys the cache per provider so distinct providers do not collide", async () => {
		await loadProviderModelsWithFallback("openai");
		await loadProviderModelsWithFallback("anthropic");

		expect(listSdkProviderModelsMock).toHaveBeenCalledTimes(2);
		expect(listSdkProviderModelsMock).toHaveBeenNthCalledWith(1, "openai");
		expect(listSdkProviderModelsMock).toHaveBeenNthCalledWith(2, "anthropic");
	});
});
