import { describe, expect, it } from "vitest";
import {
	bestEnforcedReasoningKind,
	emptyEnforcedReasoningLearning,
	nativeReasoningQuality,
	recordEnforcedReasoning,
	recordNativeReasoning,
	shouldApplyEnforcedReasoning,
} from "../../../src/core/enforced-reasoning-learning";

describe("enforced-reasoning learning (§5.AD per-model)", () => {
	it("tracks native reasoning quality (6795)", () => {
		let l = emptyEnforcedReasoningLearning();
		expect(nativeReasoningQuality(l)).toBeNull(); // unsampled
		l = recordNativeReasoning(l, true);
		l = recordNativeReasoning(l, true);
		l = recordNativeReasoning(l, false);
		expect(l.nativeSamples).toBe(3);
		expect(nativeReasoningQuality(l)).toBeCloseTo(2 / 3, 5);
	});

	it("records the A/B help tally per enforcement kind (6796)", () => {
		let l = emptyEnforcedReasoningLearning();
		l = recordEnforcedReasoning(l, "self_consistency", true);
		l = recordEnforcedReasoning(l, "self_consistency", false);
		l = recordEnforcedReasoning(l, "cross_model", true);
		expect(l.byKind.self_consistency).toEqual({ helped: 1, hurt: 1 });
		expect(l.byKind.cross_model).toEqual({ helped: 1, hurt: 0 });
	});

	it("picks the kind with the best NET help (6797), requiring a strictly positive net", () => {
		let l = emptyEnforcedReasoningLearning();
		// self_consistency: net 0 (1 helped, 1 hurt) → not a winner.
		l = recordEnforcedReasoning(l, "self_consistency", true);
		l = recordEnforcedReasoning(l, "self_consistency", false);
		// cross_model: net +1 → the winner.
		l = recordEnforcedReasoning(l, "cross_model", true);
		l = recordEnforcedReasoning(l, "cross_model", true);
		expect(bestEnforcedReasoningKind(l)).toBe("cross_model");
	});

	it("returns null best-kind when no kind is net-positive", () => {
		let l = emptyEnforcedReasoningLearning();
		l = recordEnforcedReasoning(l, "carry", false);
		expect(bestEnforcedReasoningKind(l)).toBeNull();
	});

	describe("shouldApplyEnforcedReasoning (6799)", () => {
		it("SKIPS enforcement for a model reliably right on its own", () => {
			let l = emptyEnforcedReasoningLearning();
			for (let i = 0; i < 5; i += 1) {
				l = recordNativeReasoning(l, true); // 100% native quality over 5 samples
			}
			// Even with a helpful kind on record, high native quality suppresses it.
			l = recordEnforcedReasoning(l, "cross_model", true);
			const decision = shouldApplyEnforcedReasoning(l);
			expect(decision.apply).toBe(false);
			expect(decision.reason).toContain("reasons reliably on its own");
		});

		it("APPLIES the winning kind for a struggling model with a net-positive kind", () => {
			let l = emptyEnforcedReasoningLearning();
			// Low native quality.
			l = recordNativeReasoning(l, false);
			l = recordNativeReasoning(l, false);
			l = recordNativeReasoning(l, true);
			// cross_model nets positive.
			l = recordEnforcedReasoning(l, "cross_model", true);
			l = recordEnforcedReasoning(l, "cross_model", true);
			const decision = shouldApplyEnforcedReasoning(l);
			expect(decision).toMatchObject({ apply: true, kind: "cross_model" });
		});

		it("does not apply when no kind has shown a net benefit yet", () => {
			const l = emptyEnforcedReasoningLearning();
			expect(shouldApplyEnforcedReasoning(l)).toMatchObject({ apply: false, kind: null });
		});

		it("does not suppress on high native quality with too few samples", () => {
			let l = emptyEnforcedReasoningLearning();
			l = recordNativeReasoning(l, true); // 100% but only 1 sample (< default floor of 3)
			l = recordEnforcedReasoning(l, "self_consistency", true);
			expect(shouldApplyEnforcedReasoning(l)).toMatchObject({ apply: true, kind: "self_consistency" });
		});
	});
});
