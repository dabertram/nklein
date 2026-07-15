import { afterEach, describe, expect, it } from "vitest";
import {
	assertPinnedChatModelLoaded,
	clearLoadedModelIdCache,
	discoverLoadedModelId,
} from "../../../src/chat/local-chat-model";

/** A fetch stub whose /api/v0/models response carries the given loaded model entries. */
function fakeFetch(loadedIds: string[], ok = true): typeof fetch {
	const payload = { data: loadedIds.map((id) => ({ id, state: "loaded" as const })) };
	return (async () => ({ ok, json: async () => payload })) as unknown as typeof fetch;
}

afterEach(() => clearLoadedModelIdCache());

describe("discoverLoadedModelId (loaded-only, never auto-loads)", () => {
	it("prefers the first non-embedding loaded model", async () => {
		const id = await discoverLoadedModelId("http://localhost:1234", fakeFetch(["nomic-embed-text", "qwen-coder"]));
		expect(id).toBe("qwen-coder");
	});

	it("falls back to the first loaded model when all are embeddings", async () => {
		const id = await discoverLoadedModelId("http://localhost:1234", fakeFetch(["nomic-embed-text"]));
		expect(id).toBe("nomic-embed-text");
	});

	it("returns null when nothing is loaded or the endpoint errors", async () => {
		expect(await discoverLoadedModelId("http://localhost:1234", fakeFetch([]))).toBeNull();
		expect(await discoverLoadedModelId("http://localhost:1234", fakeFetch(["x"], false))).toBeNull();
	});
});

describe("assertPinnedChatModelLoaded (residency guard, lenient on unknown)", () => {
	it("passes when the pinned model is loaded", async () => {
		await expect(
			assertPinnedChatModelLoaded("http://x", "qwen-coder", fakeFetch(["qwen-coder"])),
		).resolves.toBeUndefined();
	});

	it("throws when the loaded set is known and lacks the pinned model", async () => {
		await expect(assertPinnedChatModelLoaded("http://x", "missing", fakeFetch(["qwen-coder"]))).rejects.toThrow(
			/not loaded/,
		);
	});

	it("does NOT wedge on an unknown loaded set (unreachable endpoint → no block)", async () => {
		await expect(assertPinnedChatModelLoaded("http://x", "anything", fakeFetch([], false))).resolves.toBeUndefined();
	});
});
