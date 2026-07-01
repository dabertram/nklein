import { describe, expect, it } from "vitest";
import {
	type RetrievalEvidence,
	type RetrievalHit,
	type RetrievalLoopDeps,
	runRetrievalLoop,
} from "../../../src/core/retrieval-loop-driver";

const NOW = Date.parse("2026-07-01T00:00:00Z");
const RECENT = "2026-07-01T00:00:00Z"; // same day ⇒ current
const STALE = "2016-01-01T00:00:00Z"; // ~10 years ⇒ stale

function hit(id: string, overrides: Partial<RetrievalHit> = {}): RetrievalHit {
	return { id, url: `https://example.com/${id}`, publishedAt: RECENT, ...overrides };
}

/** A fake dep set that records egress calls and returns two recent hits per search by default. */
function makeDeps(over: Partial<RetrievalLoopDeps> = {}): {
	deps: RetrievalLoopDeps;
	searchCalls: string[];
	fetchCalls: string[];
} {
	const searchCalls: string[] = [];
	const fetchCalls: string[] = [];
	const deps: RetrievalLoopDeps = {
		now: () => NOW,
		search: async (query) => {
			searchCalls.push(query);
			return [hit("a"), hit("b")];
		},
		fetch: async (h): Promise<RetrievalEvidence> => {
			fetchCalls.push(h.id);
			return { id: h.id, url: h.url, text: `text-${h.id}`, publishedAt: h.publishedAt };
		},
		synthesize: async ({ evidence }) => `answer:${evidence.length}`,
		...over,
	};
	return { deps, searchCalls, fetchCalls };
}

describe("runRetrievalLoop", () => {
	it("happy path: formulate → search → rank → fetch → sufficient → synthesize", async () => {
		const { deps, searchCalls, fetchCalls } = makeDeps();
		const result = await runRetrievalLoop("what is X", deps);
		expect(result.stoppedBecause).toBe("sufficient");
		expect(result.evidence.map((e) => e.id)).toEqual(["a", "b"]);
		expect(searchCalls).toEqual(["what is X"]); // primaryQuery is whitespace-normalised, not lowercased
		expect(fetchCalls).toEqual(["a", "b"]);
		expect(result.answer).toBe("answer:2");
		expect(result.actions[0]).toBe("formulate_query");
		expect(result.actions).toContain("search");
		expect(result.actions).toContain("fetch");
		expect(result.actions.at(-1)).toBe("stop_sufficient");
		expect(result.iterations).toBe(0); // sufficient on the first round, before any advance
	});

	it("stops sufficient early once minSources is met (no wasted rounds)", async () => {
		const { deps } = makeDeps({ search: async () => [hit("a")] });
		const result = await runRetrievalLoop("what is X", deps, { minSources: 1 });
		expect(result.stoppedBecause).toBe("sufficient");
		expect(result.evidence.map((e) => e.id)).toEqual(["a"]);
	});

	it("exhausts the iteration budget when never sufficient (source floor unmet)", async () => {
		const { deps } = makeDeps();
		const result = await runRetrievalLoop("what is X", deps, { minSources: 5 });
		expect(result.stoppedBecause).toBe("budget_exhausted");
		expect(result.sufficiency.sufficient).toBe(false);
		expect(result.sufficiency.reasons.some((r) => /source/.test(r))).toBe(true);
	});

	it("advances to the next query (knowledge-debt) until all sub-questions are covered", async () => {
		const queriesSearched: string[] = [];
		const { deps } = makeDeps({
			// distinct ids per query so evidence accumulates (dedup by id otherwise)
			search: async (query) => {
				queriesSearched.push(query);
				return query.includes("detail Y") ? [hit("c"), hit("d")] : [hit("a"), hit("b")];
			},
		});
		const result = await runRetrievalLoop("what is X", deps, { knowledgeDebt: ["detail Y"], minSources: 3 });
		expect(result.stoppedBecause).toBe("sufficient");
		expect(queriesSearched.length).toBeGreaterThanOrEqual(2); // primary + the alternate
		expect(result.evidence.map((e) => e.id).sort()).toEqual(["a", "b", "c", "d"]);
		expect(result.iterations).toBeGreaterThanOrEqual(1);
	});

	it("advances (never re-searches) a zero-hit query and stops on budget", async () => {
		const { deps, fetchCalls } = makeDeps({ search: async () => [] });
		const result = await runRetrievalLoop("what is X", deps, { minSources: 1 });
		expect(result.stoppedBecause).toBe("budget_exhausted");
		expect(result.evidence).toEqual([]);
		expect(fetchCalls).toEqual([]); // nothing to fetch
	});

	it("skips a failed fetch and keeps going (never rethrows)", async () => {
		const { deps } = makeDeps({
			fetch: async (h) => {
				if (h.id === "a") {
					throw new Error("blocked");
				}
				return { id: h.id, text: `text-${h.id}`, publishedAt: h.publishedAt };
			},
		});
		const result = await runRetrievalLoop("what is X", deps, { minSources: 1 });
		expect(result.evidence.map((e) => e.id)).toEqual(["b"]); // "a" skipped
		expect(result.stoppedBecause).toBe("sufficient");
	});

	it("freshness gate: a 'fresh' plan with only stale sources is NOT sufficient", async () => {
		const { deps } = makeDeps({
			search: async () => [hit("a", { publishedAt: STALE }), hit("b", { publishedAt: STALE })],
		});
		const result = await runRetrievalLoop("latest X release", deps, { minSources: 1 });
		expect(result.queryPlan.freshnessNeed).toBe("fresh");
		expect(result.stoppedBecause).toBe("budget_exhausted");
		expect(result.sufficiency.reasons.some((r) => /fresh/i.test(r))).toBe(true);
	});

	it("freshness gate: a 'fresh' plan is satisfied once a recent source appears", async () => {
		const { deps } = makeDeps({ search: async () => [hit("a", { publishedAt: RECENT })] });
		const result = await runRetrievalLoop("latest X release", deps, { minSources: 1 });
		expect(result.queryPlan.freshnessNeed).toBe("fresh");
		expect(result.stoppedBecause).toBe("sufficient");
	});

	it("bounds the fetch fan-out per query to maxFetchPerQuery (top-ranked first)", async () => {
		const { deps, fetchCalls } = makeDeps({
			search: async () => [hit("a"), hit("b"), hit("c"), hit("d")],
		});
		await runRetrievalLoop("what is X", deps, { maxFetchPerQuery: 2, minSources: 1 });
		expect(fetchCalls).toHaveLength(2);
	});

	it("returns a null answer when no synthesiser is supplied (evidence-only)", async () => {
		const searchCalls: string[] = [];
		const deps: RetrievalLoopDeps = {
			now: () => NOW,
			search: async (query) => {
				searchCalls.push(query);
				return [hit("a")];
			},
			fetch: async (h) => ({ id: h.id, text: "t", publishedAt: h.publishedAt }),
		};
		const result = await runRetrievalLoop("what is X", deps, { minSources: 1 });
		expect(result.answer).toBeNull();
		expect(result.evidence).toHaveLength(1);
	});

	it("dedups evidence by id across rounds", async () => {
		// Both queries return the SAME ids ⇒ evidence must not double-count.
		const { deps } = makeDeps();
		const result = await runRetrievalLoop("what is X", deps, { knowledgeDebt: ["detail Y"], minSources: 3 });
		expect(result.evidence.map((e) => e.id)).toEqual(["a", "b"]); // never [a,b,a,b]
		expect(result.stoppedBecause).toBe("budget_exhausted"); // 2 sources < 3, and no new evidence from the alternate
	});
});
