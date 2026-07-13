import { describe, expect, it } from "vitest";
import { createAutoLoadedModelRegistry } from "../../../src/core/auto-loaded-model-registry";
import { DEFAULT_MODEL_IDLE_TTL_MS, decideIdleEvictions } from "../../../src/core/model-load-policy";

/**
 * F1.23 — idle-TTL eviction with current-task-need awareness: only !Klein-auto-loaded, idle-past-TTL, not-busy,
 * not-needed models are reclaimed (largest first), and the registry's use-marking resets the idle clock.
 */

const NOW = 10_000_000;

describe("decideIdleEvictions", () => {
	it("evicts only idle-past-TTL, unneeded, non-busy auto-loaded models, largest first", () => {
		const plan = decideIdleEvictions({
			now: NOW,
			idleTtlMs: 60_000,
			neededModelIds: ["needed-model"],
			autoLoaded: [
				{ id: "idle-big", sizeGb: 20, busy: false, lastUsedAtMs: NOW - 120_000, loadedAtMs: NOW - 300_000 },
				{ id: "idle-small", sizeGb: 4, busy: false, lastUsedAtMs: null, loadedAtMs: NOW - 120_000 },
				{ id: "fresh", sizeGb: 8, busy: false, lastUsedAtMs: NOW - 10_000, loadedAtMs: NOW - 300_000 },
				{ id: "busy-model", sizeGb: 30, busy: true, lastUsedAtMs: NOW - 120_000, loadedAtMs: NOW - 300_000 },
				{ id: "needed-model", sizeGb: 12, busy: false, lastUsedAtMs: NOW - 120_000, loadedAtMs: NOW - 300_000 },
			],
		});
		expect(plan.unloadModelIds).toEqual(["idle-big", "idle-small"]); // largest first; never-used idles since load
		expect(plan.reasons["idle-big"]).toContain("idle 2 min");
		expect(DEFAULT_MODEL_IDLE_TTL_MS).toBe(1_800_000);
	});
});

describe("createAutoLoadedModelRegistry", () => {
	it("records loads idempotently, resets the idle clock on use, and forgets unloads", () => {
		const registry = createAutoLoadedModelRegistry();
		registry.recordLoad("m", 1_000);
		registry.markUsed("m", 2_000);
		registry.recordLoad("m", 3_000); // re-load refreshes loadedAt, keeps lastUsed
		expect(registry.list()).toEqual([{ modelId: "m", loadedAtMs: 3_000, lastUsedAtMs: 2_000 }]);
		registry.markUsed("unknown", 4_000); // never recorded — a no-op (operator models never enter)
		expect(registry.list()).toHaveLength(1);
		registry.forget("m");
		expect(registry.list()).toEqual([]);
	});
});
