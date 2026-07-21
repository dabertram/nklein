import { describe, expect, it, vi } from "vitest";
import {
	createOpenAiCompatibleChatMemoryEmbedder,
	resolveLoadedChatMemoryEmbedder,
} from "../../../src/chat/chat-memory-embedding";

describe("chat-memory embedding", () => {
	it("selects only a resident embedding descriptor and calls the local OpenAI-compatible endpoint", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			if (url.endsWith("/api/v1/models")) {
				return new Response(
					JSON.stringify({
						models: [
							{ key: "chat", type: "llm", loaded_instances: [{ id: "chat-live" }] },
							{ key: "embed", type: "embedding", loaded_instances: [{ id: "embed-live" }] },
						],
					}),
					{ status: 200 },
				);
			}
			expect(url).toBe("http://127.0.0.1:1234/v1/embeddings");
			return new Response(JSON.stringify({ data: [{ embedding: [0.25, 0.75] }] }), { status: 200 });
		});
		const embedder = await resolveLoadedChatMemoryEmbedder({
			baseUrl: "http://127.0.0.1:1234/v1",
			fetchImpl,
		});
		expect(embedder?.modelId).toBe("embed-live");
		expect(await embedder?.embed("query")).toEqual([0.25, 0.75]);
	});

	it("refuses an explicit non-resident embedding id without triggering inference", async () => {
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({
						models: [{ key: "embed", type: "embedding", loaded_instances: [{ id: "resident" }] }],
					}),
					{ status: 200 },
				),
		);
		expect(
			await resolveLoadedChatMemoryEmbedder({
				baseUrl: "http://127.0.0.1:1234/v1",
				preferredModelId: "not-loaded",
				fetchImpl,
			}),
		).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("degrades malformed responses to lexical in production but lets the verifier fail hard", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
		const soft = createOpenAiCompatibleChatMemoryEmbedder({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "embed",
			fetchImpl,
		});
		const strict = createOpenAiCompatibleChatMemoryEmbedder({
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "embed",
			fetchImpl,
			failSoft: false,
		});
		expect(await soft.embed("x")).toBeNull();
		await expect(strict.embed("x")).rejects.toThrow(/no finite vector/);
	});
});
