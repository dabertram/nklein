import { describe, expect, it } from "vitest";
import { classifyQueryStyle, rankHybridMatches } from "../../../src/nklein-agent/nklein-code-search";

describe("classifyQueryStyle (F12.2)", () => {
	it("reads short identifier/error queries as keyword", () => {
		expect(classifyQueryStyle("buildNKleinRepoMap", ["buildnkleinrepomap"])).toBe("keyword");
		expect(classifyQueryStyle("EACCES retry", ["eacces", "retry"])).toBe("keyword");
	});

	it("reads questions and longer prose as natural", () => {
		expect(
			classifyQueryStyle("how does the retry ladder work", ["how", "does", "the", "retry", "ladder", "work"]),
		).toBe("natural");
		expect(classifyQueryStyle("what is tokenization", ["what", "is", "tokenization"])).toBe("natural");
	});
});

describe("rankHybridMatches keyword de-emphasis (F12.2)", () => {
	const at = (path: string, score: number) => ({
		path,
		lineStart: 1,
		lineEnd: 2,
		snippet: "x",
		score,
	});

	it("halves the embedding tier for keyword queries so lexical secondaries outrank embedding hits", () => {
		// Tier scores are per-tier normalized (best hit = the tier weight), so the de-emphasis shows in how
		// SECONDARY lexical hits mix with the embedding tier: natural = emb(80) above lex2(50); keyword = below(40).
		const run = (queryStyle: "keyword" | "natural") =>
			rankHybridMatches({
				queryStyle,
				lexicalMatches: [at("lex.ts", 10), at("lex2.ts", 5)],
				repoMapMatches: [],
				indexMatches: [at("emb.ts", 60)],
				maxResults: 5,
			}).matches.map((match) => match.path);
		expect(run("natural")).toEqual(["lex.ts", "emb.ts", "lex2.ts"]);
		expect(run("keyword")).toEqual(["lex.ts", "lex2.ts", "emb.ts"]);
	});
});
