import { describe, expect, it } from "vitest";
import {
	compressByTokenImportance,
	heuristicTokenImportanceScorer,
	tokenizeForCompression,
} from "../../../src/nklein-sdk/nklein-prompt-compression";

describe("compressByTokenImportance", () => {
	it("returns the original text at ratio 1", () => {
		const text = "the quick brown fox jumps over the lazy dog";
		const result = compressByTokenImportance(text, { targetRatio: 1 });
		expect(result.compressed).toBe(text);
		expect(result.keptRatio).toBe(1);
	});

	it("drops low-information tokens to approach the target ratio", () => {
		const text = "the function computeChecksum reads the file and the returns the checksum value";
		const result = compressByTokenImportance(text, { targetRatio: 0.5 });
		expect(result.keptTokenCount).toBeLessThan(result.originalTokenCount);
		// High-information identifier survives; a stop-word does not dominate.
		expect(result.compressed).toContain("computeChecksum");
	});

	it("preserves newlines / structure", () => {
		const text = "first important line here\nsecond meaningful line here";
		const result = compressByTokenImportance(text, { targetRatio: 0.6 });
		expect(result.compressed).toContain("\n");
	});

	it("honors an injected scorer", () => {
		const text = "alpha beta gamma delta";
		// Score by length: longer words kept. (all same length here -> deterministic keep of first-ranked)
		const result = compressByTokenImportance(text, {
			targetRatio: 0.5,
			scorer: (tokens) => tokens.map((token) => (token.structural ? Number.POSITIVE_INFINITY : token.text.length)),
		});
		expect(result.keptTokenCount).toBe(2);
	});
});

describe("heuristicTokenImportanceScorer", () => {
	it("scores stop-words below identifiers and gives structural tokens infinite score", () => {
		const tokens = tokenizeForCompression("the parseConfig function");
		const scores = heuristicTokenImportanceScorer(tokens, { fullText: "the parseConfig function" });
		const theScore = scores[tokens.findIndex((t) => t.text === "the")];
		const idScore = scores[tokens.findIndex((t) => t.text === "parseConfig")];
		const gapScore = scores[tokens.findIndex((t) => t.structural)];
		expect(idScore).toBeGreaterThan(theScore);
		expect(gapScore).toBe(Number.POSITIVE_INFINITY);
	});
});
