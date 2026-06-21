import { describe, expect, it } from "vitest";
import { resolveLocalSamplingOptions } from "../../../src/nklein-sdk/nklein-sampling-policy";

describe("resolveLocalSamplingOptions", () => {
	it("defaults to a deterministic coding baseline with min_p and repetition penalty", () => {
		const sampling = resolveLocalSamplingOptions({ role: "worker" });
		expect(sampling.temperature).toBeLessThanOrEqual(0.2);
		expect(sampling.minP).toBe(0.05);
		expect(sampling.repetitionPenalty).toBeGreaterThanOrEqual(1.05);
	});

	it("uses a more exploratory temperature for planning/architect", () => {
		const planner = resolveLocalSamplingOptions({ role: "planner" });
		const worker = resolveLocalSamplingOptions({ role: "worker" });
		expect(planner.temperature ?? 0).toBeGreaterThan(worker.temperature ?? 0);
	});

	it("uses near-greedy sampling for structured output", () => {
		const structured = resolveLocalSamplingOptions({ role: "structured" });
		expect(structured.temperature).toBeLessThanOrEqual(0.1);
	});

	it("tightens temperature and penalty for small/quantized model families", () => {
		const small = resolveLocalSamplingOptions({ role: "worker", modelId: "qwen2.5-coder-7b" });
		const generic = resolveLocalSamplingOptions({ role: "worker", modelId: "some-big-model" });
		expect(small.temperature ?? 1).toBeLessThanOrEqual(generic.temperature ?? 1);
		expect(small.repetitionPenalty ?? 1).toBeGreaterThanOrEqual(generic.repetitionPenalty ?? 1);
	});

	it("lets caller overrides win", () => {
		const sampling = resolveLocalSamplingOptions({
			role: "worker",
			modelId: "qwen",
			override: { temperature: 0.9, minP: undefined },
		});
		expect(sampling.temperature).toBe(0.9);
		// undefined override is ignored, baseline min_p preserved.
		expect(sampling.minP).toBe(0.05);
	});
});
