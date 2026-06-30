import { describe, expect, it } from "vitest";

import { lexicalScore, tokenizeForLexicalScore } from "../../../src/nklein-agent/nklein-lexical-score";

describe("tokenizeForLexicalScore", () => {
	it("splits camelCase boundaries and lowercases", () => {
		expect(tokenizeForLexicalScore("getUserName")).toEqual(["get", "user", "name"]);
	});

	it("drops tokens shorter than two characters", () => {
		expect(tokenizeForLexicalScore("a b cd e")).toEqual(["cd"]);
	});

	it("keeps identifier punctuation (_ $ . -) within a token", () => {
		expect(tokenizeForLexicalScore("foo_bar.baz-qux")).toEqual(["foo_bar.baz-qux"]);
	});

	it("splits on whitespace and other separators", () => {
		expect(tokenizeForLexicalScore("alpha, beta; gamma")).toEqual(["alpha", "beta", "gamma"]);
	});
});

describe("lexicalScore", () => {
	it("awards 50 for a full case-insensitive substring match plus 8 per matching token", () => {
		// "quick brown" is a substring (50) and both tokens appear (+8 +8) → 66
		expect(lexicalScore("The Quick Brown Fox", "quick brown")).toBe(66);
	});

	it("awards only token points when there is no full substring match", () => {
		// no "quick brown" substring, but both tokens present → 16
		expect(lexicalScore("quick the brown", "quick brown")).toBe(16);
	});

	it("returns 0 when nothing matches", () => {
		expect(lexicalScore("hello world", "xyzzy")).toBe(0);
	});

	it("counts each distinct query token once", () => {
		// the full query "foo foo" is not a substring of "foo bar" (0); the single distinct token foo
		// matches once (+8) → 8. If duplicate tokens were double-counted it would be 16.
		expect(lexicalScore("foo bar", "foo foo")).toBe(8);
	});
});
