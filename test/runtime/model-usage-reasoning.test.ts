import { describe, expect, it } from "vitest";
import { extractCompletionUsage } from "../../src/core/completion-usage";

/**
 * N18 — the per-turn model_usage observation stamps reasoning tokens using the SAME established wire spelling as
 * F4.12's truncation path (`completion_tokens_details.reasoning_tokens`, top-level fallback), NOT a guessed one.
 * The honest null matters: "the server did not report reasoning" is a different fact from "zero reasoning", and a
 * reader tuning reasoning budgets must be able to tell them apart.
 */

describe("model_usage reasoning-token extraction", () => {
	it("reads the OpenAI-style nested reasoning field", () => {
		const raw = {
			usage: {
				prompt_tokens: 100,
				completion_tokens: 400,
				completion_tokens_details: { reasoning_tokens: 250 },
			},
		};
		expect(extractCompletionUsage(raw).reasoningTokens).toBe(250);
	});

	it("falls back to a top-level reasoning field", () => {
		expect(extractCompletionUsage({ usage: { reasoning_tokens: 42 } }).reasoningTokens).toBe(42);
	});

	it("is NULL — not zero — when the server reports no reasoning breakdown", () => {
		// A non-reasoning model reports usage without any reasoning field. Recording 0 would claim the model did
		// zero reasoning; null records that it did not say. The metadata carries null, deliberately.
		expect(
			extractCompletionUsage({ usage: { prompt_tokens: 10, completion_tokens: 20 } }).reasoningTokens,
		).toBeNull();
	});

	it("is null on absent usage entirely", () => {
		expect(extractCompletionUsage(undefined).reasoningTokens).toBeNull();
	});

	it("takes the RAW result, not the usage object — the shape mistake this caught", () => {
		// I first called extractCompletionUsage(result.usage) instead of extractCompletionUsage(result). The
		// function reads `.usage` itself, so passing the usage object directly makes it look one level too deep and
		// return null forever — a silent perpetual null dressed as "no reasoning reported". This pins the shape.
		const rawWithReasoning = { usage: { completion_tokens_details: { reasoning_tokens: 7 } } };
		expect(extractCompletionUsage(rawWithReasoning).reasoningTokens).toBe(7);
		// The usage object passed directly (the mistake) reads as empty.
		expect(extractCompletionUsage(rawWithReasoning.usage).reasoningTokens).toBeNull();
	});
});
