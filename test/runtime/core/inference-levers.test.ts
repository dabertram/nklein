import { describe, expect, it } from "vitest";
import {
	recommendKvCacheQuant,
	recommendSampler,
	shouldUseSpeculativeDecoding,
} from "../../../src/core/inference-levers";

describe("shouldUseSpeculativeDecoding", () => {
	it("declines when the output is too short to amortize draft setup", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: 0.9,
			expectedOutputTokens: 5,
			gpuVramGb: 24,
		});
		expect(decision.use).toBe(false);
		expect(decision.reason).toMatch(/too short/);
	});

	it("declines when measured acceptance is below the threshold", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: 0.3,
			expectedOutputTokens: 200,
			gpuVramGb: 24,
		});
		expect(decision.use).toBe(false);
		expect(decision.reason).toMatch(/below threshold/);
	});

	it("enables when measured acceptance clears the bar — even on a small 8GB GPU", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: 0.7,
			expectedOutputTokens: 200,
			gpuVramGb: 8,
		});
		expect(decision.use).toBe(true);
		expect(decision.reason).toMatch(/measured acceptance/);
	});

	it("treats acceptance exactly at the threshold as clearing the bar (inclusive)", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: 0.5,
			expectedOutputTokens: 200,
			gpuVramGb: 8,
		});
		expect(decision.use).toBe(true);
	});

	it("declines on unknown acceptance with <=8GB VRAM (commonly slower, don't gamble)", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: null,
			expectedOutputTokens: 200,
			gpuVramGb: 8,
		});
		expect(decision.use).toBe(false);
		expect(decision.reason).toMatch(/don't gamble/);
	});

	it("enables as an acceptable default on a big 24GB GPU with unknown acceptance + long output", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: null,
			expectedOutputTokens: 200,
			gpuVramGb: 24,
		});
		expect(decision.use).toBe(true);
		expect(decision.reason).toMatch(/acceptable default/);
	});

	it("enables as an acceptable default when VRAM is unknown (null) and the output is long enough", () => {
		const decision = shouldUseSpeculativeDecoding({
			measuredAcceptanceRate: null,
			expectedOutputTokens: 200,
			gpuVramGb: null,
		});
		expect(decision.use).toBe(true);
		expect(decision.reason).toMatch(/acceptable default/);
	});

	it("honors a custom minAcceptanceRate (raising the bar can flip a borderline rate to off)", () => {
		const base = {
			measuredAcceptanceRate: 0.6,
			expectedOutputTokens: 200,
			gpuVramGb: 24,
		};
		// 0.6 clears the default 0.5 bar...
		expect(shouldUseSpeculativeDecoding(base).use).toBe(true);
		// ...but not a stricter 0.8 bar.
		expect(shouldUseSpeculativeDecoding({ ...base, minAcceptanceRate: 0.8 }).use).toBe(false);
	});
});

describe("recommendKvCacheQuant", () => {
	it("recommends Q8 KV only when flash attention is on", () => {
		expect(recommendKvCacheQuant({ flashAttention: true })).toBe("q8");
	});

	it("recommends no KV quant without flash attention (quantized KV would be slower)", () => {
		expect(recommendKvCacheQuant({ flashAttention: false })).toBe("none");
	});
});

describe("recommendSampler", () => {
	it("maps tool and code work to the strict near-greedy profile", () => {
		expect(recommendSampler("tool")).toBe("tool_strict");
		expect(recommendSampler("code")).toBe("tool_strict");
	});

	it("maps reasoning to the balanced profile", () => {
		expect(recommendSampler("reasoning")).toBe("balanced");
	});

	it("maps creative work to the creative profile", () => {
		expect(recommendSampler("creative")).toBe("creative");
	});
});
