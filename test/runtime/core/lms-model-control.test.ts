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

	it("skips the header + blank lines and is empty for no rows", () => {
		expect(parseLmsPs("IDENTIFIER  MODEL  STATUS  SIZE  CONTEXT\n\n")).toEqual([]);
		expect(parseLmsPs("")).toEqual([]);
	});
});
