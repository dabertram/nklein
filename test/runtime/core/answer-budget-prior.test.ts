import { describe, expect, it } from "vitest";
import { answerBudgetPrior } from "../../../src/core/answer-budget-prior";

const WINDOW = 40_000; // the ≥32k-floor context the resident tier runs at

describe("answerBudgetPrior (§5.AD proactive up-front sizing)", () => {
	it("a non-reasoning model adds no reasoning headroom — just the task-class answer size", () => {
		const prior = answerBudgetPrior({
			reasoning: false,
			taskClass: "single_tool",
			outputMode: "free_generation",
			contextWindow: WINDOW,
			inputTokens: 2000,
		});
		expect(prior.reasoningHeadroom).toBe(0);
		expect(prior.answerSize).toBe(512);
		expect(prior.maxTokens).toBe(512);
		expect(prior.clampedToWindow).toBe(false);
	});

	it("a reasoning model adds the task-scaled reasoning headroom on top of the answer size", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "single_tool",
			outputMode: "free_generation",
			contextWindow: WINDOW,
			inputTokens: 2000,
		});
		// answer 512 + reasoning 768 = 1280 (the fixed 1024 would have truncated this reasoning turn).
		expect(prior.reasoningHeadroom).toBe(768);
		expect(prior.maxTokens).toBe(1280);
	});

	it("a forced native tool call is cheap: small answer, ZERO reasoning headroom, even for a reasoning model", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "multi_tool",
			outputMode: "forced_tool_call",
			contextWindow: WINDOW,
			inputTokens: 2000,
		});
		expect(prior.reasoningHeadroom).toBe(0);
		expect(prior.answerSize).toBe(256);
		expect(prior.maxTokens).toBe(256);
		expect(prior.reason).toContain("forced tool call");
	});

	it("a decomposition turn on a reasoning model gets a large budget (plan output + heavy reasoning)", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "decomposition",
			outputMode: "free_generation",
			contextWindow: WINDOW,
			inputTokens: 3000,
		});
		expect(prior.maxTokens).toBe(2048 + 1792);
	});

	it("a structured-output turn keeps the reasoning headroom for a reasoning model (§5.AN)", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "multi_tool",
			outputMode: "structured",
			contextWindow: WINDOW,
			inputTokens: 2000,
		});
		expect(prior.reasoningHeadroom).toBe(1280);
		expect(prior.maxTokens).toBe(1024 + 1280);
	});

	it("a learned per-model reasoning burn OVERRIDES the task-scaled default", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "multi_tool",
			outputMode: "free_generation",
			contextWindow: WINDOW,
			inputTokens: 2000,
			learnedReasoningTokens: 3000,
		});
		expect(prior.reasoningHeadroom).toBe(3000);
		expect(prior.maxTokens).toBe(1024 + 3000);
	});

	it("clamps so inputTokens + maxTokens never exceed the window", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "long_generation", // wants 4096 + 2560 = 6656
			outputMode: "free_generation",
			contextWindow: 32_768,
			inputTokens: 32_000, // only 768 of headroom left
		});
		expect(prior.maxTokens).toBe(768);
		expect(prior.clampedToWindow).toBe(true);
		expect(prior.reason).toContain("clamped");
	});

	it("never sizes below minBudget (custom floor honoured before the window clamp)", () => {
		const prior = answerBudgetPrior({
			reasoning: false,
			taskClass: "trivial_reply", // answer 256
			outputMode: "free_generation",
			contextWindow: WINDOW,
			inputTokens: 1000,
			minBudget: 1000,
		});
		expect(prior.maxTokens).toBe(1000);
	});

	it("when the input already fills the window there is no room to grant (maxTokens 0, clamped)", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "single_tool",
			outputMode: "free_generation",
			contextWindow: 32_768,
			inputTokens: 32_768,
		});
		expect(prior.maxTokens).toBe(0);
		expect(prior.clampedToWindow).toBe(true);
	});

	it("treats a non-positive window as unbounded (no clamp — caller supplies the real window)", () => {
		const prior = answerBudgetPrior({
			reasoning: true,
			taskClass: "multi_tool",
			outputMode: "free_generation",
			contextWindow: 0,
			inputTokens: 5000,
		});
		expect(prior.maxTokens).toBe(1024 + 1280);
		expect(prior.clampedToWindow).toBe(false);
	});
});
