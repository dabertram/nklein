import { describe, expect, it } from "vitest";
import { retryLadderForOutcome } from "../../../src/core/retry-policy";
import {
	bestStrategyForOutcome,
	emptyStrategyEffectivenessLedger,
	orderLadderByEffectiveness,
	recordStrategyOutcome,
	type StrategyEffectivenessLedger,
	strategyEffectiveness,
	strategyObservationCount,
} from "../../../src/core/strategy-effectiveness-ledger";

/** Fold a batch of `count` identical observations into a ledger (helper for building up evidence). */
function recordMany(
	ledger: StrategyEffectivenessLedger,
	observation: Parameters<typeof recordStrategyOutcome>[1],
	count: number,
): StrategyEffectivenessLedger {
	let acc = ledger;
	for (let i = 0; i < count; i += 1) {
		acc = recordStrategyOutcome(acc, observation);
	}
	return acc;
}

describe("strategy-effectiveness-ledger", () => {
	describe("recordStrategyOutcome", () => {
		it("starts empty and folds one observation into a fresh cell without mutating the input", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			expect(empty.cells).toEqual({});

			const next = recordStrategyOutcome(empty, {
				outcome: "no_tool_call",
				strategy: "constrained_schema",
				recovered: true,
			});
			// input untouched (pure)
			expect(empty.cells).toEqual({});
			expect(next.cells["no_tool_call::constrained_schema"]).toEqual({
				outcome: "no_tool_call",
				strategy: "constrained_schema",
				attempts: 1,
				successes: 1,
			});
		});

		it("accumulates attempts + successes across observations for the same cell", () => {
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordStrategyOutcome(ledger, { outcome: "loop", strategy: "context_shrink", recovered: true });
			ledger = recordStrategyOutcome(ledger, { outcome: "loop", strategy: "context_shrink", recovered: false });
			ledger = recordStrategyOutcome(ledger, { outcome: "loop", strategy: "context_shrink", recovered: true });
			expect(ledger.cells["loop::context_shrink"]).toEqual({
				outcome: "loop",
				strategy: "context_shrink",
				attempts: 3,
				successes: 2,
			});
		});

		it("keys cells by (outcome, strategy) so the same rung under different failure modes stays separate", () => {
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordStrategyOutcome(ledger, {
				outcome: "no_tool_call",
				strategy: "reduced_tool_set",
				recovered: true,
			});
			ledger = recordStrategyOutcome(ledger, { outcome: "timeout", strategy: "reduced_tool_set", recovered: false });
			expect(strategyObservationCount(ledger, "no_tool_call", "reduced_tool_set")).toBe(1);
			expect(strategyObservationCount(ledger, "timeout", "reduced_tool_set")).toBe(1);
			expect(ledger.cells["no_tool_call::reduced_tool_set"]?.successes).toBe(1);
			expect(ledger.cells["timeout::reduced_tool_set"]?.successes).toBe(0);
		});

		it("no-ops on a `park` rung and on a `success` outcome (neither is a learnable remedy)", () => {
			const base = emptyStrategyEffectivenessLedger("modelA");
			const afterPark = recordStrategyOutcome(base, { outcome: "no_tool_call", strategy: "park", recovered: false });
			const afterSuccess = recordStrategyOutcome(base, {
				outcome: "success",
				strategy: "constrained_schema",
				recovered: true,
			});
			expect(afterPark.cells).toEqual({});
			expect(afterSuccess.cells).toEqual({});
		});

		it("advances updatedAt via the injected clock (deterministic)", () => {
			const base = emptyStrategyEffectivenessLedger("modelA", 100);
			const next = recordStrategyOutcome(
				base,
				{ outcome: "loop", strategy: "same_model_retry", recovered: true },
				{ now: () => 250 },
			);
			expect(next.updatedAt).toBe(250);
			// even a no-op observation refreshes the clock (the store was touched)
			const noop = recordStrategyOutcome(
				base,
				{ outcome: "no_tool_call", strategy: "park", recovered: false },
				{ now: () => 999 },
			);
			expect(noop.updatedAt).toBe(999);
			expect(noop.cells).toEqual({});
		});
	});

	describe("strategyEffectiveness (Beta-posterior / Laplace-smoothed)", () => {
		it("returns the neutral prior mean 0.5 for an unobserved cell", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			expect(strategyEffectiveness(empty, "no_tool_call", "constrained_schema")).toBe(0.5);
		});

		it("smooths a single lucky observation away from 1.0 (Beta(1,1): 2/3)", () => {
			const ledger = recordStrategyOutcome(emptyStrategyEffectivenessLedger("modelA"), {
				outcome: "no_tool_call",
				strategy: "constrained_schema",
				recovered: true,
			});
			// (1 success + 1 prior) / (1 attempt + 2 prior) = 2/3
			expect(strategyEffectiveness(ledger, "no_tool_call", "constrained_schema")).toBeCloseTo(2 / 3, 10);
		});

		it("smooths a single unlucky observation away from 0.0 (Beta(1,1): 1/3)", () => {
			const ledger = recordStrategyOutcome(emptyStrategyEffectivenessLedger("modelA"), {
				outcome: "no_tool_call",
				strategy: "alternate_endpoint",
				recovered: false,
			});
			// (0 + 1) / (1 + 2) = 1/3
			expect(strategyEffectiveness(ledger, "no_tool_call", "alternate_endpoint")).toBeCloseTo(1 / 3, 10);
		});

		it("converges toward the empirical rate as evidence accumulates", () => {
			// 9 recoveries / 1 failure → empirical 0.9; posterior (9+1)/(10+2) = 10/12 ≈ 0.833, closer to 0.9 than the prior
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordMany(ledger, { outcome: "narrated", strategy: "constrained_schema", recovered: true }, 9);
			ledger = recordStrategyOutcome(ledger, {
				outcome: "narrated",
				strategy: "constrained_schema",
				recovered: false,
			});
			expect(strategyEffectiveness(ledger, "narrated", "constrained_schema")).toBeCloseTo(10 / 12, 10);
		});

		it("honors custom prior pseudo-counts", () => {
			const ledger = recordStrategyOutcome(emptyStrategyEffectivenessLedger("modelA"), {
				outcome: "malformed",
				strategy: "constrained_schema",
				recovered: true,
			});
			// prior 2/2 → (1+2)/(1+4) = 3/5
			expect(
				strategyEffectiveness(ledger, "malformed", "constrained_schema", {
					priorSuccesses: 2,
					priorFailures: 2,
				}),
			).toBeCloseTo(3 / 5, 10);
		});

		it("stays within [0,1] even with zero priors and no observations", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			const eff = strategyEffectiveness(empty, "timeout", "decompose", { priorSuccesses: 0, priorFailures: 0 });
			expect(eff).toBeGreaterThanOrEqual(0);
			expect(eff).toBeLessThanOrEqual(1);
		});
	});

	describe("orderLadderByEffectiveness", () => {
		it("returns the curated order verbatim at cold-start (no evidence)", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			expect(orderLadderByEffectiveness(empty, "no_tool_call")).toEqual([...retryLadderForOutcome("no_tool_call")]);
		});

		it("promotes a repeatedly-effective lower rung ahead of a repeatedly-failing higher rung", () => {
			// no_tool_call curated: reduced_tool_set, constrained_schema, alternate_endpoint, prompt_variant, cross_model_carry
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			// reduced_tool_set (curated #0) keeps flopping on this model
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: false }, 6);
			// constrained_schema (curated #1) keeps rescuing it
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "constrained_schema", recovered: true }, 6);
			const ordered = orderLadderByEffectiveness(ledger, "no_tool_call");
			expect(ordered[0]).toBe("constrained_schema");
			expect(ordered.indexOf("constrained_schema")).toBeLessThan(ordered.indexOf("reduced_tool_set"));
			// still the same set — nothing added or dropped
			expect([...ordered].sort()).toEqual([...retryLadderForOutcome("no_tool_call")].sort());
		});

		it("keeps curated order when the learned advantage is below the reorder margin", () => {
			// constrained_schema slightly better than reduced_tool_set but under a big margin → curated order stands
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: true }, 4);
			ledger = recordStrategyOutcome(ledger, {
				outcome: "no_tool_call",
				strategy: "reduced_tool_set",
				recovered: false,
			});
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "constrained_schema", recovered: true }, 5);
			const ordered = orderLadderByEffectiveness(ledger, "no_tool_call", { reorderMargin: 0.5 });
			expect(ordered).toEqual([...retryLadderForOutcome("no_tool_call")]);
		});

		it("does not let a rung below minObservations reorder, but does once it clears the bar", () => {
			// constrained_schema (curated #1) has just ONE lucky observation. reduced_tool_set (curated #0) has none. With
			// minObservations=2 constrained_schema's lone observation is NOT trusted → both sit at the neutral prior → the
			// curated order (reduced_tool_set before constrained_schema) is preserved.
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordStrategyOutcome(ledger, {
				outcome: "no_tool_call",
				strategy: "constrained_schema",
				recovered: true,
			});
			const guarded = orderLadderByEffectiveness(ledger, "no_tool_call", { minObservations: 2 });
			expect(guarded.indexOf("reduced_tool_set")).toBeLessThan(guarded.indexOf("constrained_schema"));

			// Give it enough observations to clear the bar (and reduced_tool_set proven-bad evidence) → it DOES reorder.
			let strong = emptyStrategyEffectivenessLedger("modelA");
			strong = recordMany(strong, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: false }, 5);
			strong = recordMany(strong, { outcome: "no_tool_call", strategy: "constrained_schema", recovered: true }, 3);
			const promoted = orderLadderByEffectiveness(strong, "no_tool_call", { minObservations: 2 });
			expect(promoted.indexOf("constrained_schema")).toBeLessThan(promoted.indexOf("reduced_tool_set"));
		});

		it("preserves a stable order among rungs with equal effectiveness (curated tie-break)", () => {
			// give two rungs identical strong evidence; their relative order must match the curated ladder
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: true }, 5);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "constrained_schema", recovered: true }, 5);
			const ordered = orderLadderByEffectiveness(ledger, "no_tool_call");
			expect(ordered.indexOf("reduced_tool_set")).toBeLessThan(ordered.indexOf("constrained_schema"));
		});

		it("bug-hunt 2026-07-05: a sub-margin CHAIN spanning the margin still promotes the clearly-best rung (transitive order)", () => {
			// The pre-fix pairwise-margin comparator was intransitive: with effectiveness forming a chain where each
			// adjacent pair is within the margin but the ENDS span it, Array.sort left the ladder unsorted and the head
			// stayed on the worst rung. Encode exactly that: no_tool_call curated [reduced_tool_set(#0),
			// constrained_schema(#1), alternate_endpoint(#2), ...]. Beta mean = (successes+1)/(attempts+2):
			//   reduced_tool_set  3/6  → 4/8   = 0.500 → bucket floor(0.500/0.05)=10
			//   constrained_schema 6/11 → 7/13 ≈ 0.538 → bucket 10  (gap vs reduced 0.038 < 0.05)
			//   alternate_endpoint 4/7  → 5/9  ≈ 0.556 → bucket 11  (gap vs constrained 0.018 < 0.05; vs reduced 0.056 ≥ 0.05)
			// So reduced~constrained and constrained~alternate are each sub-margin, but reduced<alternate clears it.
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: true }, 3);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: false }, 3);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "constrained_schema", recovered: true }, 6);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "constrained_schema", recovered: false }, 5);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "alternate_endpoint", recovered: true }, 4);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "alternate_endpoint", recovered: false }, 3);
			const ordered = orderLadderByEffectiveness(ledger, "no_tool_call");
			// The genuinely-most-effective rung (alternate_endpoint, 0.556, clears the margin over reduced by 0.056) MUST
			// lead — pre-fix it stayed behind reduced_tool_set (0.500) because the intransitive chain left sort a no-op.
			expect(ordered[0]).toBe("alternate_endpoint");
			expect(bestStrategyForOutcome(ledger, "no_tool_call")).toBe("alternate_endpoint");
			// Sub-margin pair keeps curated order (reduced #0 before constrained #1); set preserved.
			expect(ordered.indexOf("reduced_tool_set")).toBeLessThan(ordered.indexOf("constrained_schema"));
			expect([...ordered].sort()).toEqual([...retryLadderForOutcome("no_tool_call")].sort());
		});

		it("returns an empty ladder for `success` (no remedy rungs)", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			expect(orderLadderByEffectiveness(empty, "success")).toEqual([]);
		});

		it("learning for one failure mode does not perturb another mode's ladder", () => {
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			// heavily train timeout rungs; no_tool_call must stay curated
			ledger = recordMany(ledger, { outcome: "timeout", strategy: "decompose", recovered: true }, 8);
			expect(orderLadderByEffectiveness(ledger, "no_tool_call")).toEqual([...retryLadderForOutcome("no_tool_call")]);
		});
	});

	describe("bestStrategyForOutcome", () => {
		it("returns the curated first rung at cold-start", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			expect(bestStrategyForOutcome(empty, "no_tool_call")).toBe(retryLadderForOutcome("no_tool_call")[0]);
		});

		it("returns the learned-best rung once evidence favors it", () => {
			let ledger = emptyStrategyEffectivenessLedger("modelA");
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "reduced_tool_set", recovered: false }, 6);
			ledger = recordMany(ledger, { outcome: "no_tool_call", strategy: "prompt_variant", recovered: true }, 6);
			expect(bestStrategyForOutcome(ledger, "no_tool_call")).toBe("prompt_variant");
		});

		it("returns null for a failure mode with no remedy rungs", () => {
			const empty = emptyStrategyEffectivenessLedger("modelA");
			expect(bestStrategyForOutcome(empty, "success")).toBeNull();
		});
	});
});
