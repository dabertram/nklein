import { describe, expect, it } from "vitest";
import {
	buildPackagingPrompt,
	CONSTRAINT_TAX_SIZE_B,
	DIRECT_CONSTRAINT_BAR,
	decideConstraintStrategy,
} from "../../src/core/constraint-tax-strategy";

describe("decideConstraintStrategy", () => {
	it("sends a small model down the free-text-then-package path", () => {
		const decision = decideConstraintStrategy({ modelId: "qwen3-8b-q4_k_m" });
		expect(decision.strategy).toBe("free_text_then_package");
		expect(decision.reason).toContain("wrong-but-valid");
	});

	it("allows direct constraint at or above the paper's threshold, flagged as a weak basis", () => {
		const decision = decideConstraintStrategy({ modelId: "qwen3-32b-q4_k_m" });
		expect(decision.strategy).toBe("direct_constrained");
		expect(decision.weakBasis).toBe(true);
	});

	it("lets a MEASUREMENT override the size heuristic in both directions", () => {
		const smallButCapable = decideConstraintStrategy({
			modelId: "qwen3-8b-q4_k_m",
			measuredConstrainedAccuracy: 0.9,
			observationCount: 20,
		});
		const largeButNot = decideConstraintStrategy({
			modelId: "big-70b-q4_k_m",
			measuredConstrainedAccuracy: 0.4,
			observationCount: 20,
		});
		expect(smallButCapable.strategy).toBe("direct_constrained");
		expect(smallButCapable.weakBasis).toBe(false);
		expect(largeButNot.strategy).toBe("free_text_then_package");
	});

	it("treats a thin measurement as unmeasured", () => {
		const decision = decideConstraintStrategy({
			modelId: "qwen3-8b-q4_k_m",
			measuredConstrainedAccuracy: 0.99,
			observationCount: 2,
		});
		expect(decision.strategy).toBe("free_text_then_package");
		expect(decision.weakBasis).toBe(true);
	});

	it("ALWAYS constrains a packaging-only turn — there is no reasoning left to damage", () => {
		const decision = decideConstraintStrategy({ modelId: "qwen3-8b-q4_k_m", packagingOnly: true });
		expect(decision.strategy).toBe("direct_constrained");
		expect(decision.weakBasis).toBe(false);
	});

	it("defaults to the VISIBLE-failure path when capability is entirely unknown", () => {
		const decision = decideConstraintStrategy({ modelId: "mystery" });
		expect(decision.strategy).toBe("free_text_then_package");
		expect(decision.reason).toContain("VISIBLE");
	});

	it("uses the documented constants", () => {
		expect(CONSTRAINT_TAX_SIZE_B).toBe(14);
		expect(DIRECT_CONSTRAINT_BAR).toBeGreaterThan(0);
	});

	it("never throws on junk", () => {
		expect(() => decideConstraintStrategy({ modelId: "" })).not.toThrow();
	});
});

describe("buildPackagingPrompt", () => {
	it("forbids the packaging pass from re-deciding the answer", () => {
		const prompt = buildPackagingPrompt({
			freeTextAnswer: "use read_files on src/a.ts",
			schemaDescription: "{tool, args}",
		});
		expect(prompt).toContain("TRANSCRIPTION");
		expect(prompt).toContain("Do not correct it");
		expect(prompt).toContain("do not invent values");
	});

	it("prefers an empty object over a plausible guess", () => {
		const prompt = buildPackagingPrompt({ freeTextAnswer: "x", schemaDescription: "y" });
		expect(prompt).toContain("rather than a plausible-looking guess");
	});
});
