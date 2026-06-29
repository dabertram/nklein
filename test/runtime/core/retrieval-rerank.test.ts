import { describe, expect, it } from "vitest";
import { lexicalRelevanceScore, type RerankCandidate, rerankByRelevance } from "../../../src/core/retrieval-rerank";

describe("lexicalRelevanceScore", () => {
	it("returns the fraction of distinct query terms found in text", () => {
		// 2 out of 3 terms ("typescript" and "guide") are in text
		const score = lexicalRelevanceScore(["typescript", "guide", "tutorial"], "TypeScript Best Practices Guide");
		expect(score).toBe(2 / 3);
	});

	it("returns 0 when no query terms match the text", () => {
		const score = lexicalRelevanceScore(["xyz", "abc"], "The quick brown fox");
		expect(score).toBe(0);
	});

	it("returns 0 when query terms are empty", () => {
		const score = lexicalRelevanceScore([], "Some text here");
		expect(score).toBe(0);
	});

	it("returns 0 when text is empty", () => {
		const score = lexicalRelevanceScore(["foo"], "");
		expect(score).toBe(0);
	});

	it("is case-insensitive: matches uppercase text with lowercase terms", () => {
		const score = lexicalRelevanceScore(["typescript", "world"], "TypeScript Hello WORLD");
		expect(score).toBe(1); // both terms match
	});

	it("performs substring matching, not word-boundary matching", () => {
		// "script" is a substring of "typescript"
		const score = lexicalRelevanceScore(["script"], "TypeScript");
		expect(score).toBe(1);
	});
});

describe("rerankByRelevance", () => {
	it("returns candidates sorted by relevance score (descending)", () => {
		const candidates: RerankCandidate[] = [
			{ id: "a", text: "Python Programming" },
			{ id: "b", text: "TypeScript Guide" },
			{ id: "c", text: "JavaScript Basics" },
		];
		const result = rerankByRelevance("typescript javascript", candidates);

		// "b" has 1/2 (typescript), "c" has 1/2 (javascript), "a" has 0/2
		// b and c tie at 0.5; tie-breaking preserves input order: b before c
		expect(result[0].id).toBe("b");
		expect(result[1].id).toBe("c");
		expect(result[2].id).toBe("a");
		expect(result[0].score).toBe(0.5);
		expect(result[1].score).toBe(0.5);
		expect(result[2].score).toBe(0);
	});

	it("returns an empty array for empty candidates", () => {
		const result = rerankByRelevance("typescript", []);
		expect(result).toEqual([]);
	});

	it("handles empty query by returning candidates in original order with score 0", () => {
		const candidates: RerankCandidate[] = [
			{ id: "a", text: "Text A" },
			{ id: "b", text: "Text B" },
		];
		const result = rerankByRelevance("", candidates);

		// Empty query → 0 terms → all scores 0 → stable order (original)
		expect(result).toEqual([
			{ id: "a", score: 0 },
			{ id: "b", score: 0 },
		]);
	});

	it("deduplicates query terms when tokenizing", () => {
		const candidates: RerankCandidate[] = [{ id: "a", text: "TypeScript is great" }];
		// Query "typescript typescript guide" has "typescript" twice; only 2 unique terms
		const result = rerankByRelevance("typescript typescript guide", candidates);

		// "a" has 1 match ("typescript") out of 2 unique terms → 0.5
		expect(result[0].score).toBeCloseTo(0.5);
	});

	it("tokenizes query on non-word characters and handles case-insensitivity", () => {
		const candidates: RerankCandidate[] = [{ id: "a", text: "TypeScript Development Tools" }];
		// Query with punctuation/case variation
		const result = rerankByRelevance("TypeScript, development! tools?", candidates);

		// Terms: ["typescript", "development", "tools"] all found → 3/3 = 1.0
		expect(result[0].score).toBe(1);
	});

	it("preserves original order for ties in relevance score (stable sort)", () => {
		const candidates: RerankCandidate[] = [
			{ id: "first", text: "apple banana" },
			{ id: "second", text: "apple cherry" },
			{ id: "third", text: "banana cherry" },
		];
		const result = rerankByRelevance("apple banana cherry", candidates);

		// All candidates match exactly 2/3 terms → all tied
		// Stable sort should preserve original order
		expect(result[0].id).toBe("first");
		expect(result[1].id).toBe("second");
		expect(result[2].id).toBe("third");
		expect(result.every((hit) => hit.score === 2 / 3)).toBe(true);
	});
});
