import { describe, expect, it } from "vitest";

import {
	type NKleinCodeSearchMatch,
	rankHybridMatches,
	scoreLine,
	tokenizeQuery,
} from "../../../src/nklein-agent/nklein-code-search";

// §5.V coverage for the pure ranking core of nklein-code-search (the file had zero direct tests). The I/O orchestrator
// searchNKleinCode is left to integration; these lock the deterministic algorithm: query tokenization, per-line scoring,
// and the hybrid merge/dedup/sort/truncate. Assertions are property-based (relative ordering, membership) rather than
// pinned to the exact magic-number weights, so a legitimate re-weighting stays green while a structural break fails.

const match = (path: string, line: number, score: number): NKleinCodeSearchMatch => ({
	path,
	lineStart: line,
	lineEnd: line,
	score,
	snippet: `${line}: x`,
});

describe("tokenizeQuery", () => {
	it("splits on non-identifier characters and preserves insertion order", () => {
		expect(tokenizeQuery("getUserById(id)")).toEqual(["getUserById", "id"]);
	});

	it("drops single-character tokens and de-duplicates", () => {
		expect(tokenizeQuery("a bb ccc")).toEqual(["bb", "ccc"]);
		expect(tokenizeQuery("foo foo foo")).toEqual(["foo"]);
	});

	it("keeps dotted / dashed identifiers as a single token", () => {
		expect(tokenizeQuery("foo.bar-baz")).toEqual(["foo.bar-baz"]);
	});
});

describe("scoreLine", () => {
	it("scores a line containing the query above a non-matching line", () => {
		expect(scoreLine("const foo = 1", "foo", ["foo"])).toBeGreaterThan(0);
		expect(scoreLine("const bar = 1", "foo", ["foo"])).toBe(0);
	});

	it("ranks an exact substring hit above a token-only partial match", () => {
		const substring = scoreLine("run foo bar now", "foo bar", ["foo", "bar"]);
		const tokenOnly = scoreLine("foo and then bar", "foo bar", ["foo", "bar"]);
		expect(substring).toBeGreaterThan(tokenOnly);
	});

	it("gives a declaration line a bonus over a plain reference to the same symbol", () => {
		const declaration = scoreLine("export function handleUser() {}", "handleUser", ["handleUser"]);
		const reference = scoreLine("  handleUser();", "handleUser", ["handleUser"]);
		expect(declaration).toBeGreaterThan(reference);
	});
});

describe("rankHybridMatches", () => {
	it("normalizes per-source, sorts by score desc, and strips the source tag from output", () => {
		const out = rankHybridMatches({
			lexicalMatches: [match("a.ts", 1, 50), match("a.ts", 2, 100)],
			repoMapMatches: [],
			indexMatches: [],
			maxResults: 8,
		});
		expect(out.matches.map((m) => m.lineStart)).toEqual([2, 1]);
		expect(out.matches[0]?.score).toBe(100); // top lexical match normalizes to the lexical weight
		expect(out.truncated).toBe(false);
		expect(out.matches[0]).not.toHaveProperty("source");
	});

	it("dedups the same file range, keeping the higher-weighted source (lexical over repo_map)", () => {
		const out = rankHybridMatches({
			lexicalMatches: [match("a.ts", 5, 42)],
			repoMapMatches: [match("a.ts", 5, 999)],
			indexMatches: [],
			maxResults: 8,
		});
		expect(out.matches).toHaveLength(1);
		expect(out.matches[0]?.score).toBe(100); // lexical weight (100) beats repo_map weight (90)
	});

	it("truncates to maxResults and sets the truncated flag", () => {
		const out = rankHybridMatches({
			lexicalMatches: [match("a.ts", 1, 30), match("a.ts", 2, 60), match("a.ts", 3, 90)],
			repoMapMatches: [],
			indexMatches: [],
			maxResults: 2,
		});
		expect(out.matches).toHaveLength(2);
		expect(out.truncated).toBe(true);
	});
});
