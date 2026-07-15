import { describe, expect, it } from "vitest";
import {
	type NKleinCodeSearchMatch,
	rankHybridMatches,
	scoreLine,
	tokenizeQuery,
} from "../../../src/nklein-agent/nklein-code-search";

function match(path: string, line: number, score: number): NKleinCodeSearchMatch {
	return { path, lineStart: line, lineEnd: line, score, snippet: `${line}: ...` };
}

describe("tokenizeQuery", () => {
	it("splits on non-identifier chars, drops <2-char tokens, and dedupes", () => {
		expect(tokenizeQuery("foo bar foo")).toEqual(["foo", "bar"]);
		expect(tokenizeQuery("a b cc")).toEqual(["cc"]); // single-char tokens dropped
		expect(tokenizeQuery("getUser(id):User")).toEqual(["getUser", "id", "User"]);
	});
});

describe("scoreLine", () => {
	it("scores zero when neither the query nor any token appears", () => {
		expect(scoreLine("totally unrelated line", "fooBar", ["fooBar"])).toBe(0);
	});

	it("ranks a full-query line above a token-only line", () => {
		const full = scoreLine("const fooBar = compute()", "fooBar", ["fooBar"]);
		const tokenOnly = scoreLine("call foo somewhere", "foo bar", ["foo", "bar"]);
		expect(full).toBeGreaterThan(0);
		expect(tokenOnly).toBeGreaterThan(0);
		expect(full).toBeGreaterThan(tokenOnly);
	});

	it("gives a declaration line a bonus over a plain line matching the same token", () => {
		const tokens = ["handler"];
		const declaration = scoreLine("export function handler(req) {", "handler", tokens);
		const plain = scoreLine("      handler.call(req)", "handler", tokens);
		expect(declaration).toBeGreaterThan(plain);
	});

	it("adds a word-boundary bonus (whole-word match beats a substring-only match)", () => {
		const tokens = ["cat"];
		const wholeWord = scoreLine("the cat sat", "cat", tokens);
		const substring = scoreLine("concatenate values", "cat", tokens);
		expect(wholeWord).toBeGreaterThan(substring);
	});
});

describe("rankHybridMatches", () => {
	it("normalizes per source so a top lexical match (weight 100) outranks a top repo_map match (weight 90)", () => {
		const result = rankHybridMatches({
			lexicalMatches: [match("lex.ts", 1, 50)],
			repoMapMatches: [match("map.ts", 2, 50)],
			indexMatches: [],
			maxResults: 10,
		});
		expect(result.matches.map((m) => m.path)).toEqual(["lex.ts", "map.ts"]);
		expect(result.truncated).toBe(false);
	});

	it("dedupes matches at the same path:line range, keeping the higher normalized score", () => {
		const result = rankHybridMatches({
			lexicalMatches: [match("a.ts", 1, 50)], // → normalized 100
			repoMapMatches: [],
			indexMatches: [match("a.ts", 1, 50)], // same range → normalized 80, loses
			maxResults: 10,
		});
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0]?.path).toBe("a.ts");
	});

	it("truncates to maxResults and flags truncated", () => {
		const result = rankHybridMatches({
			lexicalMatches: [match("a.ts", 1, 30), match("b.ts", 2, 20), match("c.ts", 3, 10)],
			repoMapMatches: [],
			indexMatches: [],
			maxResults: 2,
		});
		expect(result.matches).toHaveLength(2);
		expect(result.truncated).toBe(true);
	});

	it("drops zero-score matches entirely", () => {
		const result = rankHybridMatches({
			lexicalMatches: [match("a.ts", 1, 0)],
			repoMapMatches: [],
			indexMatches: [],
			maxResults: 10,
		});
		expect(result.matches).toEqual([]);
		expect(result.truncated).toBe(false);
	});
});
