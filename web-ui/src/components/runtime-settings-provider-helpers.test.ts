import { describe, expect, it } from "vitest";
import {
	findProviderCatalogItem,
	formatProviderOptionLabel,
	normalizeProviderId,
} from "@/components/runtime-settings-provider-helpers";
import type { RuntimeNKleinProviderCatalogItem } from "@/runtime/types";

// The lookup only reads `.id`, so minimal cast items are sufficient test data.
const providers = [{ id: "OpenAI" }, { id: "lmstudio" }] as unknown as RuntimeNKleinProviderCatalogItem[];

describe("normalizeProviderId", () => {
	it("trims and lowercases", () => {
		expect(normalizeProviderId("  LMStudio ")).toBe("lmstudio");
		expect(normalizeProviderId("OpenAI")).toBe("openai");
	});

	it("maps null/undefined/empty to an empty string", () => {
		expect(normalizeProviderId(null)).toBe("");
		expect(normalizeProviderId(undefined)).toBe("");
		expect(normalizeProviderId("   ")).toBe("");
	});
});

describe("findProviderCatalogItem", () => {
	it("matches case-insensitively and tolerant of surrounding whitespace", () => {
		expect(findProviderCatalogItem(providers, "openai")?.id).toBe("OpenAI");
		expect(findProviderCatalogItem(providers, "  LMSTUDIO ")?.id).toBe("lmstudio");
	});

	it("returns null when no provider matches (and for an empty catalog)", () => {
		expect(findProviderCatalogItem(providers, "gemini")).toBeNull();
		expect(findProviderCatalogItem([], "openai")).toBeNull();
	});
});

describe("formatProviderOptionLabel", () => {
	it("shows `name (id)` when the name adds information", () => {
		expect(formatProviderOptionLabel({ id: "lmstudio", name: "LM Studio" })).toBe("LM Studio (lmstudio)");
	});

	it("collapses to just the id when the name is empty or duplicates the id (case-insensitively)", () => {
		expect(formatProviderOptionLabel({ id: "lmstudio", name: "" })).toBe("lmstudio");
		expect(formatProviderOptionLabel({ id: "lmstudio", name: "  " })).toBe("lmstudio");
		expect(formatProviderOptionLabel({ id: "lmstudio", name: "LMStudio" })).toBe("lmstudio");
	});

	it("trims surrounding whitespace on both id and name", () => {
		expect(formatProviderOptionLabel({ id: " openai ", name: " OpenAI Cloud " })).toBe("OpenAI Cloud (openai)");
	});
});
