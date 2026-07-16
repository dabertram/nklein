import { describe, expect, it } from "vitest";
import { extractCompletionUsage } from "../../../src/core/completion-usage";

describe("extractCompletionUsage", () => {
	it("reads prompt/completion tokens and derives answer = total − reasoning when the split is reported", () => {
		const usage = extractCompletionUsage({
			usage: {
				prompt_tokens: 100,
				completion_tokens: 500,
				completion_tokens_details: { reasoning_tokens: 300 },
			},
		});
		expect(usage).toEqual({
			promptTokens: 100,
			totalCompletionTokens: 500,
			reasoningTokens: 300,
			answerTokens: 200,
		});
	});

	it("leaves answerTokens null when reasoning is not reported (never guesses the split)", () => {
		const usage = extractCompletionUsage({ usage: { prompt_tokens: 10, completion_tokens: 40 } });
		expect(usage.totalCompletionTokens).toBe(40);
		expect(usage.reasoningTokens).toBeNull();
		expect(usage.answerTokens).toBeNull();
	});

	it("accepts a top-level usage.reasoning_tokens fallback", () => {
		const usage = extractCompletionUsage({ usage: { completion_tokens: 80, reasoning_tokens: 30 } });
		expect(usage.reasoningTokens).toBe(30);
		expect(usage.answerTokens).toBe(50);
	});

	it("returns all-null for a missing/!object/usage-less response (never throws)", () => {
		const empty = { promptTokens: null, totalCompletionTokens: null, reasoningTokens: null, answerTokens: null };
		expect(extractCompletionUsage(null)).toEqual(empty);
		expect(extractCompletionUsage("nope")).toEqual(empty);
		expect(extractCompletionUsage({ choices: [] })).toEqual(empty);
	});

	it("ignores non-numeric / negative counts", () => {
		const usage = extractCompletionUsage({ usage: { prompt_tokens: "x", completion_tokens: -5 } });
		expect(usage.promptTokens).toBeNull();
		expect(usage.totalCompletionTokens).toBeNull();
	});

	it("clamps a reasoning count that exceeds total to a non-negative answer", () => {
		const usage = extractCompletionUsage({
			usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 130 } },
		});
		expect(usage.answerTokens).toBe(0);
	});
});
