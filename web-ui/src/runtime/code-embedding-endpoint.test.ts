import { describe, expect, it } from "vitest";

import {
	buildSuggestedCodeEmbeddingBaseUrl,
	deriveEmbeddingsEndpointUrl,
	isLocalEmbeddingEndpointUrl,
} from "@/runtime/code-embedding-endpoint";

describe("code embedding endpoint helpers", () => {
	it("derives embeddings endpoints from LM Studio provider bases", () => {
		expect(deriveEmbeddingsEndpointUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1/embeddings");
		expect(deriveEmbeddingsEndpointUrl("http://127.0.0.1:1234/v1/embeddings")).toBe(
			"http://127.0.0.1:1234/v1/embeddings",
		);
	});

	it("recognizes only local endpoint URLs for automatic discovery", () => {
		expect(isLocalEmbeddingEndpointUrl("http://localhost:1234/v1/embeddings")).toBe(true);
		expect(isLocalEmbeddingEndpointUrl("http://model-host.local:1234/v1/embeddings")).toBe(true);
		expect(isLocalEmbeddingEndpointUrl("http://192.168.1.10:1234/v1/embeddings")).toBe(true);
		expect(isLocalEmbeddingEndpointUrl("https://example.com/v1/embeddings")).toBe(false);
		expect(isLocalEmbeddingEndpointUrl("not a url")).toBe(false);
	});

	it("prefills from the selected local LM Studio provider catalog entry", () => {
		expect(
			buildSuggestedCodeEmbeddingBaseUrl({
				providerId: "lmstudio",
				baseUrl: "",
				providerCatalog: [
					{
						id: "lmstudio",
						name: "LM Studio",
						oauthSupported: false,
						enabled: true,
						defaultModelId: "qwen",
						baseUrl: "http://127.0.0.1:1234/v1",
						supportsBaseUrl: true,
					},
				],
			}),
		).toBe("http://127.0.0.1:1234/v1/embeddings");
	});

	it("does not prefill for non-LM-Studio or non-local providers", () => {
		expect(
			buildSuggestedCodeEmbeddingBaseUrl({
				providerId: "ollama",
				baseUrl: "http://127.0.0.1:11434/v1",
				providerCatalog: [],
			}),
		).toBe(null);
		expect(
			buildSuggestedCodeEmbeddingBaseUrl({
				providerId: "lmstudio",
				baseUrl: "https://example.com/v1",
				providerCatalog: [],
			}),
		).toBe(null);
	});
});
