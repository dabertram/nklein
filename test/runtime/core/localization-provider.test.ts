import { describe, expect, it } from "vitest";
import {
	type LocalizationHit,
	type LocalizationProvider,
	localizationHitToRef,
	localizationProviderAsKernelLocalize,
	rankLocalizationHits,
} from "../../../src/core/localization-provider";

describe("localizationHitToRef", () => {
	it("prefers the symbol form", () => {
		expect(localizationHitToRef({ file: "src/foo.ts", symbol: "doThing", startLine: 10 })).toBe("src/foo.ts:doThing");
	});

	it("falls back to a line span, collapsing a single line", () => {
		expect(localizationHitToRef({ file: "src/foo.ts", startLine: 10, endLine: 20 })).toBe("src/foo.ts:10-20");
		expect(localizationHitToRef({ file: "src/foo.ts", startLine: 10, endLine: 10 })).toBe("src/foo.ts:10");
		expect(localizationHitToRef({ file: "src/foo.ts", startLine: 10 })).toBe("src/foo.ts:10");
	});

	it("falls back to the bare file when neither symbol nor line is known", () => {
		expect(localizationHitToRef({ file: "src/foo.ts" })).toBe("src/foo.ts");
	});
});

describe("rankLocalizationHits", () => {
	it("orders by score desc, hits without a score last, with a stable tiebreak", () => {
		const hits: LocalizationHit[] = [
			{ file: "b.ts", score: 0.5 },
			{ file: "a.ts" }, // no score → last
			{ file: "c.ts", score: 0.9 },
			{ file: "a.ts", symbol: "z", score: 0.5 }, // tie with b.ts@0.5 → stable by file+symbol
		];
		const ranked = rankLocalizationHits(hits).map((h) => h.file + (h.symbol ?? ""));
		expect(ranked).toEqual(["c.ts", "a.tsz", "b.ts", "a.ts"]);
	});

	it("does not mutate the input", () => {
		const hits: LocalizationHit[] = [
			{ file: "b.ts", score: 1 },
			{ file: "a.ts", score: 2 },
		];
		const copy = [...hits];
		rankLocalizationHits(hits);
		expect(hits).toEqual(copy);
	});
});

describe("localizationProviderAsKernelLocalize", () => {
	const provider = (hits: LocalizationHit[]): LocalizationProvider => ({
		localize: async () => hits,
	});

	it("ranks, flattens to refs, and de-dupes — usable as the kernel's localize dep", async () => {
		const localize = localizationProviderAsKernelLocalize(
			provider([
				{ file: "src/a.ts", symbol: "low", score: 0.1 },
				{ file: "src/b.ts", symbol: "high", score: 0.9 },
				{ file: "src/b.ts", symbol: "high", score: 0.9 }, // duplicate ref → collapsed
			]),
			{ query: "boom" },
		);
		expect(await localize()).toEqual(["src/b.ts:high", "src/a.ts:low"]);
	});

	it("passes the query through and returns [] for no hits", async () => {
		let seen = "";
		const localize = localizationProviderAsKernelLocalize(
			{
				localize: async (q) => {
					seen = q.query;
					return [];
				},
			},
			{ query: "the failing test" },
		);
		expect(await localize()).toEqual([]);
		expect(seen).toBe("the failing test");
	});
});
