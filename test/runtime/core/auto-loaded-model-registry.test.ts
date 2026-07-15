import { describe, expect, it } from "vitest";
import { createAutoLoadedModelRegistry } from "../../../src/core/auto-loaded-model-registry";

describe("createAutoLoadedModelRegistry (F1.23)", () => {
	it("records an autonomous load and lists it (lastUsed starts null)", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1000);
		expect(registry.list()).toEqual([{ modelId: "m1", loadedAtMs: 1000, lastUsedAtMs: null }]);
	});

	it("re-load refreshes loadedAt but preserves an existing lastUsed", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1000);
		registry.markUsed("m1", 1500);
		registry.recordLoad("m1", 2000);
		expect(registry.list()).toEqual([{ modelId: "m1", loadedAtMs: 2000, lastUsedAtMs: 1500 }]);
	});

	it("markUsed on an unknown model is a no-op (never resurrects a forgotten entry)", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.markUsed("ghost", 1000);
		expect(registry.list()).toEqual([]);
	});

	it("forget removes a model so eviction won't touch it (it's operator-owned again)", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1000);
		registry.recordLoad("m2", 1000);
		registry.forget("m1");
		expect(registry.list().map((r) => r.modelId)).toEqual(["m2"]);
	});

	it("list returns copies — mutating a returned record doesn't corrupt the registry", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1000);
		const snapshot = registry.list();
		snapshot[0].lastUsedAtMs = 9999;
		expect(registry.list()[0]?.lastUsedAtMs).toBeNull();
	});
});
