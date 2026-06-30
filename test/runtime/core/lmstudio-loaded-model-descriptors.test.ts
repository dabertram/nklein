import { describe, expect, it } from "vitest";
import {
	fetchLoadedModelDescriptors,
	lmStudioApiV1ModelsUrl,
	parseLoadedModelDescriptors,
} from "../../../src/core/lmstudio-loaded-model-descriptors";

// Shaped after a real LM Studio /api/v1/models payload (loaded + not-loaded entries mixed).
// NOTE: the native /api/v1/models envelope wraps the list in `models` (NOT `data` — that's /api/v0); verified live.
const PAYLOAD = {
	models: [
		// LOADED, ALIASED: runtime id (the user's per-machine alias) differs from the real publisher key.
		{
			type: "llm",
			key: "qwen3.5-9b-mtp",
			architecture: "qwen35",
			capabilities: { vision: false, trained_for_tool_use: true },
			max_context_length: 262144,
			loaded_instances: [{ id: "qwen3.5-9b-mtp-q4-k-xl-legion5pro", config: { context_length: 40000 } }],
		},
		// LOADED reasoner: a declared `reasoning` capability ⇒ reasoning=true.
		{
			type: "llm",
			key: "qwen/qwen3.6-27b",
			architecture: "qwen3_5",
			capabilities: { trained_for_tool_use: true, reasoning: { allowed_options: ["off", "on"], default: "on" } },
			max_context_length: 262144,
			loaded_instances: [{ id: "qwen/qwen3.6-27b" }],
		},
		// LOADED embedding ⇒ isEmbedding=true (authoritative from `type`).
		{
			type: "embedding",
			key: "text-embedding-nomic-embed-text-v1.5@q8_0",
			max_context_length: 2048,
			loaded_instances: [{ id: "text-embedding-nomic-embed-text-v1.5@q8_0-m4mini" }],
		},
		// NOT loaded (no instances) ⇒ skipped.
		{ type: "llm", key: "qwen/qwen3-8b", capabilities: { trained_for_tool_use: true }, loaded_instances: [] },
	],
};

describe("parseLoadedModelDescriptors", () => {
	it("separates the runtime alias (id) from the real model key", () => {
		const descriptors = parseLoadedModelDescriptors(PAYLOAD);
		const legion = descriptors.find((d) => d.runtimeId === "qwen3.5-9b-mtp-q4-k-xl-legion5pro");
		expect(legion).toMatchObject({
			runtimeId: "qwen3.5-9b-mtp-q4-k-xl-legion5pro",
			modelKey: "qwen3.5-9b-mtp", // the REAL name to match against the catalog/llmfit
			isEmbedding: false,
			toolUse: true,
			architecture: "qwen35",
		});
	});

	it("flags embeddings authoritatively and skips not-loaded entries", () => {
		const descriptors = parseLoadedModelDescriptors(PAYLOAD);
		expect(descriptors).toHaveLength(3); // 2 llm + 1 embedding; the not-loaded qwen3-8b is skipped
		const embedding = descriptors.find((d) => d.isEmbedding);
		expect(embedding?.runtimeId).toBe("text-embedding-nomic-embed-text-v1.5@q8_0-m4mini");
		expect(descriptors.map((d) => d.runtimeId)).not.toContain("qwen/qwen3-8b");
	});

	it("derives reasoning=true only from a declared reasoning capability", () => {
		const descriptors = parseLoadedModelDescriptors(PAYLOAD);
		expect(descriptors.find((d) => d.modelKey === "qwen/qwen3.6-27b")?.reasoning).toBe(true);
		expect(descriptors.find((d) => d.modelKey === "qwen3.5-9b-mtp")?.reasoning).toBeUndefined();
	});

	it("falls back to the runtime id when the real key is absent, and tolerates junk", () => {
		expect(parseLoadedModelDescriptors({ data: [{ loaded_instances: [{ id: "only-id" }] }] })[0]).toMatchObject({
			runtimeId: "only-id",
			modelKey: "only-id",
			isEmbedding: false,
		});
		expect(parseLoadedModelDescriptors(null)).toEqual([]);
		expect(parseLoadedModelDescriptors({ data: "nope" })).toEqual([]);
	});
});

describe("lmStudioApiV1ModelsUrl", () => {
	it("maps a /v1 base url to the native /api/v1/models url", () => {
		expect(lmStudioApiV1ModelsUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/api/v1/models");
		expect(lmStudioApiV1ModelsUrl("http://host:1234/")).toBe("http://host:1234/api/v1/models");
	});
});

describe("fetchLoadedModelDescriptors", () => {
	it("returns parsed descriptors on a 200 and [] on failure", async () => {
		const ok = (async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })) as unknown as typeof fetch;
		expect((await fetchLoadedModelDescriptors("http://x/v1", ok)).length).toBe(3);

		const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
		expect(await fetchLoadedModelDescriptors("http://x/v1", bad)).toEqual([]);

		const threw = (async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		expect(await fetchLoadedModelDescriptors("http://x/v1", threw)).toEqual([]);
	});
});
