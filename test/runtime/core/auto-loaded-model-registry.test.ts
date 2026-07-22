import { describe, expect, it } from "vitest";
import { createAutoLoadedModelRegistry, modelUseReservationId } from "../../../src/core/auto-loaded-model-registry";

describe("createAutoLoadedModelRegistry (F1.23)", () => {
	it("records an autonomous load and lists it (lastUsed starts null)", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1000);
		expect(registry.list()).toEqual([{ modelId: "m1", loadedAtMs: 1000, lastUsedAtMs: null }]);
	});

	it("re-load refreshes both warm clocks so it cannot be immediately TTL-evicted", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1000);
		registry.markUsed("m1", 1500);
		registry.recordLoad("m1", 2000);
		expect(registry.list()).toEqual([{ modelId: "m1", loadedAtMs: 2000, lastUsedAtMs: 2000 }]);
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

	it("tracks placement and protects a model across a task lease until terminal use", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m1", 1_000, "m5max");
		const reservationId = modelUseReservationId("workspace-a", "task-a");
		registry.reserveUse("m1", reservationId);
		expect(registry.reservedModelIds()).toEqual(["m1"]);
		registry.releaseUse(reservationId, 9_000);
		expect(registry.reservedModelIds()).toEqual([]);
		expect(registry.list()).toEqual([{ modelId: "m1", deviceName: "m5max", loadedAtMs: 1_000, lastUsedAtMs: 9_000 }]);
	});

	it("unions queued model needs across workspaces", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.setWorkspaceNeededModels("a", ["m1", "m2"]);
		registry.setWorkspaceNeededModels("b", ["m2", "m3"]);
		expect(new Set(registry.neededModelIds())).toEqual(new Set(["m1", "m2", "m3"]));
		registry.clearWorkspaceNeededModels("a");
		expect(new Set(registry.neededModelIds())).toEqual(new Set(["m2", "m3"]));
	});

	it("tracks identical model identifiers independently on each LM-Link host", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("shared", 1_000, "m5max");
		registry.recordLoad("shared", 2_000, "legion5pro");
		expect(registry.list()).toHaveLength(2);

		registry.forget("shared", "legion5pro");
		expect(registry.list()).toEqual([
			{ modelId: "shared", deviceName: "m5max", loadedAtMs: 1_000, lastUsedAtMs: null },
		]);
	});
});
