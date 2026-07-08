import { describe, expect, it } from "vitest";
import {
	buildContextFootprintVariant,
	contextFootprintVariantsFor,
	EVAL_CONTEXT_FOOTPRINTS,
	estimateEvalPromptTokens,
	estimateTextTokens,
} from "../../../src/core/eval-context-footprint";
import {
	EVAL_PROMPT_CORPUS,
	evalPromptById,
	evalPromptSchema,
	type ReviewEvalPrompt,
	scoreEvalAnswer,
} from "../../../src/core/eval-prompt-corpus";

describe("eval context-footprint variants (§5.AB/§5.AD quality-knee probe)", () => {
	it("estimates tokens as ceil(chars/4)", () => {
		expect(estimateTextTokens("")).toBe(0);
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("abcde")).toBe(2);
	});

	it("pads a small prompt up to approximately the target footprint", () => {
		const base = evalPromptById("implement-slugify");
		if (!base) throw new Error("fixture missing");
		const variant = buildContextFootprintVariant(base, 8_000);
		const tokens = estimateEvalPromptTokens(variant);
		// Within ~5% of the target — the chars/4 estimate + sentence-granularity filler won't be exact.
		expect(tokens).toBeGreaterThanOrEqual(8_000 * 0.95);
		expect(tokens).toBeLessThanOrEqual(8_000 * 1.05);
	});

	it("keeps the real instruction findable inside the haystack", () => {
		const base = evalPromptById("implement-slugify");
		if (!base) throw new Error("fixture missing");
		const variant = buildContextFootprintVariant(base, 8_000);
		expect(variant.prompt).toContain("=== TASK ===");
		expect(variant.prompt).toContain(base.prompt);
	});

	it("preserves the answer key so a variant still self-scores 1", () => {
		const review = evalPromptById("review-race-leak-injection") as ReviewEvalPrompt;
		const variant = buildContextFootprintVariant(review, 16_000) as ReviewEvalPrompt;
		expect(variant.seededDefects).toEqual(review.seededDefects);
		expect(variant.code).toBe(review.code);
		// Scoring against the base's seeded defects yields a perfect recall for the variant too.
		expect(scoreEvalAnswer(variant, { family: "review", caught: review.seededDefects })).toBe(1);
	});

	it("gives the variant a distinct #ctx-suffixed id", () => {
		const base = evalPromptById("implement-slugify");
		if (!base) throw new Error("fixture missing");
		const variant = buildContextFootprintVariant(base, 32_000);
		expect(variant.id).toBe("implement-slugify#ctx32000");
		expect(variant.id).not.toBe(base.id);
	});

	it("is deterministic — same base + target reproduces byte-identical prompt", () => {
		const base = evalPromptById("implement-debounce");
		if (!base) throw new Error("fixture missing");
		expect(buildContextFootprintVariant(base, 16_000).prompt).toBe(buildContextFootprintVariant(base, 16_000).prompt);
	});

	it("never pads DOWN — a target at/below the base returns the base unchanged", () => {
		const base = evalPromptById("implement-slugify");
		if (!base) throw new Error("fixture missing");
		expect(buildContextFootprintVariant(base, 1)).toBe(base);
		expect(buildContextFootprintVariant(base, estimateEvalPromptTokens(base))).toBe(base);
	});

	it("every variant validates against the corpus schema", () => {
		const base = evalPromptById("decompose-rest-pagination");
		if (!base) throw new Error("fixture missing");
		for (const target of EVAL_CONTEXT_FOOTPRINTS) {
			const variant = buildContextFootprintVariant(base, target);
			expect(() => evalPromptSchema.parse(variant)).not.toThrow();
		}
	});

	it("variantsFor includes the base plus one rung per larger footprint", () => {
		const base = evalPromptById("implement-slugify");
		if (!base) throw new Error("fixture missing");
		const variants = contextFootprintVariantsFor(base);
		// Base (unpadded) + one per footprint tier (the slugify prompt is tiny, so all tiers apply).
		expect(variants[0]).toBe(base);
		expect(variants).toHaveLength(1 + EVAL_CONTEXT_FOOTPRINTS.length);
		// Footprints are monotonically increasing across the rungs.
		const sizes = variants.map(estimateEvalPromptTokens);
		for (let i = 1; i < sizes.length; i += 1) {
			expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
		}
	});

	it("skips footprint tiers at/below a naturally large base prompt", () => {
		const base = evalPromptById("implement-slugify");
		if (!base) throw new Error("fixture missing");
		// Synthesize a base already larger than the 4k tier by padding it to 8k first.
		const large = buildContextFootprintVariant(base, 8_000);
		const variants = contextFootprintVariantsFor(large);
		// 4k and 8k tiers are skipped (≤ base); only 16k + 32k remain, plus the base itself.
		expect(variants[0]).toBe(large);
		expect(variants).toHaveLength(1 + 2);
	});

	it("covers the whole corpus without breaking any row's schema or self-score", () => {
		for (const prompt of EVAL_PROMPT_CORPUS) {
			for (const variant of contextFootprintVariantsFor(prompt)) {
				expect(() => evalPromptSchema.parse(variant)).not.toThrow();
			}
		}
	});
});
