import { describe, expect, it } from "vitest";
import { resolveAutoDecompositionDepth } from "../../../src/core/auto-decomposition-depth";

const NEUTRAL = 16_000; // between small (8k) and large (32k) → no context adjustment

describe("resolveAutoDecompositionDepth (F4.38)", () => {
	it("deepens with difficulty at a neutral context budget", () => {
		expect(
			resolveAutoDecompositionDepth({ difficulty: "trivial", qualityEffectiveContextTokens: NEUTRAL }).depth,
		).toBe(0);
		expect(
			resolveAutoDecompositionDepth({ difficulty: "medium", qualityEffectiveContextTokens: NEUTRAL }).depth,
		).toBe(1);
		expect(resolveAutoDecompositionDepth({ difficulty: "hard", qualityEffectiveContextTokens: NEUTRAL }).depth).toBe(
			2,
		);
		expect(
			resolveAutoDecompositionDepth({ difficulty: "very-hard", qualityEffectiveContextTokens: NEUTRAL }).depth,
		).toBe(3);
	});

	it("a small effective context decomposes one level FINER", () => {
		const decision = resolveAutoDecompositionDepth({ difficulty: "medium", qualityEffectiveContextTokens: 4_000 });
		expect(decision.depth).toBe(2); // medium base 1 + 1 finer
		expect(decision.reason).toContain("finer");
	});

	it("a large effective context decomposes one level COARSER (never below 0)", () => {
		expect(resolveAutoDecompositionDepth({ difficulty: "hard", qualityEffectiveContextTokens: 80_000 }).depth).toBe(
			1,
		);
		// trivial can't go below 0 even with a big budget.
		expect(
			resolveAutoDecompositionDepth({ difficulty: "trivial", qualityEffectiveContextTokens: 80_000 }).depth,
		).toBe(0);
	});

	it("caps depth and treats an unknown difficulty as medium; surfaces a reason", () => {
		const capped = resolveAutoDecompositionDepth({ difficulty: "very-hard", qualityEffectiveContextTokens: 2_000 });
		expect(capped.depth).toBeLessThanOrEqual(4);
		const unknown = resolveAutoDecompositionDepth({ difficulty: "???", qualityEffectiveContextTokens: NEUTRAL });
		expect(unknown.depth).toBe(1); // treated as medium
		expect(unknown.reason).toContain("medium");
	});
});
