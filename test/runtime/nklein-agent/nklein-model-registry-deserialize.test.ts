import { describe, expect, it } from "vitest";

import {
	createNKleinModelRegistryEntry,
	normalizeSnapshot,
	registryEntryObservationCount,
} from "../../../src/nklein-agent/nklein-model-registry-deserialize";

describe("createNKleinModelRegistryEntry", () => {
	it("builds an entry with the canonical key, empty stats, and the given timestamps", () => {
		const entry = createNKleinModelRegistryEntry({ providerId: "lmstudio", modelId: "qwen", endpoint: "ep" }, 1000);
		expect(entry.key).toBe("lmstudio:qwen:ep");
		expect(entry.speed.samples).toBe(0);
		expect(entry.capability.staticPrior).toBe(35);
		expect(entry.createdAt).toBe(1000);
		expect(entry.updatedAt).toBe(1000);
	});
});

describe("registryEntryObservationCount", () => {
	it("sums the speed and capability samples", () => {
		const entry = createNKleinModelRegistryEntry({ providerId: "lmstudio", modelId: "qwen" }, 1000);
		entry.speed.samples = 3;
		entry.capability.samples = 2;
		expect(registryEntryObservationCount(entry)).toBe(5);
	});
});

describe("normalizeSnapshot", () => {
	it("returns an empty snapshot (schemaVersion 1) for null/invalid input", () => {
		const snapshot = normalizeSnapshot(null, 1000);
		expect(snapshot.schemaVersion).toBe(1);
		expect(snapshot.updatedAt).toBe(1000);
		expect(snapshot.models).toEqual({});
	});

	it("deserializes valid entries keyed by their canonical key", () => {
		const snapshot = normalizeSnapshot(
			{ models: { whatever: { providerId: "lmstudio", modelId: "qwen", endpoint: "ep" } } },
			1000,
		);
		expect(Object.keys(snapshot.models)).toEqual(["lmstudio:qwen:ep"]);
	});

	it("drops records missing a provider or model", () => {
		const snapshot = normalizeSnapshot({ models: { bad: { modelId: "qwen" } } }, 1000);
		expect(snapshot.models).toEqual({});
	});

	it("merges key collisions, keeping the entry with more observations", () => {
		const snapshot = normalizeSnapshot(
			{
				models: {
					a: { providerId: "lmstudio", modelId: "qwen", endpoint: "ep", speed: { samples: 0 } },
					b: { providerId: "lmstudio", modelId: "qwen", endpoint: "ep", speed: { samples: 9 } },
				},
			},
			1000,
		);
		expect(Object.keys(snapshot.models)).toEqual(["lmstudio:qwen:ep"]);
		expect(snapshot.models["lmstudio:qwen:ep"]?.speed.samples).toBe(9);
	});
});
