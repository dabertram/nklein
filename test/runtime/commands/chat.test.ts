import { describe, expect, it } from "vitest";
import { discoverLoadedModelId } from "../../../src/chat/local-chat-model";

function jsonResponse(body: unknown, ok = true): Response {
	return { ok, json: async () => body } as unknown as Response;
}

describe("discoverLoadedModelId", () => {
	it("picks the first non-embedding loaded model", async () => {
		const fetchImpl = (async () =>
			jsonResponse({
				data: [{ id: "text-embedding-nomic" }, { id: "qwen/qwen3-8b" }, { id: "qwen2.5-coder" }],
			})) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", fetchImpl)).toBe("qwen/qwen3-8b");
	});

	it("falls back to the first model when all look like embedders, and null on empty/error", async () => {
		const onlyEmbed = (async () => jsonResponse({ data: [{ id: "embed-only" }] })) as unknown as typeof fetch;
		expect(await discoverLoadedModelId("http://127.0.0.1:1234/v1", onlyEmbed)).toBe("embed-only");

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
