import { describe, expect, it } from "vitest";
import { buildLoadedModelRoutingCandidates } from "../../../src/nklein-agent/nklein-loaded-model-candidates";
import { createNKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry-deserialize";

const NOW = 1_000_000;
const PROVIDER = "lmstudio";
const ENDPOINT = "http://127.0.0.1:1234/v1";

describe("buildLoadedModelRoutingCandidates", () => {
	it("builds one candidate per loaded model, role-tagged, in loaded order", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["model-a", "model-b"],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
			role: "worker",
		});
		expect(candidates).toHaveLength(2);
		expect(candidates.map((c) => c.entry.modelId)).toEqual(["model-a", "model-b"]);
		expect(candidates.every((c) => c.role === "worker")).toBe(true);
	});

	it("REUSES a known model's observed registry entry (so ledger history drives ranking), mints a default for the rest", () => {
		const known = createNKleinModelRegistryEntry({ providerId: PROVIDER, modelId: "known", endpoint: ENDPOINT }, NOW);
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["known", "fresh"],
			registryEntries: [known],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
		});
		expect(candidates[0]?.entry).toBe(known); // same object — observed entry reused
		expect(candidates[1]?.entry.modelId).toBe("fresh"); // freshly minted default
		expect(candidates[1]?.entry).not.toBe(known);
	});

	it("dedupes by registry key and skips blank ids", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["dup", "  ", "dup", ""],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
		});
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.entry.modelId).toBe("dup");
	});

	it("defaults the role tag to null when not supplied", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["m"],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
		});
		expect(candidates[0]?.role).toBeNull();
	});

	it("filters out embedding models (not agentic routing candidates)", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["qwen3.5-9b", "text-embedding-nomic-embed-text-v1.5", "nomic-embed-text-v1.5", "bge-embed"],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
		});
		expect(candidates.map((c) => c.entry.modelId)).toEqual(["qwen3.5-9b"]);
	});

	it("sets observedCapability + affinityTags from the resolved profile for an UNOBSERVED model", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["coder", "chatty"],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
			resolveProfile: (id) =>
				id === "coder"
					? { capabilityPrior: 80, affinityTags: ["code", "agentic"] }
					: { capabilityPrior: 28, affinityTags: ["instruct"] },
		});
		expect(candidates[0]).toMatchObject({ observedCapability: 80, affinityTags: ["code", "agentic"] });
		expect(candidates[1]).toMatchObject({ observedCapability: 28, affinityTags: ["instruct"] });
	});

	it("does NOT override an OBSERVED model's learned score with the prior, but still tags it", () => {
		const known = createNKleinModelRegistryEntry({ providerId: PROVIDER, modelId: "known", endpoint: ENDPOINT }, NOW);
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["known", "fresh"],
			registryEntries: [known],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
			resolveProfile: () => ({ capabilityPrior: 99, affinityTags: ["code"] }),
		});
		expect(candidates[0]?.observedCapability).toBeUndefined(); // observed → no score override
		expect(candidates[0]?.affinityTags).toEqual(["code"]); // …but affinity still applies (it's the model's nature)
		expect(candidates[1]?.observedCapability).toBe(99); // cold → prior applied
	});

	it("omits observedCapability when the profile prior is null (keeps the registry default)", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			loadedModelIds: ["unknown-card"],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
			resolveProfile: () => ({ capabilityPrior: null }),
		});
		expect(candidates[0]?.observedCapability).toBeUndefined();
		expect(candidates[0]?.affinityTags).toBeUndefined();
	});

	it("uses the profile's AUTHORITATIVE isEmbedding flag (a non-embedding name can be flagged, and vice-versa)", () => {
		const candidates = buildLoadedModelRoutingCandidates({
			// "weird-vectorizer" wouldn't match the name regex, but the profile says it's an embedding → dropped.
			// "embed-but-llm" WOULD match the regex, but the profile says it's an LLM → kept.
			loadedModelIds: ["weird-vectorizer", "embed-but-llm"],
			registryEntries: [],
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			now: NOW,
			resolveProfile: (id) => ({ isEmbedding: id === "weird-vectorizer" }),
		});
		expect(candidates.map((c) => c.entry.modelId)).toEqual(["embed-but-llm"]);
	});
});
