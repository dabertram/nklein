import { describe, expect, it } from "vitest";
import {
	clampMaxTokens,
	DEFAULT_MIN_OUTPUT_TOKENS,
	DEFAULT_SAFETY_RESERVE_TOKENS,
	type MaxTokensClampInput,
} from "../../../src/core/lmstudio-max-tokens-clamp";

/** The ≥32k floor a well-formed loaded window meets (prime directive #3). */
const FLOOR = 32_000;

/** A base request with plenty of room, overridable per-case. */
function base(overrides: Partial<MaxTokensClampInput> = {}): MaxTokensClampInput {
	return {
		promptTokens: 4_000,
		contextWindow: FLOOR,
		desiredMaxTokens: 2_048,
		...overrides,
	};
}

describe("clampMaxTokens", () => {
	describe("the desired budget fits", () => {
		it("returns the desired budget unchanged when it fits under the window", () => {
			const v = clampMaxTokens(base({ promptTokens: 4_000, contextWindow: FLOOR, desiredMaxTokens: 2_048 }));
			expect(v.reason).toBe("fits");
			expect(v.maxTokens).toBe(2_048);
			expect(v.shouldCompact).toBe(false);
			// 32000 - 4000 - 256 reserve = 27744 of headroom, far above the 2048 asked for.
			expect(v.availableOutputTokens).toBe(FLOOR - 4_000 - DEFAULT_SAFETY_RESERVE_TOKENS);
		});

		it("upholds the invariant promptTokens + maxTokens <= contextWindow when it fits", () => {
			const v = clampMaxTokens({ promptTokens: 10_000, contextWindow: FLOOR, desiredMaxTokens: 8_000 });
			expect(v.reason).toBe("fits");
			expect(10_000 + v.maxTokens).toBeLessThanOrEqual(FLOOR);
		});

		it("raises a below-minimum desired budget up to the floor but still reports 'fits'", () => {
			const v = clampMaxTokens(base({ desiredMaxTokens: 4 }));
			expect(v.reason).toBe("fits");
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
			expect(v.shouldCompact).toBe(false);
		});

		it("treats a zero desired budget as 'give me the minimum' (still fits)", () => {
			const v = clampMaxTokens(base({ desiredMaxTokens: 0 }));
			expect(v.reason).toBe("fits");
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
		});
	});

	describe("the desired budget is clamped down to the window", () => {
		it("clamps an over-ambitious budget to the largest that still fits", () => {
			// 32000 - 20000 - 256 = 11744 available; asking for 30000 must clamp to 11744.
			const v = clampMaxTokens({ promptTokens: 20_000, contextWindow: FLOOR, desiredMaxTokens: 30_000 });
			expect(v.reason).toBe("clamped_to_window");
			expect(v.maxTokens).toBe(FLOOR - 20_000 - DEFAULT_SAFETY_RESERVE_TOKENS);
			expect(v.availableOutputTokens).toBe(v.maxTokens);
			expect(v.shouldCompact).toBe(false);
			expect(20_000 + v.maxTokens).toBeLessThanOrEqual(FLOOR);
		});

		it("clamped result exactly saturates the window minus the reserve", () => {
			const v = clampMaxTokens({ promptTokens: 8_000, contextWindow: FLOOR, desiredMaxTokens: 1_000_000 });
			expect(v.reason).toBe("clamped_to_window");
			// prompt + maxTokens + reserve == window exactly at the ceiling.
			expect(8_000 + v.maxTokens + DEFAULT_SAFETY_RESERVE_TOKENS).toBe(FLOOR);
		});

		it("a desired budget exactly equal to the available ceiling still 'fits' (boundary, not clamped)", () => {
			const available = FLOOR - 8_000 - DEFAULT_SAFETY_RESERVE_TOKENS;
			const v = clampMaxTokens({ promptTokens: 8_000, contextWindow: FLOOR, desiredMaxTokens: available });
			expect(v.reason).toBe("fits");
			expect(v.maxTokens).toBe(available);
		});

		it("a desired budget one over the ceiling is clamped", () => {
			const available = FLOOR - 8_000 - DEFAULT_SAFETY_RESERVE_TOKENS;
			const v = clampMaxTokens({ promptTokens: 8_000, contextWindow: FLOOR, desiredMaxTokens: available + 1 });
			expect(v.reason).toBe("clamped_to_window");
			expect(v.maxTokens).toBe(available);
		});
	});

	describe("the prompt exhausts the window (compact, don't bump)", () => {
		it("flags shouldCompact + returns the minimum budget when the prompt fills the window", () => {
			// prompt alone = window: no room for output.
			const v = clampMaxTokens({ promptTokens: FLOOR, contextWindow: FLOOR, desiredMaxTokens: 2_048 });
			expect(v.reason).toBe("prompt_exhausts_window");
			expect(v.shouldCompact).toBe(true);
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
			expect(v.availableOutputTokens).toBe(0);
		});

		it("flags shouldCompact when the prompt OVERFLOWS the window", () => {
			const v = clampMaxTokens({ promptTokens: FLOOR + 5_000, contextWindow: FLOOR, desiredMaxTokens: 2_048 });
			expect(v.reason).toBe("prompt_exhausts_window");
			expect(v.shouldCompact).toBe(true);
			expect(v.availableOutputTokens).toBe(0);
		});

		it("flags shouldCompact when only the reserve pushes it over the edge", () => {
			// Room before reserve is minOutput-1, so after subtracting nothing it's still < minOutput -> compact.
			const v = clampMaxTokens({
				promptTokens: FLOOR - (DEFAULT_MIN_OUTPUT_TOKENS - 1),
				contextWindow: FLOOR,
				desiredMaxTokens: 2_048,
				safetyReserveTokens: 0,
			});
			expect(v.reason).toBe("prompt_exhausts_window");
			expect(v.availableOutputTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS - 1);
		});

		it("does NOT compact when the remaining room is exactly the minimum output", () => {
			const v = clampMaxTokens({
				promptTokens: FLOOR - DEFAULT_MIN_OUTPUT_TOKENS,
				contextWindow: FLOOR,
				desiredMaxTokens: 2_048,
				safetyReserveTokens: 0,
			});
			expect(v.reason).toBe("clamped_to_window");
			expect(v.shouldCompact).toBe(false);
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
		});
	});

	describe("safety reserve", () => {
		it("subtracts the default reserve from the available window", () => {
			const v = clampMaxTokens({ promptTokens: 0, contextWindow: 10_000, desiredMaxTokens: 1_000_000 });
			expect(v.availableOutputTokens).toBe(10_000 - DEFAULT_SAFETY_RESERVE_TOKENS);
			expect(v.maxTokens).toBe(10_000 - DEFAULT_SAFETY_RESERVE_TOKENS);
		});

		it("honors a custom reserve", () => {
			const v = clampMaxTokens({
				promptTokens: 1_000,
				contextWindow: FLOOR,
				desiredMaxTokens: 1_000_000,
				safetyReserveTokens: 4_000,
			});
			expect(v.maxTokens).toBe(FLOOR - 1_000 - 4_000);
		});

		it("a zero reserve uses the whole window for output", () => {
			const v = clampMaxTokens({
				promptTokens: 1_000,
				contextWindow: FLOOR,
				desiredMaxTokens: 1_000_000,
				safetyReserveTokens: 0,
			});
			expect(v.maxTokens).toBe(FLOOR - 1_000);
		});

		it("a negative reserve is coerced to zero (never grows the window)", () => {
			const v = clampMaxTokens({
				promptTokens: 1_000,
				contextWindow: FLOOR,
				desiredMaxTokens: 1_000_000,
				safetyReserveTokens: -500,
			});
			expect(v.maxTokens).toBe(FLOOR - 1_000);
		});
	});

	describe("minimum output override", () => {
		it("honors a custom minimum floor for the 'fits' path", () => {
			const v = clampMaxTokens({
				promptTokens: 100,
				contextWindow: FLOOR,
				desiredMaxTokens: 1,
				minOutputTokens: 64,
			});
			expect(v.reason).toBe("fits");
			expect(v.maxTokens).toBe(64);
		});

		it("uses the custom minimum as the exhausted-window floor", () => {
			const v = clampMaxTokens({
				promptTokens: FLOOR,
				contextWindow: FLOOR,
				desiredMaxTokens: 2_048,
				minOutputTokens: 100,
			});
			expect(v.reason).toBe("prompt_exhausts_window");
			expect(v.maxTokens).toBe(100);
		});

		it("coerces a zero/negative minimum up to 1 (a request cannot ask for max_tokens:0)", () => {
			const v = clampMaxTokens({
				promptTokens: FLOOR,
				contextWindow: FLOOR,
				desiredMaxTokens: 0,
				minOutputTokens: 0,
			});
			expect(v.maxTokens).toBe(1);
			expect(v.maxTokens).toBeGreaterThan(0);
		});
	});

	describe("large / real windows", () => {
		it("handles a 262k window with a small prompt (huge output headroom, clamped to it)", () => {
			const v = clampMaxTokens({ promptTokens: 2_000, contextWindow: 262_144, desiredMaxTokens: 500_000 });
			expect(v.reason).toBe("clamped_to_window");
			expect(v.maxTokens).toBe(262_144 - 2_000 - DEFAULT_SAFETY_RESERVE_TOKENS);
			expect(2_000 + v.maxTokens).toBeLessThanOrEqual(262_144);
		});

		it("a typical 40k-loaded window (the §5.AN default) with a mid prompt returns the desired budget", () => {
			const v = clampMaxTokens({ promptTokens: 12_000, contextWindow: 40_000, desiredMaxTokens: 4_096 });
			expect(v.reason).toBe("fits");
			expect(v.maxTokens).toBe(4_096);
			expect(12_000 + v.maxTokens).toBeLessThanOrEqual(40_000);
		});
	});

	describe("degenerate / defensive inputs", () => {
		it("a sub-floor (misconfigured) window still yields a physically-safe budget, never fabricated room", () => {
			// A window below the ≥32k floor should have been gated upstream; if it slips through we still never
			// overflow it: prompt + maxTokens <= window.
			const v = clampMaxTokens({ promptTokens: 5_000, contextWindow: 8_000, desiredMaxTokens: 4_096 });
			expect(v.availableOutputTokens).toBe(8_000 - 5_000 - DEFAULT_SAFETY_RESERVE_TOKENS);
			expect(5_000 + v.maxTokens).toBeLessThanOrEqual(8_000);
		});

		it("a zero context window forces compaction (no room at all)", () => {
			const v = clampMaxTokens({ promptTokens: 0, contextWindow: 0, desiredMaxTokens: 2_048 });
			expect(v.reason).toBe("prompt_exhausts_window");
			expect(v.availableOutputTokens).toBe(0);
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
		});

		it("negative prompt tokens are coerced to zero", () => {
			const v = clampMaxTokens({ promptTokens: -100, contextWindow: FLOOR, desiredMaxTokens: 1_000_000 });
			expect(v.maxTokens).toBe(FLOOR - DEFAULT_SAFETY_RESERVE_TOKENS);
		});

		it("fractional inputs are floored to integers (max_tokens is always an integer)", () => {
			const v = clampMaxTokens({ promptTokens: 4_000.9, contextWindow: FLOOR, desiredMaxTokens: 2_048.7 });
			expect(Number.isInteger(v.maxTokens)).toBe(true);
			expect(Number.isInteger(v.availableOutputTokens)).toBe(true);
			expect(v.maxTokens).toBe(2_048);
		});

		it("non-finite desired budget falls back to zero (→ the minimum), never NaN", () => {
			const v = clampMaxTokens({
				promptTokens: 1_000,
				contextWindow: FLOOR,
				desiredMaxTokens: Number.POSITIVE_INFINITY,
			});
			expect(Number.isFinite(v.maxTokens)).toBe(true);
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
		});

		it("non-finite context window falls back to zero → compaction", () => {
			const v = clampMaxTokens({ promptTokens: 1_000, contextWindow: Number.NaN, desiredMaxTokens: 2_048 });
			expect(v.reason).toBe("prompt_exhausts_window");
			expect(v.maxTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
		});

		it("always returns a strictly positive max_tokens (never 0, never negative)", () => {
			for (const contextWindow of [0, 1, 100, FLOOR, 262_144]) {
				for (const promptTokens of [0, 50, FLOOR, 500_000]) {
					const v = clampMaxTokens({ promptTokens, contextWindow, desiredMaxTokens: 4_096 });
					expect(v.maxTokens).toBeGreaterThan(0);
					expect(Number.isInteger(v.maxTokens)).toBe(true);
					expect(v.availableOutputTokens).toBeGreaterThanOrEqual(0);
				}
			}
		});
	});

	describe("invariant: shouldCompact iff reason is prompt_exhausts_window", () => {
		it("holds across a sweep of prompt/window/desired combinations", () => {
			for (const promptTokens of [0, 1_000, 20_000, FLOOR - 10, FLOOR, FLOOR + 5_000]) {
				for (const desiredMaxTokens of [0, 16, 4_096, 100_000]) {
					const v = clampMaxTokens({ promptTokens, contextWindow: FLOOR, desiredMaxTokens });
					expect(v.shouldCompact).toBe(v.reason === "prompt_exhausts_window");
					// The core safety invariant whenever the prompt itself fits the window.
					if (v.reason !== "prompt_exhausts_window") {
						expect(promptTokens + v.maxTokens + DEFAULT_SAFETY_RESERVE_TOKENS).toBeLessThanOrEqual(FLOOR);
					}
				}
			}
		});
	});
});
