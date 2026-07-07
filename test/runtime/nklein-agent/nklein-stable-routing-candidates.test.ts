import { describe, expect, it } from "vitest";
import { buildNKleinModelRegistryKey } from "../../../src/nklein-agent/nklein-model-registry-key";
import {
	applyStableRoutingKeysToCandidates,
	buildResidencyModelKeySet,
} from "../../../src/nklein-agent/nklein-stable-routing-candidates";

const ENDPOINT = "http://localhost:1234/v1";
type Entry = { key: string; modelId: string; providerId: string; endpoint: string | null };
type Candidate = { entry: Entry; role: string | null };

const candidate = (runtimeModelId: string, role: string | null = null): Candidate => {
	const key = buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: runtimeModelId, endpoint: ENDPOINT });
	return { entry: { key, modelId: runtimeModelId, providerId: "lmstudio", endpoint: ENDPOINT }, role };
};

const mapOf = (...ids: string[]): Map<string, Candidate> => {
	const map = new Map<string, Candidate>();
	for (const id of ids) {
		const c = candidate(id);
		map.set(c.entry.key, c);
	}
	return map;
};

// A fake resolver: coder-gpu and gpu-coder both map to the same stable key; others are unmapped.
const resolveStable = (runtimeId: string): string =>
	runtimeId === "coder-gpu" || runtimeId === "gpu-coder" ? "qwen2.5-coder-14b" : runtimeId;

describe("applyStableRoutingKeysToCandidates", () => {
	it("re-keys a candidate to its stable routing key (entry.modelId stays the runtime id)", () => {
		const map = mapOf("coder-gpu");
		applyStableRoutingKeysToCandidates(map, resolveStable);
		const stableKey = buildNKleinModelRegistryKey({
			providerId: "lmstudio",
			modelId: "qwen2.5-coder-14b",
			endpoint: ENDPOINT,
		});
		expect([...map.keys()]).toEqual([stableKey]);
		const entry = map.get(stableKey)?.entry;
		expect(entry?.key).toBe(stableKey);
		expect(entry?.modelId).toBe("coder-gpu"); // runtime id preserved (launch + verdict identity)
	});

	it("leaves an unmapped candidate under its runtime-derived key", () => {
		const map = mapOf("mystery-model");
		const before = [...map.keys()];
		applyStableRoutingKeysToCandidates(map, resolveStable);
		expect([...map.keys()]).toEqual(before);
	});

	it("★ two runtime aliases of the same model COLLAPSE to one stable-keyed candidate", () => {
		const map = mapOf("coder-gpu", "gpu-coder");
		expect(map.size).toBe(2);
		applyStableRoutingKeysToCandidates(map, resolveStable);
		const stableKey = buildNKleinModelRegistryKey({
			providerId: "lmstudio",
			modelId: "qwen2.5-coder-14b",
			endpoint: ENDPOINT,
		});
		expect([...map.keys()]).toEqual([stableKey]); // collapsed — the same model is one routing identity
		expect(map.size).toBe(1);
	});

	it("preserves the rest of the candidate shape (shallow clone)", () => {
		const map = new Map<string, Candidate>();
		const c = candidate("coder-gpu", "reviewer");
		map.set(c.entry.key, c);
		applyStableRoutingKeysToCandidates(map, resolveStable);
		expect([...map.values()][0]?.role).toBe("reviewer");
	});

	it("is a no-op when the resolver returns every id unchanged", () => {
		const map = mapOf("a", "b");
		const before = new Map(map);
		applyStableRoutingKeysToCandidates(map, (id) => id);
		expect(map).toEqual(before);
	});
});

describe("buildResidencyModelKeySet", () => {
	const session = (modelId: string) => ({ providerId: "lmstudio", modelId, endpoint: ENDPOINT });

	it("identity resolver → runtime-derived registry keys (flag-OFF path, byte-identical)", () => {
		const set = buildResidencyModelKeySet([session("coder-gpu")], (id) => id);
		expect(
			set.has(buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "coder-gpu", endpoint: ENDPOINT })),
		).toBe(true);
	});

	it("stable resolver: two running aliases of the same model COLLAPSE to one residency key", () => {
		const set = buildResidencyModelKeySet([session("coder-gpu"), session("gpu-coder")], resolveStable);
		expect(set.size).toBe(1);
		expect(
			set.has(
				buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "qwen2.5-coder-14b", endpoint: ENDPOINT }),
			),
		).toBe(true);
	});

	it("★ the residency key EQUALS the re-keyed candidate key for the same running model (no double-start)", () => {
		// A running session under runtime id "coder-gpu"...
		const residency = buildResidencyModelKeySet([session("coder-gpu")], resolveStable);
		// ...and a routing candidate for the same runtime id, re-keyed the same way.
		const candidates = mapOf("coder-gpu");
		applyStableRoutingKeysToCandidates(candidates, resolveStable);
		const candidateKey = [...candidates.keys()][0];
		// The candidate's key is IN the residency set ⇒ isModelFree sees it as running ⇒ never started twice.
		expect(residency.has(candidateKey)).toBe(true);
	});
});
