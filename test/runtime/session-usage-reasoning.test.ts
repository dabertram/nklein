import { describe, expect, it } from "vitest";
import { readSessionUsage } from "../../src/nklein-agent/nklein-session-usage-parser";

/**
 * N18 — readSessionUsage now carries reasoning tokens. It takes the usage OBJECT directly (not the raw response
 * wrapper extractCompletionUsage wants), so the nesting level is different — and getting it wrong returns a
 * silent perpetual undefined. Last turn I made exactly that mistake one file over; these pin the level here.
 */

describe("readSessionUsage reasoning tokens", () => {
	it("reads the nested reasoning field from the usage object directly", () => {
		const usage = {
			inputTokens: 100,
			outputTokens: 400,
			completion_tokens_details: { reasoning_tokens: 250 },
		};
		expect(readSessionUsage(usage)?.reasoningTokens).toBe(250);
	});

	it("falls back to a top-level reasoning field", () => {
		expect(readSessionUsage({ inputTokens: 10, outputTokens: 20, reasoning_tokens: 7 })?.reasoningTokens).toBe(7);
	});

	it("OMITS reasoningTokens (undefined, not zero) when the server reports no breakdown", () => {
		// A non-reasoning model. undefined is 'did not say'; 0 would claim it did zero reasoning.
		const parsed = readSessionUsage({ inputTokens: 10, outputTokens: 20 });
		expect(parsed).not.toBeNull();
		expect(parsed?.reasoningTokens).toBeUndefined();
	});

	it("still returns null when input/output are missing — reasoning does not rescue an incomplete record", () => {
		expect(readSessionUsage({ reasoning_tokens: 5 })).toBeNull();
	});

	it("preserves the existing input/output/cache parsing", () => {
		const parsed = readSessionUsage({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 1 });
		expect(parsed).toMatchObject({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 1 });
	});
});
