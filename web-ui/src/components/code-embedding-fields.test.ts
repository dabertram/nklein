import { describe, expect, it } from "vitest";
import {
	areCodeEmbeddingSettingsEqual,
	buildCodeEmbeddingSettings,
	formatCodeEmbeddingSettings,
	LOCAL_CODE_EMBEDDING_MODEL,
} from "@/components/code-embedding-fields";

describe("buildCodeEmbeddingSettings", () => {
	it("forces the built-in local model + no endpoint for the local_lexical provider (ignores typed fields)", () => {
		expect(buildCodeEmbeddingSettings("local_lexical", "ignored-model", "http://ignored")).toEqual({
			provider: "local_lexical",
			model: LOCAL_CODE_EMBEDDING_MODEL,
			baseUrl: null,
		});
	});

	it("trims model + baseUrl for a remote provider", () => {
		expect(buildCodeEmbeddingSettings("openai_compatible", "  text-embed-3  ", "  http://host/v1  ")).toEqual({
			provider: "openai_compatible",
			model: "text-embed-3",
			baseUrl: "http://host/v1",
		});
	});

	it("maps blank model/baseUrl to null (never persists whitespace)", () => {
		expect(buildCodeEmbeddingSettings("openai_compatible", "   ", "")).toEqual({
			provider: "openai_compatible",
			model: null,
			baseUrl: null,
		});
	});
});

describe("areCodeEmbeddingSettingsEqual", () => {
	const a = { provider: "openai_compatible" as const, model: "m", baseUrl: "http://x" };
	it("true for equal settings, false when any field differs", () => {
		expect(areCodeEmbeddingSettingsEqual(a, { ...a })).toBe(true);
		expect(areCodeEmbeddingSettingsEqual(a, { ...a, model: "other" })).toBe(false);
	});

	it("handles nulls (both null equal; one null not)", () => {
		expect(areCodeEmbeddingSettingsEqual(null, null)).toBe(true);
		expect(areCodeEmbeddingSettingsEqual(a, null)).toBe(false);
		expect(areCodeEmbeddingSettingsEqual(null, a)).toBe(false);
	});
});

describe("formatCodeEmbeddingSettings", () => {
	it("labels the local_lexical fallback", () => {
		expect(
			formatCodeEmbeddingSettings({ provider: "local_lexical", model: LOCAL_CODE_EMBEDDING_MODEL, baseUrl: null }),
		).toBe("Local lexical fallback");
	});

	it("renders `model at baseUrl` for a remote provider, with fallbacks for missing fields", () => {
		expect(
			formatCodeEmbeddingSettings({ provider: "openai_compatible", model: "text-embed", baseUrl: "http://h/v1" }),
		).toBe("text-embed at http://h/v1");
		expect(formatCodeEmbeddingSettings({ provider: "openai_compatible", model: null, baseUrl: null })).toBe(
			"No model at no endpoint",
		);
	});
});
