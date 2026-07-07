import { describe, expect, it } from "vitest";
import {
	CHAT_LEAN_WINDOW_FRACTION,
	MIN_CHAT_TOKEN_BUDGET,
	resolveChatTokenBudget,
} from "../../../src/chat/chat-token-budget";

describe("resolveChatTokenBudget (§5.M ≥32k-floor budget integration)", () => {
	it("resolves an unknown/null window to the ≥32k-floor-derived minimum (the old 8k default, made explicit)", () => {
		expect(MIN_CHAT_TOKEN_BUDGET).toBe(8000); // 32_000 × 0.25
		expect(resolveChatTokenBudget(null)).toBe(8000);
		expect(resolveChatTokenBudget(undefined)).toBe(8000);
		expect(resolveChatTokenBudget(0)).toBe(8000);
	});

	it("floors any sub-32k window to the 32k floor before taking the fraction (prime directive #3)", () => {
		expect(resolveChatTokenBudget(8_000)).toBe(8000); // floored to 32k → ×0.25
		expect(resolveChatTokenBudget(31_999)).toBe(8000);
		expect(resolveChatTokenBudget(32_000)).toBe(8000);
	});

	it("scales the verbatim window up proportionally for a larger context window", () => {
		expect(resolveChatTokenBudget(64_000)).toBe(16_000);
		expect(resolveChatTokenBudget(128_000)).toBe(32_000);
		expect(resolveChatTokenBudget(200_000)).toBe(50_000);
	});

	it("uses the documented fraction and truncates a fractional window", () => {
		expect(CHAT_LEAN_WINDOW_FRACTION).toBe(0.25);
		expect(resolveChatTokenBudget(100_000.9)).toBe(25_000);
	});
});
