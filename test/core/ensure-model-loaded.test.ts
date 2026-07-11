import { describe, expect, it } from "vitest";
import {
	type EnsureLoadRequest,
	type EnsureModelLoadedDeps,
	ensureModelLoadedOnFittingDevice,
} from "../../src/core/ensure-model-loaded";
import type { LmsLinkDevices } from "../../src/core/lms-link-status";

const GiB = 1024 ** 3;
const gb = (n: number): number => n * GiB;

const roster: LmsLinkDevices = {
	localMachineName: "m5max",
	localDeviceIdentifier: "id-m5max",
	preferredDeviceIdentifier: "id-mini",
	namesByDeviceId: new Map([
		["id-mini", "m4mini"],
		["id-legion", "legion5pro"],
	]),
};

const sizes = new Map<string, number>([["qwen/qwen2.5-coder-14b", gb(7.75)]]);

interface Rec {
	deps: EnsureModelLoadedDeps;
	loadCalls: () => EnsureLoadRequest[];
	linkFetches: () => number;
}

function recDeps(overrides: Partial<EnsureModelLoadedDeps> = {}): Rec {
	const loadCalls: EnsureLoadRequest[] = [];
	let linkFetches = 0;
	const deps: EnsureModelLoadedDeps = {
		env: { NKLEIN_DEVICE_RAM_GB: "m5max:128,m4mini:16,legion5pro:24" },
		fetchLinkDevices: async () => {
			linkFetches += 1;
			return roster;
		},
		listModelSizes: async () => sizes,
		loadExclusive: async (request) => {
			loadCalls.push(request);
			return { loaded: true, reason: "Loaded (OK)" };
		},
		...overrides,
	};
	return { deps, loadCalls: () => loadCalls, linkFetches: () => linkFetches };
}

describe("ensureModelLoadedOnFittingDevice", () => {
	it("loads a non-resident 14B on the fitting farm (m5max) with the right guarded-load args", async () => {
		const rec = recDeps();
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(true);
		if (result.loaded) {
			expect(result.deviceName).toBe("m5max");
		}
		expect(rec.loadCalls()).toHaveLength(1);
		const req = rec.loadCalls()[0];
		expect(req.modelId).toBe("qwen/qwen2.5-coder-14b");
		expect(req.targetDevice).toBe("m5max");
		expect(req.targetDeviceIdentifier).toBe("id-m5max");
		expect(req.totalRamBytes).toBe(gb(128)); // the CHOSEN device's RAM, per-machine headroom
		expect(req.contextLength).toBe(40_000);
		// Effective size = weights + KV @40k, so well above the raw 7.75 GiB weights.
		expect(req.candidateSizeBytes).toBeGreaterThan(gb(14));
	});

	it("aliases a 'Local' env key onto the real local device name (m5max)", async () => {
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "Local:128,m4mini:16" } });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(true);
		if (result.loaded) {
			expect(result.deviceName).toBe("m5max");
		}
	});

	it("no-ops WITHOUT fleet I/O when NKLEIN_DEVICE_RAM_GB is unset (byte-identical block behavior)", async () => {
		const rec = recDeps({ env: {} });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.linkFetches()).toBe(0);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("does not load (loaded:false) when NO mapped device can fit the model", async () => {
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "m4mini:16" } }); // only the small box is mapped
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.loadCalls()).toEqual([]); // never attempts a load onto an undersized node
	});

	it("does not load when the model's weights size is unknown", async () => {
		const rec = recDeps({ listModelSizes: async () => new Map() });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("propagates a guarded-load refusal (loaded:false) with its reason", async () => {
		const rec = recDeps({
			loadExclusive: async () => ({ loaded: false, reason: "Refused by the model-capability gate: reasoning-only" }),
		});
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(result.reason).toMatch(/capability gate/i);
	});

	it("fails safe (loaded:false, never throws) when a fleet read throws", async () => {
		const rec = recDeps({
			fetchLinkDevices: async () => {
				throw new Error("lms link status failed");
			},
		});
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(result.reason).toMatch(/error/i);
	});

	it("fails safe when the load itself throws", async () => {
		const rec = recDeps({
			loadExclusive: async () => {
				throw new Error("lms load crashed");
			},
		});
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", contextLength: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
	});

	it("prefers the llmfit KV-aware footprint when supplied", async () => {
		const rec = recDeps({
			env: { NKLEIN_DEVICE_RAM_GB: "m5max:128,m4mini:16" },
			listModelSizes: async () => new Map([["tiny", gb(3)]]),
			llmfitMemoryBytes: (id) => (id === "tiny" ? gb(15) : null),
		});
		const result = await ensureModelLoadedOnFittingDevice({ modelId: "tiny", contextLength: 40_000 }, rec.deps);
		expect(result.loaded).toBe(true);
		if (result.loaded) {
			expect(result.deviceName).toBe("m5max"); // 15 GiB llmfit footprint excludes the 16 GB mini
		}
		expect(rec.loadCalls()[0].candidateSizeBytes).toBe(gb(15));
	});

	it("skips on an empty model id", async () => {
		const rec = recDeps();
		const result = await ensureModelLoadedOnFittingDevice({ modelId: "  ", contextLength: 40_000 }, rec.deps);
		expect(result.loaded).toBe(false);
		expect(rec.linkFetches()).toBe(0);
	});
});
