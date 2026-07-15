import { describe, expect, it } from "vitest";
import { classifyOutputTruncation } from "../../../src/core/output-truncation-classification";

describe("classifyOutputTruncation (F4.12)", () => {
	it("a natural stop is never truncated", () => {
		const verdict = classifyOutputTruncation({
			hitLengthLimit: false,
			reasoningTokens: 5000,
			answerTokens: 100,
			reasoningBudget: 4000,
			answerBudget: 2000,
		});
		expect(verdict.truncated).toBe(false);
		expect(verdict.cause).toBe("none");
	});

	it("flags reasoning starving the answer (reasoning consumed, answer barely used)", () => {
		const verdict = classifyOutputTruncation({
			hitLengthLimit: true,
			reasoningTokens: 3900,
			answerTokens: 50,
			reasoningBudget: 4000,
			answerBudget: 2000,
		});
		expect(verdict.cause).toBe("reasoning_starved_answer");
		expect(verdict.reason).toContain("reasoning");
	});

	it("flags the answer hitting its own budget", () => {
		const verdict = classifyOutputTruncation({
			hitLengthLimit: true,
			reasoningTokens: 200,
			answerTokens: 1990,
			reasoningBudget: 4000,
			answerBudget: 2000,
		});
		expect(verdict.cause).toBe("answer_budget");
	});

	it("falls back to the total/provider ceiling when neither budget was consumed", () => {
		const verdict = classifyOutputTruncation({
			hitLengthLimit: true,
			reasoningTokens: 100,
			answerTokens: 100,
			reasoningBudget: 4000,
			answerBudget: 2000,
		});
		expect(verdict.cause).toBe("total_ceiling");
	});
});
