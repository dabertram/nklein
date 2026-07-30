import { describe, expect, it } from "vitest";
import { analysePrefillCost, type PrefillCostRecord } from "../../../src/core/prefill-cost-analysis";

/**
 * P17.6 — guards for the analysis that will decide whether KV-cache persistence is worth building.
 *
 * The number this core produces argues for or against an engine-level investment, so the tests are weighted
 * toward the ways it could produce a CONFIDENT WRONG figure rather than toward its happy path. The most
 * important one recovers coefficients that were planted: an arithmetic slip in the least-squares solve would
 * still return plausible-looking milliseconds, and nothing downstream could tell.
 */

function record(over: Partial<PrefillCostRecord> = {}): PrefillCostRecord {
	return { modelKey: "m1", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, durationMs: 1000, ...over };
}

/** Synthesise requests whose duration follows a KNOWN cost model, so the fit can be checked against truth. */
function syntheticRun(options: {
	msPerInput: number;
	msPerOutput: number;
	overhead: number;
	count?: number;
	cacheReadFraction?: number;
}): PrefillCostRecord[] {
	const count = options.count ?? 40;
	return Array.from({ length: count }, (_, index) => {
		// Vary BOTH dimensions independently, or the system is degenerate and no fit is possible.
		const inputTokens = 500 + index * 137;
		const outputTokens = 50 + ((index * 61) % 400);
		return {
			modelKey: "m1",
			inputTokens,
			outputTokens,
			cacheReadTokens: Math.round(inputTokens * (options.cacheReadFraction ?? 0)),
			durationMs: options.overhead + inputTokens * options.msPerInput + outputTokens * options.msPerOutput,
		};
	});
}

describe("analysePrefillCost", () => {
	it("RECOVERS a planted cost model — the check that the arithmetic is real", () => {
		// If the solve were wrong it would still return numbers, and a wrong ms/token silently rescales the whole
		// investment case. Planting known coefficients is the only way to catch that.
		const analysis = analysePrefillCost(syntheticRun({ msPerInput: 0.4, msPerOutput: 12, overhead: 250 }));
		const fit = analysis.byModel[0]?.fit;
		expect(fit, "a clean synthetic run must produce a fit").not.toBeNull();
		expect(fit?.msPerInputToken).toBeCloseTo(0.4, 4);
		expect(fit?.msPerOutputToken).toBeCloseTo(12, 4);
		expect(fit?.fixedOverheadMs).toBeCloseTo(250, 3);
	});

	it("models fixed overhead SEPARATELY, so it is not charged to prompt tokens", () => {
		// Without an intercept the per-request overhead folds into ms/input-token and inflates the prize. Two runs
		// with identical token costs but very different overheads must report the SAME cost per prompt token.
		const cheap = analysePrefillCost(syntheticRun({ msPerInput: 0.4, msPerOutput: 12, overhead: 10 }));
		const expensive = analysePrefillCost(syntheticRun({ msPerInput: 0.4, msPerOutput: 12, overhead: 5000 }));
		expect(cheap.byModel[0]?.fit?.msPerInputToken).toBeCloseTo(expensive.byModel[0]?.fit?.msPerInputToken ?? 0, 6);
	});

	it("prices the prize from UNCACHED prompt tokens only", () => {
		// Tokens the provider already served from its cache are work that is not being repeated; charging for them
		// would inflate the case for building a second cache.
		const analysis = analysePrefillCost(
			syntheticRun({ msPerInput: 0.5, msPerOutput: 10, overhead: 100, cacheReadFraction: 0.75 }),
		);
		const model = analysis.byModel[0];
		expect(model?.cacheHitRatio).toBeCloseTo(0.75, 2);
		expect(model?.uncachedInputTokens).toBe((model?.inputTokens ?? 0) - (model?.cacheReadTokens ?? 0));
		expect(model?.estimatedRecomputeMs).toBeCloseTo((model?.uncachedInputTokens ?? 0) * 0.5, 3);
	});

	it("REFUSES an estimate below the sample floor, and says why", () => {
		const analysis = analysePrefillCost(syntheticRun({ msPerInput: 0.4, msPerOutput: 12, overhead: 100, count: 5 }));
		expect(analysis.byModel[0]?.fit).toBeNull();
		expect(analysis.byModel[0]?.estimatedRecomputeMs).toBeNull();
		expect(analysis.byModel[0]?.estimateUnavailableReason).toContain("5 usable request(s)");
	});

	it("REFUSES when every request is the same shape — a degenerate system, not a measurement", () => {
		// Identical requests cannot separate prompt cost from completion cost. A naive solver would emit whatever
		// the pivoting happened to produce.
		const identical = Array.from({ length: 40 }, () => record());
		const analysis = analysePrefillCost(identical);
		expect(analysis.byModel[0]?.fit).toBeNull();
		expect(analysis.byModel[0]?.estimateUnavailableReason).toMatch(/uniform|degenerate/u);
	});

	it("REFUSES a physically impossible negative cost per prompt token", () => {
		// Noise can fit a negative slope. Reporting it would imply longer prompts are FASTER and would make the
		// prize negative — the analysis must decline instead.
		const noisy = Array.from({ length: 40 }, (_, index) => ({
			modelKey: "m1",
			inputTokens: 500 + index * 137,
			outputTokens: 50 + ((index * 61) % 400),
			cacheReadTokens: 0,
			// Duration FALLS as the prompt grows — the opposite of reality.
			durationMs: 20_000 - index * 300,
		}));
		const analysis = analysePrefillCost(noisy);
		expect(analysis.byModel[0]?.fit).toBeNull();
		expect(analysis.byModel[0]?.estimateUnavailableReason).toMatch(/non-positive|impossible/u);
	});

	it("never reports negative work when a provider over-reports cache reads", () => {
		// Clamped rather than trusted: a provider claiming more cached tokens than prompt tokens would otherwise
		// produce a negative prize, which reads as "persistence would cost us time".
		const analysis = analysePrefillCost([record({ inputTokens: 100, cacheReadTokens: 5000 })]);
		expect(analysis.byModel[0]?.uncachedInputTokens).toBe(0);
	});

	it("separates models and ranks by the size of the prize", () => {
		const analysis = analysePrefillCost([
			...syntheticRun({ msPerInput: 0.4, msPerOutput: 10, overhead: 100 }).map((entry) => ({
				...entry,
				modelKey: "small",
				inputTokens: 100,
			})),
			...syntheticRun({ msPerInput: 0.4, msPerOutput: 10, overhead: 100 }).map((entry) => ({
				...entry,
				modelKey: "large",
			})),
		]);
		expect(analysis.byModel.map((entry) => entry.modelKey)).toEqual(["large", "small"]);
	});

	it("labels a capped read as a SAMPLE so a floor is never presented as a total", () => {
		const sampled = analysePrefillCost(syntheticRun({ msPerInput: 0.4, msPerOutput: 10, overhead: 100 }), {
			sampled: true,
		});
		expect(sampled.sampled).toBe(true);
		expect(sampled.summary).toContain("floors");
		const census = analysePrefillCost(syntheticRun({ msPerInput: 0.4, msPerOutput: 10, overhead: 100 }));
		expect(census.summary).toContain("Every recorded request");
	});

	it("handles an empty feed without inventing a verdict", () => {
		const analysis = analysePrefillCost([]);
		expect(analysis.byModel).toEqual([]);
		expect(analysis.summary).toContain("No model requests");
	});
});
