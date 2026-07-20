import { describe, expect, it } from "vitest";
import {
	assessCacheEffectiveness,
	MIN_CACHEABLE_TOKENS,
	parsePromptEvalTiming,
} from "../../src/core/prompt-cache-verification";

describe("parsePromptEvalTiming", () => {
	it("parses llama.cpp's own line", () => {
		const timing = parsePromptEvalTiming(
			"prompt eval time =    1234.56 ms /   789 tokens (    1.56 ms per token,   639.12 tokens per second)",
		);
		expect(timing).toEqual({ milliseconds: 1234.56, tokens: 789 });
	});

	it("returns NULL on an unrecognised line, not a zero-filled record", () => {
		// A parse failure and a genuinely zero timing must not look alike: the first is a harness problem, the
		// second is a finding.
		expect(parsePromptEvalTiming("total time = 5000 ms")).toBeNull();
		expect(parsePromptEvalTiming("")).toBeNull();
	});

	it("handles the singular 'token'", () => {
		expect(parsePromptEvalTiming("prompt eval time = 10 ms / 1 token")?.tokens).toBe(1);
	});
});

const cold = { milliseconds: 4000, tokens: 1000 };

describe("assessCacheEffectiveness", () => {
	it("reports WORKING on a large speed-up over an identical prefix", () => {
		const result = assessCacheEffectiveness({ cold, warm: { milliseconds: 200, tokens: 1000 } });
		expect(result.verdict).toBe("working");
		expect(result.speedup).toBeCloseTo(20, 0);
	});

	it("reports NOT_WORKING when the warm prefill is within noise — the #15082 shape", () => {
		const result = assessCacheEffectiveness({ cold, warm: { milliseconds: 3900, tokens: 1000 } });
		expect(result.verdict).toBe("not_working");
		expect(result.reason).toContain("THE FLAG BEING SET IS NOT EVIDENCE");
	});

	it("treats a MISSING timing as indeterminate, never as working", () => {
		// Believing the cache works because nothing contradicted it is exactly the failure this exists to catch.
		for (const missing of [
			{ cold: null, warm: cold },
			{ cold, warm: null },
		]) {
			const result = assessCacheEffectiveness(missing);
			expect(result.verdict).toBe("indeterminate");
			expect(result.reason).toContain("#15082");
		}
	});

	it("refuses to judge a prefix too short to be cacheable", () => {
		const short = { milliseconds: 40, tokens: MIN_CACHEABLE_TOKENS - 1 };
		const result = assessCacheEffectiveness({ cold: short, warm: { ...short, milliseconds: 1 } });
		expect(result.verdict).toBe("indeterminate");
		expect(result.reason).toContain("says nothing about the build");
	});

	it("refuses when the two runs did not share a prefix", () => {
		// Any speed-up would measure the prompts rather than the cache.
		const result = assessCacheEffectiveness({ cold, warm: { milliseconds: 100, tokens: 500 } });
		expect(result.verdict).toBe("indeterminate");
		expect(result.reason).toContain("did not share a prefix");
	});

	it("treats a non-positive cold timing as a measurement fault, not a fast cache", () => {
		const result = assessCacheEffectiveness({
			cold: { milliseconds: 0, tokens: 1000 },
			warm: { milliseconds: 0, tokens: 1000 },
		});
		expect(result.verdict).toBe("indeterminate");
		expect(result.reason).toContain("measurement fault");
	});

	it("treats a ZERO warm prefill as the strongest hit, not a division error", () => {
		const result = assessCacheEffectiveness({ cold, warm: { milliseconds: 0, tokens: 1000 } });
		expect(result.verdict).toBe("working");
		expect(result.speedup).toBe(Number.POSITIVE_INFINITY);
		expect(result.reason).toContain("immeasurably");
	});

	it("errs toward indeterminate rather than success at the margin", () => {
		// A marginal speed-up is reported as not_working rather than working — being wrong about a broken cache
		// costs prefill time; being wrong about a working one costs an investigation that finds nothing.
		const marginal = assessCacheEffectiveness({ cold, warm: { milliseconds: 2100, tokens: 1000 } });
		expect(marginal.verdict).toBe("not_working");
	});
});
