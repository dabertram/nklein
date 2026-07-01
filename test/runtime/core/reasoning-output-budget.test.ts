import { describe, expect, it } from "vitest";
import {
	DEFAULT_REASONING_HEADROOM_MULTIPLIER,
	DEFAULT_REASONING_OVERHEAD_TOKENS,
	MIN_ANSWER_BUDGET_TOKENS,
	planReasoningOutputBudget,
	type ReasoningOutputBudgetInput,
} from "../../../src/core/reasoning-output-budget";

/** A resident REASONING model id (arch qwen3_5, always reasons; json_schema dead-ends — §5.AN live finding). */
const REASONER = "qwen3.5-9b-mlx";
/** A resident NON-reasoning model id (no reasoning channel). */
const NON_REASONER = "qwen2.5-coder-14b";

/** The reserve added for a reasoning model at the default overhead + default headroom multiplier. */
const DEFAULT_RESERVE = Math.ceil(DEFAULT_REASONING_OVERHEAD_TOKENS * DEFAULT_REASONING_HEADROOM_MULTIPLIER);

/** A base plan request, overridable per-case. */
function base(overrides: Partial<ReasoningOutputBudgetInput> = {}): ReasoningOutputBudgetInput {
	return {
		answerBudgetTokens: 512,
		modelId: REASONER,
		...overrides,
	};
}

describe("planReasoningOutputBudget", () => {
	describe("non-reasoning model — no reserve, never inflates", () => {
		it("returns total == answer budget for a recognized non-reasoning model id", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 512, modelId: NON_REASONER });
			expect(v.reason).toBe("no_reasoning_reserve");
			expect(v.reservedForReasoning).toBe(false);
			expect(v.reasoningReserveTokens).toBe(0);
			expect(v.answerBudgetTokens).toBe(512);
			expect(v.totalMaxTokens).toBe(512);
		});

		it("treats an absent model id + no override as non-reasoning (safe non-inflating default)", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 300 });
			expect(v.reason).toBe("no_reasoning_reserve");
			expect(v.totalMaxTokens).toBe(300);
			expect(v.reasoningReserveTokens).toBe(0);
		});

		it("treats an empty-string model id as non-reasoning", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 300, modelId: "" });
			expect(v.reason).toBe("no_reasoning_reserve");
			expect(v.totalMaxTokens).toBe(300);
		});

		it("treats an unrecognized model id as non-reasoning (isReasoningModel is a heuristic, not an allowlist)", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 256, modelId: "some-unknown-model-42b" });
			expect(v.reason).toBe("no_reasoning_reserve");
			expect(v.reasoningReserveTokens).toBe(0);
			expect(v.totalMaxTokens).toBe(256);
		});
	});

	describe("reasoning model — reserves room on top of the answer budget", () => {
		it("adds a headroom-scaled reserve for a recognized reasoning model id", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 512, modelId: REASONER });
			expect(v.reason).toBe("reasoning_reserve_added");
			expect(v.reservedForReasoning).toBe(true);
			expect(v.reasoningReserveTokens).toBe(DEFAULT_RESERVE);
			expect(v.answerBudgetTokens).toBe(512);
			// The whole point: the answer budget survives ON TOP of the reasoning burn.
			expect(v.totalMaxTokens).toBe(DEFAULT_RESERVE + 512);
			expect(v.totalMaxTokens).toBeGreaterThan(v.answerBudgetTokens);
		});

		it("reserves for the capable 27B reasoner too (reasoning FAMILY, not size — §5.AN)", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 400, modelId: "qwopus3.6-27b-v2-mlx" });
			expect(v.reason).toBe("reasoning_reserve_added");
			expect(v.reasoningReserveTokens).toBe(DEFAULT_RESERVE);
			expect(v.totalMaxTokens).toBe(DEFAULT_RESERVE + 400);
		});

		it("reserves for an R1 distill and a -reasoning tag", () => {
			for (const id of ["deepseek-r1-0528-qwen3-8b", "phi-4-mini-reasoning", "magistral-small"]) {
				const v = planReasoningOutputBudget({ answerBudgetTokens: 256, modelId: id });
				expect(v.reservedForReasoning).toBe(true);
				expect(v.totalMaxTokens).toBe(DEFAULT_RESERVE + 256);
			}
		});

		it("the default reserve sits in the live-observed 500–850 reasoning-token band, scaled by headroom", () => {
			// DEFAULT overhead 768 is inside [500,850]; the reserve is that × 1.25 headroom.
			expect(DEFAULT_REASONING_OVERHEAD_TOKENS).toBeGreaterThanOrEqual(500);
			expect(DEFAULT_REASONING_OVERHEAD_TOKENS).toBeLessThanOrEqual(850);
			expect(DEFAULT_RESERVE).toBe(960); // ceil(768 * 1.25)
		});
	});

	describe("explicit isReasoning override wins over the model id", () => {
		it("isReasoning:false suppresses the reserve even for a reasoning-family id (e.g. /no_think disabled thinking)", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 512, modelId: REASONER, isReasoning: false });
			expect(v.reason).toBe("no_reasoning_reserve");
			expect(v.reasoningReserveTokens).toBe(0);
			expect(v.totalMaxTokens).toBe(512);
		});

		it("isReasoning:true forces a reserve even for a non-reasoning id / no id", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 512, modelId: NON_REASONER, isReasoning: true });
			expect(v.reason).toBe("reasoning_reserve_added");
			expect(v.totalMaxTokens).toBe(DEFAULT_RESERVE + 512);

			const noId = planReasoningOutputBudget({ answerBudgetTokens: 128, isReasoning: true });
			expect(noId.reservedForReasoning).toBe(true);
			expect(noId.totalMaxTokens).toBe(DEFAULT_RESERVE + 128);
		});

		it("matches the model id case-insensitively (composes isReasoningModel)", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 100, modelId: "QWEN3.5-9B-MLX" });
			expect(v.reservedForReasoning).toBe(true);
		});
	});

	describe("custom reasoning overhead + headroom multiplier", () => {
		it("honors an injected per-model reasoning-overhead estimate", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 512,
				isReasoning: true,
				estimatedReasoningTokens: 400,
				reasoningHeadroomMultiplier: 1, // no cushion for an exact check
			});
			expect(v.reasoningReserveTokens).toBe(400);
			expect(v.totalMaxTokens).toBe(912);
		});

		it("applies the headroom multiplier only to the reserve, never to the answer budget", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 512,
				isReasoning: true,
				estimatedReasoningTokens: 800,
				reasoningHeadroomMultiplier: 2,
			});
			expect(v.reasoningReserveTokens).toBe(1_600); // 800 * 2
			expect(v.answerBudgetTokens).toBe(512); // untouched
			expect(v.totalMaxTokens).toBe(2_112);
		});

		it("rounds a fractional reserve UP (never under-reserves)", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 100,
				isReasoning: true,
				estimatedReasoningTokens: 501,
				reasoningHeadroomMultiplier: 1.25, // 626.25 -> ceil 627
			});
			expect(v.reasoningReserveTokens).toBe(627);
			expect(v.totalMaxTokens).toBe(727);
		});

		it("clamps a below-1 headroom multiplier up to 1 (a multiplier must never shrink the reserve)", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 100,
				isReasoning: true,
				estimatedReasoningTokens: 600,
				reasoningHeadroomMultiplier: 0.5,
			});
			expect(v.reasoningReserveTokens).toBe(600); // 600 * max(1, 0.5) == 600
		});

		it("a zero reasoning-overhead estimate yields a zero reserve even for a reasoning model", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 256,
				isReasoning: true,
				estimatedReasoningTokens: 0,
			});
			expect(v.reason).toBe("reasoning_reserve_added"); // it IS reasoning...
			expect(v.reasoningReserveTokens).toBe(0); // ...but the caller asserted no overhead
			expect(v.totalMaxTokens).toBe(256);
		});
	});

	describe("input coercion + defaults (pure + total)", () => {
		it("floors a below-minimum answer budget up to MIN_ANSWER_BUDGET_TOKENS", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 1, modelId: NON_REASONER });
			expect(v.answerBudgetTokens).toBe(MIN_ANSWER_BUDGET_TOKENS);
			expect(v.totalMaxTokens).toBe(MIN_ANSWER_BUDGET_TOKENS);
		});

		it("treats a zero / negative answer budget as the minimum", () => {
			expect(planReasoningOutputBudget({ answerBudgetTokens: 0 }).answerBudgetTokens).toBe(MIN_ANSWER_BUDGET_TOKENS);
			expect(planReasoningOutputBudget({ answerBudgetTokens: -100 }).answerBudgetTokens).toBe(
				MIN_ANSWER_BUDGET_TOKENS,
			);
		});

		it("floors a fractional answer budget to an integer", () => {
			const v = planReasoningOutputBudget({ answerBudgetTokens: 512.9, modelId: NON_REASONER });
			expect(v.answerBudgetTokens).toBe(512);
		});

		it("falls back to the default overhead for a non-finite / negative estimate", () => {
			const nan = planReasoningOutputBudget({
				answerBudgetTokens: 100,
				isReasoning: true,
				estimatedReasoningTokens: Number.NaN,
			});
			expect(nan.reasoningReserveTokens).toBe(DEFAULT_RESERVE);

			const neg = planReasoningOutputBudget({
				answerBudgetTokens: 100,
				isReasoning: true,
				estimatedReasoningTokens: -50,
			});
			// -50 -> coerced to 0 -> reserve 0.
			expect(neg.reasoningReserveTokens).toBe(0);
		});

		it("falls back to the default headroom multiplier for a non-finite multiplier", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 100,
				isReasoning: true,
				estimatedReasoningTokens: 800,
				reasoningHeadroomMultiplier: Number.POSITIVE_INFINITY,
			});
			expect(v.reasoningReserveTokens).toBe(Math.ceil(800 * DEFAULT_REASONING_HEADROOM_MULTIPLIER));
		});

		it("always returns a strictly-positive integer total and upholds total == reserve + answer", () => {
			const cases: ReasoningOutputBudgetInput[] = [
				{ answerBudgetTokens: 0 },
				{ answerBudgetTokens: -5, isReasoning: true },
				{ answerBudgetTokens: 512, modelId: REASONER },
				{ answerBudgetTokens: 1_000, modelId: NON_REASONER },
				{ answerBudgetTokens: 2_048, isReasoning: true, estimatedReasoningTokens: 1_500 },
			];
			for (const input of cases) {
				const v = planReasoningOutputBudget(input);
				expect(Number.isInteger(v.totalMaxTokens)).toBe(true);
				expect(v.totalMaxTokens).toBeGreaterThan(0);
				expect(v.totalMaxTokens).toBe(v.reasoningReserveTokens + v.answerBudgetTokens);
				expect(v.totalMaxTokens).toBeGreaterThanOrEqual(v.answerBudgetTokens);
			}
		});
	});

	describe("pipeline intent — the produced total is starvation-proof by construction", () => {
		it("total minus the whole reasoning reserve still leaves the full answer budget", () => {
			// This is the property that prevents the post-hoc reasoningStarvedBudget signal: even if the model spends the
			// ENTIRE reserve thinking, answerBudget tokens remain for the answer.
			const v = planReasoningOutputBudget(base({ answerBudgetTokens: 512 }));
			expect(v.totalMaxTokens - v.reasoningReserveTokens).toBe(512);
		});

		it("the reserve exceeds the raw overhead estimate by the headroom cushion (variance protection)", () => {
			const v = planReasoningOutputBudget({
				answerBudgetTokens: 256,
				isReasoning: true,
				estimatedReasoningTokens: 700,
			});
			expect(v.reasoningReserveTokens).toBeGreaterThan(700);
		});
	});
});
