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

const modelFacts = new Map([["qwen/qwen2.5-coder-14b", { sizeBytes: gb(7.75), maxContextLength: 262_144 }]]);

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
		listModelFacts: async () => modelFacts,
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
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
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
		expect(req.contextLength).toBe(32_000);
		expect(req.taskNeededTokens).toBe(6_000);
		expect(req.maxContextLength).toBe(262_144);
		expect(req.fastMemoryGuard).toMatchObject({
			weightsBytes: gb(7.75),
			fastMemoryBytes: gb(128),
		});
		// Effective size = weights + KV at the planned 32k, so well above the raw 7.75 GiB weights.
		expect(req.candidateSizeBytes).toBeGreaterThan(gb(14));
	});

	it("caps the load context to the selected host's reserved fast-memory budget", async () => {
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "m5max:20" } });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 28_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(true);
		expect(rec.loadCalls()[0]).toMatchObject({
			contextLength: 33_792,
			taskNeededTokens: 28_000,
			fastMemoryGuard: { fastMemoryBytes: gb(20) },
		});
	});

	it("refuses before loading when a fast-memory cap would starve the task", async () => {
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "m5max:20" } });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 40_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(result.reason).toMatch(/fast-memory gate|smaller model|more fast memory/i);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("sizes a large task up from the floor and passes the catalog maximum through to the guarded loader", async () => {
		const rec = recDeps();
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 80_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(true);
		expect(rec.loadCalls()[0]).toMatchObject({
			contextLength: 100_352,
			taskNeededTokens: 80_000,
			maxContextLength: 262_144,
		});
	});

	it("caps the planned load at the model maximum", async () => {
		const rec = recDeps({
			listModelFacts: async () =>
				new Map([["qwen/qwen2.5-coder-14b", { sizeBytes: gb(7.75), maxContextLength: 65_536 }]]),
		});
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 60_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(true);
		expect(rec.loadCalls()[0].contextLength).toBe(65_536);
	});

	it("aliases a 'Local' env key onto the real local device name (m5max)", async () => {
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "Local:128,m4mini:16" } });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
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
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.linkFetches()).toBe(0);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("engages via the configured Settings value (configuredDeviceRamGb) when the env var is unset", async () => {
		const rec = recDeps({ env: {}, configuredDeviceRamGb: "m5max:128,m4mini:16,legion5pro:24" });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(true);
		if (result.loaded) {
			expect(result.deviceName).toBe("m5max");
		}
		expect(rec.loadCalls()).toHaveLength(1);
	});

	it("env wins over the configured Settings value when both are set", async () => {
		// env maps ONLY the small box (m4mini:16) which cannot fit the 14B ⇒ no load, proving the config value was ignored.
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "m4mini:16" }, configuredDeviceRamGb: "m5max:128" });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("does not load (loaded:false) when NO mapped device can fit the model", async () => {
		const rec = recDeps({ env: { NKLEIN_DEVICE_RAM_GB: "m4mini:16" } }); // only the small box is mapped
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.loadCalls()).toEqual([]); // never attempts a load onto an undersized node
	});

	it("does not load when the model's weights size is unknown", async () => {
		const rec = recDeps({ listModelFacts: async () => new Map() });
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("does not guess a load context when the catalog maximum is invalid", async () => {
		const rec = recDeps({
			listModelFacts: async () =>
				new Map([["qwen/qwen2.5-coder-14b", { sizeBytes: gb(7.75), maxContextLength: 0 }]]),
		});
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
		expect(result.reason).toMatch(/maximum context unknown/i);
		expect(rec.loadCalls()).toEqual([]);
	});

	it("propagates a guarded-load refusal (loaded:false) with its reason", async () => {
		const rec = recDeps({
			loadExclusive: async () => ({ loaded: false, reason: "Refused by the model-capability gate: reasoning-only" }),
		});
		const result = await ensureModelLoadedOnFittingDevice(
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
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
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
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
			{ modelId: "qwen/qwen2.5-coder-14b", taskNeededTokens: 6_000 },
			rec.deps,
		);
		expect(result.loaded).toBe(false);
	});

	it("prefers the llmfit KV-aware footprint when supplied", async () => {
		const rec = recDeps({
			env: { NKLEIN_DEVICE_RAM_GB: "m5max:128,m4mini:16" },
			listModelFacts: async () => new Map([["tiny", { sizeBytes: gb(3), maxContextLength: 262_144 }]]),
			llmfitMemoryBytes: (id) => (id === "tiny" ? gb(15) : null),
		});
		const result = await ensureModelLoadedOnFittingDevice({ modelId: "tiny", taskNeededTokens: 6_000 }, rec.deps);
		expect(result.loaded).toBe(true);
		if (result.loaded) {
			expect(result.deviceName).toBe("m5max"); // 15 GiB llmfit footprint excludes the 16 GB mini
		}
		expect(rec.loadCalls()[0].candidateSizeBytes).toBe(gb(15));
	});

	it("skips on an empty model id", async () => {
		const rec = recDeps();
		const result = await ensureModelLoadedOnFittingDevice({ modelId: "  ", taskNeededTokens: 6_000 }, rec.deps);
		expect(result.loaded).toBe(false);
		expect(rec.linkFetches()).toBe(0);
	});
});
