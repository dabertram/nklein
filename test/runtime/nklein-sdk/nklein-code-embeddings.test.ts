import { afterEach, describe, expect, it, vi } from "vitest";
import { createNKleinCodeEmbeddingProvider } from "../../../src/nklein-sdk/nklein-code-embeddings";

describe("nklein code embeddings", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("uses local lexical vectors by default", async () => {
		const provider = createNKleinCodeEmbeddingProvider({});
		const vector = await provider.embed("storage adapter persistence");

		expect(provider.kind).toBe("local_lexical");
		expect(provider.model).toBe("kanban-local-lexical-vector-v1");
		expect(vector.get("storage")).toBeGreaterThan(0);
	});

	it("uses an OpenAI-compatible embedding endpoint when configured", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				data: [{ embedding: [0.1, 0, 0.3] }],
			}),
		})) as unknown as typeof fetch;
		globalThis.fetch = fetchMock;

		const provider = createNKleinCodeEmbeddingProvider({
			KANBAN_CODE_EMBEDDING_PROVIDER: "openai-compatible",
			KANBAN_CODE_EMBEDDING_BASE_URL: "https://embeddings.example/v1/embeddings",
			KANBAN_CODE_EMBEDDING_MODEL: "text-embedding-3-small",
			KANBAN_CODE_EMBEDDING_API_KEY: "secret",
		});
		const vector = await provider.embed("storage adapter persistence");

		expect(provider.kind).toBe("openai_compatible");
		expect(vector.get("dim:0")).toBe(0.1);
		expect(vector.get("dim:2")).toBe(0.3);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://embeddings.example/v1/embeddings",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					authorization: "Bearer secret",
				}),
			}),
		);
	});
});
