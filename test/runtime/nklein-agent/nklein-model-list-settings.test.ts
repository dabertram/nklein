import { describe, expect, it, vi } from "vitest";
import { resolveModelListSettings } from "../../../src/nklein-agent/nklein-model-list-settings";
import type { SdkProviderCatalogItem, SdkProviderSettings } from "../../../src/nklein-agent/sdk-provider-boundary";

const catalog = (items: Array<Partial<SdkProviderCatalogItem>>) => () =>
	Promise.resolve(items as SdkProviderCatalogItem[]);

describe("resolveModelListSettings (§5.U extraction)", () => {
	it("returns null for a blank provider id (never touches the catalog)", async () => {
		const listCatalog = vi.fn(catalog([]));
		expect(await resolveModelListSettings("  ", null, listCatalog)).toBeNull();
		expect(listCatalog).not.toHaveBeenCalled();
	});

	it("short-circuits to the caller settings when they already match with a base URL", async () => {
		const listCatalog = vi.fn(catalog([{ id: "litellm", baseUrl: "http://catalog:1" }]));
		const settings = { provider: "LiteLLM", baseUrl: "http://caller:9" } as SdkProviderSettings;
		const result = await resolveModelListSettings("litellm", settings, listCatalog);
		expect(result).toBe(settings); // same reference — no catalog lookup needed
		expect(listCatalog).not.toHaveBeenCalled();
	});

	it("fills the base URL from the catalog, preserving other caller fields", async () => {
		const listCatalog = catalog([{ id: "litellm", baseUrl: "  http://catalog:1234  " }]);
		const settings = { provider: "litellm", apiKey: "sk-1" } as SdkProviderSettings;
		const result = await resolveModelListSettings("litellm", settings, listCatalog);
		expect(result).toMatchObject({ provider: "litellm", baseUrl: "http://catalog:1234", apiKey: "sk-1" });
		expect(result).not.toBe(settings); // a fresh object, not the caller's
	});

	it("synthesizes settings from just the provider id when the caller has none", async () => {
		const listCatalog = catalog([{ id: "lmstudio", baseUrl: "http://lm:4321" }]);
		const result = await resolveModelListSettings("LMStudio", null, listCatalog);
		expect(result).toEqual({ provider: "lmstudio", baseUrl: "http://lm:4321" });
	});

	it("returns the caller settings (unresolved) when the catalog has no base URL but the provider matches", async () => {
		const listCatalog = catalog([{ id: "litellm" }]); // no baseUrl
		const settings = { provider: "litellm" } as SdkProviderSettings;
		expect(await resolveModelListSettings("litellm", settings, listCatalog)).toBe(settings);
	});

	it("returns null when the provider is unknown and the caller settings are for a different provider", async () => {
		const listCatalog = catalog([{ id: "other", baseUrl: "http://x" }]);
		const settings = { provider: "different" } as SdkProviderSettings;
		expect(await resolveModelListSettings("litellm", settings, listCatalog)).toBeNull();
	});

	it("is tolerant of a catalog lister that rejects (treats it as empty)", async () => {
		const listCatalog = () => Promise.reject(new Error("catalog down"));
		const settings = { provider: "litellm" } as SdkProviderSettings;
		expect(await resolveModelListSettings("litellm", settings, listCatalog)).toBe(settings);
	});
});
