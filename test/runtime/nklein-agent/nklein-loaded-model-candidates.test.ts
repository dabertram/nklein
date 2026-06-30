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
});
