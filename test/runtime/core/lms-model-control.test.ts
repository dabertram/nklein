import { describe, expect, it } from "vitest";
import {
	buildLmsLoadArgs,
	buildLmsUnloadArgs,
	MIN_CONTEXT_WINDOW_TOKENS,
	parseLmsPs,
	planGuardedModelLoad,
} from "../../../src/core/lms-model-control";

const GiB = 1024 ** 3;

describe("buildLmsLoadArgs", () => {
	it("builds a load argv with gpu max by default", () => {
		expect(buildLmsLoadArgs("phi-4-mini-instruct@8bit")).toEqual([
			"load",
			"phi-4-mini-instruct@8bit",
			"-y",
			"--gpu",
			"max",
		]);
	});

	it("floors context to the ≥32k invariant and caps to the model's capability", () => {
		// asked for 8k → floored to 32k
		expect(buildLmsLoadArgs("m", { contextLength: 8_000 })).toContain(String(MIN_CONTEXT_WINDOW_TOKENS));
		// asked for 200k but capability 131072 → capped
		expect(buildLmsLoadArgs("m", { contextLength: 200_000, maxContextLength: 131_072 })).toContain("131072");
		// asked for 40k within capability → kept
		expect(buildLmsLoadArgs("m", { contextLength: 40_000, maxContextLength: 131_072 })).toContain("40000");
	});

	it("includes a TTL when given", () => {
		expect(buildLmsLoadArgs("m", { ttlSeconds: 300 })).toEqual(["load", "m", "-y", "--gpu", "max", "--ttl", "300"]);
	});

	it("passes a numeric gpu ratio as a partial-offload value (clamped to [0,1])", () => {
		// the small-VRAM linked-box lever (e.g. the Legion's 8 GB dGPU): --gpu 0.5 offloads half the layers
		expect(buildLmsLoadArgs("m", { gpu: 0.5 })).toEqual(["load", "m", "-y", "--gpu", "0.5"]);
		// out-of-range ratios are clamped, not passed through raw
		expect(buildLmsLoadArgs("m", { gpu: 1.7 })).toEqual(["load", "m", "-y", "--gpu", "1"]);
		expect(buildLmsLoadArgs("m", { gpu: -0.3 })).toEqual(["load", "m", "-y", "--gpu", "0"]);
	});

	it("omits the --gpu flag entirely for gpu:'auto' (let LM Studio decide)", () => {
		expect(buildLmsLoadArgs("m", { gpu: "auto" })).toEqual(["load", "m", "-y"]);
	});

	it("passes gpu:'off' through as a keyword (CPU-only load)", () => {
		expect(buildLmsLoadArgs("m", { gpu: "off" })).toEqual(["load", "m", "-y", "--gpu", "off"]);
	});

	it("appends --estimate-only for a no-load, device-aware fit pre-check", () => {
		const args = buildLmsLoadArgs("m", { contextLength: 40_000, estimateOnly: true });
		expect(args).toContain("--estimate-only");
		expect(args[0]).toBe("load");
	});
});

describe("buildLmsUnloadArgs", () => {
	it("builds an unload argv", () => {
		expect(buildLmsUnloadArgs("m")).toEqual(["unload", "m"]);
	});
});

describe("planGuardedModelLoad", () => {
	const totalRamBytes = 128 * GiB;

	it("returns an argv when the headroom guard approves", () => {
		const plan = planGuardedModelLoad({
			modelId: "google/gemma-4-e2b-q8",
			candidateSizeBytes: 6 * GiB,
			residentSizeBytes: 40 * GiB,
			totalRamBytes,
			load: { contextLength: 40_000, maxContextLength: 131_072 },
		});
		expect(plan.allow).toBe(true);
		if (plan.allow) {
			expect(plan.argv[0]).toBe("load");
			expect(plan.argv).toContain("40000");
		}
	});

	it("refuses (no argv) when the guard says the load would breach the reserve", () => {
		const plan = planGuardedModelLoad({
			modelId: "huge@8bit",
			candidateSizeBytes: 40 * GiB,
			residentSizeBytes: 100 * GiB,
			totalRamBytes,
		});
		expect(plan.allow).toBe(false);
		expect(plan).not.toHaveProperty("argv");
		expect(plan.reason).toMatch(/reserve|freeze/i);
	});
});

describe("parseLmsPs", () => {
	const sample = [
		"IDENTIFIER                                          MODEL                                        STATUS    SIZE         CONTEXT    PARALLEL    DEVICE    TTL",
		"google/gemma-4-e2b-m5max                            google/gemma-4-e2b                           IDLE      4.37 GB      40000      1           Local",
		"phi-4-mini-instruct@8bit                            phi-4-mini-instruct@8bit                     IDLE      4.10 GB      40000      1           Local",
		"text-embedding-nomic-embed-text-v1.5@q8_0-m4mini    text-embedding-nomic-embed-text-v1.5@q8_0    IDLE      146.15 MB    2048       -           m4mini",
		"",
	].join("\n");

	it("parses the lms ps table into resident models (identifier, size bytes, context)", () => {
		const models = parseLmsPs(sample);
		expect(models.map((m) => m.identifier)).toEqual([
			"google/gemma-4-e2b-m5max",
			"phi-4-mini-instruct@8bit",
			"text-embedding-nomic-embed-text-v1.5@q8_0-m4mini",
		]);
		expect(models[0].sizeBytes).toBe(Math.round(4.37 * 1024 ** 3));
		expect(models[0].contextLength).toBe(40000);
		expect(models[2].sizeBytes).toBe(Math.round(146.15 * 1024 ** 2));
	});

	it("captures the DEVICE column so the guard can scope unloads per machine", () => {
		const models = parseLmsPs(sample);
		expect(models.map((m) => m.device)).toEqual(["Local", "Local", "m4mini"]);
		// a row without the DEVICE column (older lms) → device null
		const legacy = parseLmsPs(["IDENTIFIER  MODEL  STATUS  SIZE  CONTEXT", "m  m  IDLE  4.00 GB  40000"].join("\n"));
		expect(legacy[0]?.device).toBeNull();
	});

	it("skips the header + blank lines and is empty for no rows", () => {
		expect(parseLmsPs("IDENTIFIER  MODEL  STATUS  SIZE  CONTEXT\n\n")).toEqual([]);
		expect(parseLmsPs("")).toEqual([]);
	});
});
