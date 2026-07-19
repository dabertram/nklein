import { describe, expect, it } from "vitest";
import {
	CODEACT_FALLBACK_SIZE_B,
	CODEACT_FITNESS_BAR,
	CODEACT_HARD_FLOOR_B,
	decideCodeActOffer,
} from "../../src/core/codeact-gating";

const base = { role: "worker" as const, multiStep: true, observationCount: 20 };

describe("decideCodeActOffer", () => {
	it("offers when MEASURED fitness clears the bar", () => {
		const decision = decideCodeActOffer({ ...base, modelId: "qwen3-14b-q4_k_m", measuredFitness: 0.8 });
		expect(decision.kind).toBe("offer");
		expect(decision.weakBasis).toBe(false);
	});

	it("withholds when measured fitness is below the bar EVEN on a large model", () => {
		// The whole point of measuring: a big model that composes badly must not be handed CodeAct.
		const decision = decideCodeActOffer({ ...base, modelId: "big-70b-q4_k_m", measuredFitness: 0.3 });
		expect(decision.kind).toBe("withhold");
		expect(decision.weakBasis).toBe(false);
	});

	it("offers to a SMALLER model that measured well — size does not veto measurement", () => {
		// BFCL multi-turn is non-monotonic in size (Qwen3-8B 41.75 vs Qwen3-14B 34.75), so a 9B that measures
		// well is a better CodeAct candidate than a 40B that measures badly.
		const decision = decideCodeActOffer({ ...base, modelId: "qwen3-9b-q4_k_m", measuredFitness: 0.75 });
		expect(decision.kind).toBe("offer");
	});

	it("enforces the hard floor regardless of a flattering fitness score", () => {
		// Below ~7B the structure tax hurts outright; a high score on a tiny model is more likely a small sample.
		const decision = decideCodeActOffer({ ...base, modelId: "tiny-3b-q4_k_m", measuredFitness: 0.95 });
		expect(decision.kind).toBe("withhold");
		expect(decision.reason).toContain(`${CODEACT_HARD_FLOOR_B}B floor`);
	});

	it("withholds on a single-step card — composition has nothing to compose", () => {
		const decision = decideCodeActOffer({
			...base,
			modelId: "big-70b-q4_k_m",
			measuredFitness: 0.9,
			multiStep: false,
		});
		expect(decision.kind).toBe("withhold");
	});

	it("treats a thin measurement as UNMEASURED rather than as weak evidence", () => {
		const decision = decideCodeActOffer({
			...base,
			modelId: "qwen3-14b-q4_k_m",
			measuredFitness: 0.9,
			observationCount: 2,
		});
		// Falls to the size path (14B < 30B fallback) rather than trusting a 2-observation score.
		expect(decision.kind).toBe("withhold");
		expect(decision.weakBasis).toBe(true);
	});

	it("falls back to size when unmeasured, and FLAGS the basis as weak", () => {
		const decision = decideCodeActOffer({
			...base,
			modelId: "big-70b-q4_k_m",
			measuredFitness: null,
			observationCount: 0,
		});
		expect(decision.kind).toBe("offer");
		expect(decision.weakBasis).toBe(true);
		expect(decision.reason).toContain("WEAK BASIS");
	});

	it("withholds when capability is entirely unknown — unknown must not buy the offer", () => {
		// No measurement AND no readable size. CodeAct hurts models that cannot carry it.
		const decision = decideCodeActOffer({
			...base,
			modelId: "mystery-model",
			measuredFitness: null,
			observationCount: 0,
		});
		expect(decision.kind).toBe("withhold");
		expect(decision.weakBasis).toBe(true);
	});

	it("withholds an unmeasured mid-size model rather than guessing upward", () => {
		const decision = decideCodeActOffer({
			...base,
			modelId: "mid-14b-q4_k_m",
			measuredFitness: null,
			observationCount: 0,
		});
		expect(decision.kind).toBe("withhold");
		expect(decision.reason).toContain(`${CODEACT_FALLBACK_SIZE_B}B fallback`);
	});

	it("uses the documented bar constant", () => {
		const justUnder = decideCodeActOffer({
			...base,
			modelId: "m-14b-q4_k_m",
			measuredFitness: CODEACT_FITNESS_BAR - 0.01,
		});
		const atBar = decideCodeActOffer({ ...base, modelId: "m-14b-q4_k_m", measuredFitness: CODEACT_FITNESS_BAR });
		expect(justUnder.kind).toBe("withhold");
		expect(atBar.kind).toBe("offer");
	});

	it("never throws on junk input", () => {
		expect(() => decideCodeActOffer({ ...base, modelId: "", measuredFitness: Number.NaN })).not.toThrow();
	});
});
