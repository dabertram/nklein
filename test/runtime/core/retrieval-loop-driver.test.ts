import { describe, expect, it } from "vitest";
import {
	type RetrievalEvidence,
	type RetrievalHit,
	type RetrievalLoopDeps,
	runRetrievalLoop,
} from "../../../src/core/retrieval-loop-driver";
import { citedSynthesisAdapter } from "../../../src/core/retrieval-synthesis-adapter";

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

	it("composes with citedSynthesisAdapter over an injected model → a rendered cited answer (§5.AC)", async () => {
		// The loop gathers evidence [a, b], then the real synthesis adapter drives a fake model that returns the
		// {claim,cite[]} contract; the loop's `answer` is the rendered cited answer with [n] markers + a sources list.
		const fakeModel = async () =>
			'[{"claim":"X is powered by A","cite":["a"]},{"claim":"X also uses B","cite":["b"]}]';
		const { deps } = makeDeps({ synthesize: citedSynthesisAdapter(fakeModel) });
		const result = await runRetrievalLoop("what is X", deps);
		// Contract updated 2026-07-08: dated sources now carry their publication date + freshness verdict inline.
		expect(result.answer).toBe(
			"X is powered by A [1]\nX also uses B [2]\n\nSources:\n[1] https://example.com/a (published 2026-07-01; current)\n[2] https://example.com/b (published 2026-07-01; current)",
		);
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

	it("a dead-end PRIMARY query does not poison sufficiency when an alternate covers it (§5.AC regression)", async () => {
		// The primary query dead-ends (0 hits — routine on a backend error / empty result set) while the
		// knowledge-debt alternate returns 2 fresh sources. The loop must reach sufficiency: an attempted-but-empty
		// query counts as covered. On the old code the primary sub-question stayed permanently uncovered, so the loop
		// exhausted its budget and reported INSUFFICIENT despite gathering ample fresh evidence.
		const { deps } = makeDeps({
			search: async (query) => (query.includes("detail Y") ? [hit("c"), hit("d")] : []),
		});
		const result = await runRetrievalLoop("what is X", deps, { knowledgeDebt: ["detail Y"], minSources: 2 });
		expect(result.stoppedBecause).toBe("sufficient");
		expect(result.sufficiency.sufficient).toBe(true);
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

	// ── OPT-IN topic-aware freshness ────────────────────────────────────────────────────────────────────────────────
	// The SAME 10-day-old source + the SAME injected `now`, ranked under volatility-tuned freshness bands:
	//   • realtime bands (current=0, recent=1, possiblyStale=3): a 10-day source is `stale` → not fresh.
	//   • stable bands   (current=1825, …):                       a 10-day source is `current` → fresh.
	// With `freshnessSensitive` forcing a `fresh` plan, that difference flips the loop's stop reason.
	const AGED_10D = "2026-06-21T00:00:00Z"; // 10 days before NOW (2026-07-01) — well within the default 30-day `current`.

	it("topic-aware freshness ON: a fast-moving topic gates a 10-day source as stale (freshness unmet)", async () => {
		const { deps } = makeDeps({ search: async () => [hit("a", { publishedAt: AGED_10D })] });
		const result = await runRetrievalLoop("the live price of gold", deps, {
			minSources: 1,
			freshnessSensitive: true,
			topicAwareFreshness: true,
		});
		expect(result.queryPlan.freshnessNeed).toBe("fresh");
		// realtime bands ⇒ 10-day source is `stale` ⇒ freshness never satisfied ⇒ budget exhausted.
		expect(result.stoppedBecause).toBe("budget_exhausted");
		expect(result.sufficiency.reasons.some((r) => /fresh/i.test(r))).toBe(true);
	});

	it("topic-aware freshness ON: an evergreen topic treats the SAME 10-day source as current (sufficient)", async () => {
		const { deps } = makeDeps({ search: async () => [hit("a", { publishedAt: AGED_10D })] });
		const result = await runRetrievalLoop("the definition of a prime number", deps, {
			minSources: 1,
			freshnessSensitive: true,
			topicAwareFreshness: true,
		});
		expect(result.queryPlan.freshnessNeed).toBe("fresh");
		// stable bands ⇒ 10-day source is `current` ⇒ freshness satisfied ⇒ sufficient.
		expect(result.stoppedBecause).toBe("sufficient");
		expect(result.evidence.map((e) => e.id)).toEqual(["a"]);
	});

	it("topic-aware freshness OFF (default): the SAME fast-moving task keeps default bands (byte-identical)", async () => {
		// Identical to the realtime-ON case EXCEPT the flag is off. Default `current`=30 days ⇒ the 10-day source is
		// `current` ⇒ freshness satisfied ⇒ sufficient. Proves the flag actually changes behaviour AND that off = default.
		const { deps } = makeDeps({ search: async () => [hit("a", { publishedAt: AGED_10D })] });
		const result = await runRetrievalLoop("the live price of gold", deps, {
			minSources: 1,
			freshnessSensitive: true,
			// topicAwareFreshness omitted (default off)
		});
		expect(result.queryPlan.freshnessNeed).toBe("fresh");
		expect(result.stoppedBecause).toBe("sufficient");
	});

	it("bug-hunt 2026-07-05 (HIGH): a 'fresh' plan is NOT satisfied when the only fresh hit's FETCH fails (gate reflects FETCHED evidence, not hits)", async () => {
		// A fresh hit + a stale hit are both returned; the FRESH one's fetch throws (blocked/transient) so only the STALE
		// source enters `evidence`. Pre-fix the gate flipped from the ranked HIT list, so the loop declared "fresh &
		// sufficient" over purely stale evidence — the exact freshness bypass the knows-today gate exists to prevent.
		const { deps } = makeDeps({
			search: async () => [hit("f", { publishedAt: RECENT }), hit("s", { publishedAt: STALE })],
			fetch: async (h): Promise<RetrievalEvidence> => {
				if (h.id === "f") {
					throw new Error("blocked");
				}
				return { id: h.id, url: h.url, text: `text-${h.id}`, publishedAt: h.publishedAt };
			},
		});
		const result = await runRetrievalLoop("latest X release", deps, { minSources: 1 });
		expect(result.queryPlan.freshnessNeed).toBe("fresh");
		expect(result.evidence.map((e) => e.id)).toEqual(["s"]); // only the stale source was actually fetched
		expect(result.stoppedBecause).toBe("budget_exhausted"); // freshness gate NOT satisfied by an unfetched fresh hit
		expect(result.sufficiency.reasons.some((r) => /fresh/i.test(r))).toBe(true);
	});

	it("bug-hunt 2026-07-05 (MEDIUM): sufficiency is reachable when knowledge-debt sub-questions exceed maxIterations", async () => {
		// 3 knowledge-debt items → 4 sub-questions; with maxIterations=2 the loop can only cover 2 queries, so the old
		// coverage requirement (ALL 4) was permanently unreachable → the loop always reported insufficient even with
		// ample fresh evidence. The fix caps the coverage requirement to the budget-attemptable sub-questions.
		let n = 0;
		const { deps } = makeDeps({
			search: async () => {
				n += 1;
				return [hit(`r${n}`), hit(`t${n}`)]; // distinct fresh ids per query so evidence accumulates
			},
		});
		const result = await runRetrievalLoop("what is X", deps, {
			knowledgeDebt: ["gap A", "gap B", "gap C"],
			maxIterations: 2,
			minSources: 1,
		});
		expect(result.stoppedBecause).toBe("sufficient");
		expect(result.sufficiency.sufficient).toBe(true);
	});

	it("dedups duplicate-id hits before fetching so a distinct hit is not starved (bug-hunt 2026-07-05)", async () => {
		// search returns id 'x' twice + a distinct 'y'; with maxFetchPerQuery=2 the old byId-last-wins mapping filled both
		// slots with 'x', starving 'y'. The dedup keeps 'x' once and fetches 'y'.
		const { deps, fetchCalls } = makeDeps({
			search: async () => [hit("x"), hit("x", { url: "https://example.com/x-dup" }), hit("y")],
		});
		await runRetrievalLoop("what is X", deps, { maxFetchPerQuery: 2, minSources: 2 });
		expect(fetchCalls.filter((id) => id === "x")).toHaveLength(1); // fetched once, not twice
		expect(fetchCalls).toContain("y"); // the distinct hit is NOT starved by the duplicate
	});

	it("a THROWING search (network unavailable) degrades to a zero-hit query — never crashes the loop", async () => {
		// Live-found class (todo online-fallback leaf): the search dep itself rejecting (SearXNG down, egress cut)
		// must degrade exactly like an empty result set — the loop advances/stops on budget with whatever it has.
		const { deps, fetchCalls } = makeDeps({
			search: async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:18888");
			},
		});
		const result = await runRetrievalLoop("what is X", deps, { minSources: 1 });
		expect(result.stoppedBecause).toBe("budget_exhausted");
		expect(result.evidence).toEqual([]);
		expect(fetchCalls).toEqual([]);
	});

	it("a search that throws only for the PRIMARY query still reaches sufficiency via the alternate", async () => {
		const { deps } = makeDeps({
			search: async (query) => {
				if (query.includes("detail Y")) {
					return [hit("c"), hit("d")];
				}
				throw new Error("backend 502");
			},
		});
		const result = await runRetrievalLoop("what is X", deps, { knowledgeDebt: ["detail Y"], minSources: 2 });
		expect(result.stoppedBecause).toBe("sufficient");
	});
});
