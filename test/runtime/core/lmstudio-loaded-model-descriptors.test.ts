import { describe, expect, it } from "vitest";
import {
	fetchLoadedModelDescriptors,
	lmStudioApiV1ModelsUrl,
	mergeLoadedModelDescriptors,
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
			loaded_instances: [
				{
					id: "qwen3.5-9b-mtp-q4-k-xl-legion5pro",
					config: { context_length: 40000 },
				},
			],
		},
		// LOADED reasoner: a declared `reasoning` capability ⇒ reasoning=true.
		{
			type: "llm",
			key: "qwen/qwen3.6-27b",
			architecture: "qwen3_5",
			capabilities: {
				trained_for_tool_use: true,
				reasoning: { allowed_options: ["off", "on"], default: "on" },
			},
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
		{
			type: "llm",
			key: "qwen/qwen3-8b",
			capabilities: { trained_for_tool_use: true },
			loaded_instances: [],
		},
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
		expect(
			parseLoadedModelDescriptors({
				data: [{ loaded_instances: [{ id: "only-id" }] }],
			})[0],
		).toMatchObject({
			runtimeId: "only-id",
			modelKey: "only-id",
			isEmbedding: false,
		});
		expect(parseLoadedModelDescriptors(null)).toEqual([]);
		expect(parseLoadedModelDescriptors({ data: "nope" })).toEqual([]);
	});

	it("parses the minimal /api/v0/models loaded-state envelope as fallback descriptors", () => {
		const descriptors = parseLoadedModelDescriptors({
			data: [
				{
					id: "qwen/qwen2.5-coder-14b",
					state: "loaded",
					type: "llm",
					architecture: "qwen2",
					max_context_length: 32768,
				},
				{ id: "text-embedding-nomic", state: "loaded", type: "embedding" },
				{ id: "not-resident", state: "not-loaded", type: "llm" },
			],
		});

		expect(descriptors).toEqual([
			{
				runtimeId: "qwen/qwen2.5-coder-14b",
				modelKey: "qwen/qwen2.5-coder-14b",
				isEmbedding: false,
				architecture: "qwen2",
				maxContextLength: 32768,
			},
			{
				runtimeId: "text-embedding-nomic",
				modelKey: "text-embedding-nomic",
				isEmbedding: true,
			},
		]);
	});
});

describe("mergeLoadedModelDescriptors", () => {
	it("augments REST descriptors with LM-Link models visible only through lms ps", () => {
		const descriptors = mergeLoadedModelDescriptors(parseLoadedModelDescriptors(PAYLOAD), [
			{
				identifier: "qwen2.5.1-coder-7b-instruct",
				modelKey: "mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
				indexedModelIdentifier: "device-1:mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
				path: "mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
				machineId: "device-1",
				isEmbedding: false,
				status: "idle",
				queued: 0,
				parallel: 1,
				trainedForToolUse: false,
				contextLength: 32768,
			},
			{
				identifier: "qwen/qwen3.6-27b",
				modelKey: "qwen/qwen3.6-27b",
				indexedModelIdentifier: null,
				path: "qwen/qwen3.6-27b",
				machineId: "device-2",
				isEmbedding: false,
				status: "idle",
				queued: 0,
				parallel: 1,
				trainedForToolUse: true,
				contextLength: 65536,
			},
		]);

		expect(descriptors.find((d) => d.runtimeId === "qwen2.5.1-coder-7b-instruct")).toMatchObject({
			runtimeId: "qwen2.5.1-coder-7b-instruct",
			modelKey: "mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
			isEmbedding: false,
			toolUse: false,
			maxContextLength: 32768,
		});
		expect(descriptors.filter((d) => d.runtimeId === "qwen/qwen3.6-27b")).toHaveLength(1);
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
		const ok = (async () =>
			new Response(JSON.stringify(PAYLOAD), {
				status: 200,
			})) as unknown as typeof fetch;
		expect((await fetchLoadedModelDescriptors("http://x/v1", ok)).length).toBe(3);

		const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
		expect(await fetchLoadedModelDescriptors("http://x/v1", bad)).toEqual([]);

		const threw = (async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		expect(await fetchLoadedModelDescriptors("http://x/v1", threw)).toEqual([]);
	});

	it("falls back to /api/v0/models when the rich endpoint is unavailable or empty", async () => {
		const calls: string[] = [];
		const f = (async (url: string) => {
			calls.push(url);
			if (url.endsWith("/api/v1/models")) {
				return new Response("", { status: 404 });
			}
			return new Response(
				JSON.stringify({
					data: [{ id: "qwen/qwen2.5-coder-14b", state: "loaded", type: "llm" }],
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		await expect(fetchLoadedModelDescriptors("http://x/v1", f)).resolves.toEqual([
			{
				runtimeId: "qwen/qwen2.5-coder-14b",
				modelKey: "qwen/qwen2.5-coder-14b",
				isEmbedding: false,
			},
		]);
		expect(calls).toEqual(["http://x/api/v1/models", "http://x/api/v0/models"]);
	});
});
