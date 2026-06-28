import { describe, expect, it } from "vitest";
import {
	buildLmsLoadArgs,
	buildLmsUnloadArgs,
	MIN_CONTEXT_WINDOW_TOKENS,
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
