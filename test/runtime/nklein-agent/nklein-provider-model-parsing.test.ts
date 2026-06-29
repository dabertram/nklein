import { describe, expect, it } from "vitest";
import type { RuntimeNKleinProviderModel } from "../../../src/core/api-contract";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import {
	extractDiscoveredModelsFromPayload,
	mergeProviderModelsWithContextWindowFallback,
	mergeProviderModelsWithModelRegistry,
	normalizeContextWindow,
	sortDiscoveredProviderModels,
} from "../../../src/nklein-agent/nklein-provider-model-parsing";

const model = (id: string, extra: Partial<RuntimeNKleinProviderModel> = {}): RuntimeNKleinProviderModel => ({
	id,
	name: id,
	...extra,
});

describe("normalizeContextWindow", () => {
	it("keeps a positive finite number, truncating fractions", () => {
		expect(normalizeContextWindow(8000)).toBe(8000);
		expect(normalizeContextWindow(8000.9)).toBe(8000);
	});
	it("rejects non-positive / non-finite / absent values as null", () => {
		for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
			expect(normalizeContextWindow(bad)).toBeNull();
		}
	});
});

describe("sortDiscoveredProviderModels", () => {
	it("ranks embeddings first, then sorts by name; does not mutate the input", () => {
		const input = [
			model("zeta", { name: "Zeta" }),
			model("emb", { name: "Embed", type: "embeddings" }),
			model("alpha", { name: "Alpha" }),
		];
		const sorted = sortDiscoveredProviderModels(input);
		expect(sorted.map((m) => m.name)).toEqual(["Embed", "Alpha", "Zeta"]);
		expect(input.map((m) => m.name)).toEqual(["Zeta", "Embed", "Alpha"]); // input untouched
	});
});

describe("mergeProviderModelsWithContextWindowFallback", () => {
	it("fills a missing context window from the fallback by id", () => {
		const out = mergeProviderModelsWithContextWindowFallback([model("a")], [model("a", { contextWindow: 4096 })]);
		expect(out[0]?.contextWindow).toBe(4096);
	});
	it("keeps an existing context window unless preferFallback is set", () => {
		const kept = mergeProviderModelsWithContextWindowFallback(
			[model("a", { contextWindow: 8192 })],
			[model("a", { contextWindow: 4096 })],
		);
		expect(kept[0]?.contextWindow).toBe(8192);
		const preferred = mergeProviderModelsWithContextWindowFallback(
			[model("a", { contextWindow: 8192 })],
			[model("a", { contextWindow: 4096 })],
			{ preferFallbackContextWindow: true },
		);
		expect(preferred[0]?.contextWindow).toBe(4096);
	});
});

describe("mergeProviderModelsWithModelRegistry", () => {
	const entry = (providerId: string, modelId: string, effective: number): NKleinModelRegistryEntry =>
		({ providerId, modelId, contextWindow: { effective } }) as NKleinModelRegistryEntry;

	it("overrides the context window with the measured registry value for the same provider+model", () => {
		const out = mergeProviderModelsWithModelRegistry(
			"lmstudio",
			[model("m", { contextWindow: 4096 })],
			[entry("lmstudio", "m", 32000)],
		);
		expect(out[0]?.contextWindow).toBe(32000);
	});
	it("leaves models unchanged when the provider does not match or registry is empty", () => {
		expect(
			mergeProviderModelsWithModelRegistry("lmstudio", [model("m", { contextWindow: 4096 })], [])[0]?.contextWindow,
		).toBe(4096);
		const otherProvider = mergeProviderModelsWithModelRegistry(
			"lmstudio",
			[model("m", { contextWindow: 4096 })],
			[entry("ollama", "m", 32000)],
		);
		expect(otherProvider[0]?.contextWindow).toBe(4096);
	});
});

describe("extractDiscoveredModelsFromPayload", () => {
	it("parses an LM Studio /api/v0/models payload (id + context from model_info)", () => {
		const out = extractDiscoveredModelsFromPayload(
			{ data: [{ id: "qwen3-8b", type: "llm", model_info: { context_length: 40000 } }] },
			"http://localhost:1234/api/v0/models",
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: "qwen3-8b", contextWindow: 40000, type: "llm" });
	});

	it("parses a generic OpenAI-style list on a non-LM-Studio path", () => {
		const out = extractDiscoveredModelsFromPayload(
			{ data: [{ id: "gpt-x" }, "bare-id"] },
			"https://api.example.com/v1/models",
		);
		expect(out.map((m) => m.id).sort()).toEqual(["bare-id", "gpt-x"]);
	});

	it("expands /api/v1/models loaded_instances into per-instance models", () => {
		const out = extractDiscoveredModelsFromPayload(
			{
				data: [
					{
						id: "base",
						loaded_instances: [{ id: "base:1", config: { loaded_context_length: 8000 } }],
					},
				],
			},
			"http://localhost:1234/api/v1/models",
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: "base:1", contextWindow: 8000 });
	});

	it("dedupes by id (first context window wins) and returns [] for empty/invalid payloads", () => {
		const deduped = extractDiscoveredModelsFromPayload(
			{ data: [{ id: "dup", context_length: 4096 }], models: [{ id: "dup", context_length: 9999 }] },
			"https://api.example.com/v1/models",
		);
		expect(deduped).toHaveLength(1);
		expect(deduped[0]?.contextWindow).toBe(4096);
		expect(extractDiscoveredModelsFromPayload({}, "https://x/v1/models")).toEqual([]);
		expect(extractDiscoveredModelsFromPayload(null, "not a url")).toEqual([]);
	});
});
