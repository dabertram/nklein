import { describe, expect, it } from "vitest";
import { assertPinnedChatModelLoaded, discoverLoadedModelId } from "../../../src/chat/local-chat-model";

function jsonResponse(body: unknown, ok = true): Response {
	return { ok, json: async () => body } as unknown as Response;
}

describe("discoverLoadedModelId", () => {
	// LM Studio `/api/v0/models` carries a per-model `state` — only `loaded` (resident) models are eligible; an
	// available-but-unloaded model is NOT picked (selecting it would auto-load it — user directive 2026-06-28).
	it("picks the first non-embedding LOADED model (ignores available-but-unloaded)", async () => {
		const fetchImpl = (async () =>
			jsonResponse({
				data: [
					{ id: "text-embedding-nomic", state: "loaded" },
					{ id: "available-not-loaded", state: "not-loaded" },
					{ id: "qwen/qwen3-8b", state: "loaded" },
					{ id: "qwen2.5-coder", state: "loaded" },
				],
			})) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", fetchImpl)).toBe("qwen/qwen3-8b");
	});

	it("falls back to the first loaded model when all look like embedders, and null on none-loaded/empty/error", async () => {
		const onlyEmbed = (async () =>
			jsonResponse({ data: [{ id: "embed-only", state: "loaded" }] })) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", onlyEmbed)).toBe("embed-only");

		// A model that's available but NOT loaded must yield null (never select it → never load it).
		const noneLoaded = (async () =>
			jsonResponse({ data: [{ id: "qwen/qwen3-8b", state: "not-loaded" }] })) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", noneLoaded)).toBeNull();

		const empty = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", empty)).toBeNull();

		const notOk = (async () => jsonResponse({}, false)) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", notOk)).toBeNull();

		const throws = (async () => {
			throw new Error("connection refused");
		}) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", throws)).toBeNull();
	});
});

describe("assertPinnedChatModelLoaded", () => {
	// A pinned/`--model` id bypasses loaded-only discovery, so it must be residency-checked too — inferring against a
	// non-resident model auto-LOADS it (user directive 2026-06-28). Lenient like the runtime task-start guard.
	it("throws a clear error when the pinned model is positively NOT in the loaded set", async () => {
		const loaded = (async () =>
			jsonResponse({ data: [{ id: "qwen/qwen3-8b", state: "loaded" }] })) as unknown as typeof fetch;
		await expect(
			assertPinnedChatModelLoaded("http://127.0.0.1:1234/v1", "ornith-1.0-35b-mlx@8bit", loaded),
		).rejects.toThrow(/not loaded in LM Studio.*qwen\/qwen3-8b/s);
	});

	it("allows a pinned model that IS loaded", async () => {
		const loaded = (async () =>
			jsonResponse({
				data: [
					{ id: "qwen/qwen3-8b", state: "loaded" },
					{ id: "available-not-loaded", state: "not-loaded" },
				],
			})) as unknown as typeof fetch;
		await expect(
			assertPinnedChatModelLoaded("http://127.0.0.1:1234/v1", "qwen/qwen3-8b", loaded),
		).resolves.toBeUndefined();
	});

	it("is LENIENT — never wedges chat when the loaded set is unknown (empty / unreachable endpoint)", async () => {
		const empty = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
		await expect(
			assertPinnedChatModelLoaded("http://127.0.0.1:1234/v1", "any-model", empty),
		).resolves.toBeUndefined();

		const throws = (async () => {
			throw new Error("connection refused");
		}) as unknown as typeof fetch;
		await expect(
			assertPinnedChatModelLoaded("http://127.0.0.1:1234/v1", "any-model", throws),
		).resolves.toBeUndefined();
	});
});
