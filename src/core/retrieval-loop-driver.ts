/**
 * §5.AC retrieval-loop DRIVER — the effectful orchestrator that wraps the pure `nextRetrievalAction` state machine
 * (retrieval-loop-state.ts explicitly defers to "the driver that wraps this core") and composes the §5.AC cluster into
 * the actual "knows-today" retrieval loop.
 *
 * PRIME DIRECTIVE #1 (local-only): the driver NEVER opens a socket or calls a model itself. The egress (search/fetch)
 * and model (synthesise) steps are INJECTED as {@link RetrievalLoopDeps} — the caller supplies gated, opt-in adapters
 * (a web-search/browse tool behind the §5.L egress policy; an LLM synthesiser). So the loop's decision logic here is
 * pure orchestration over injected effects, fully unit-testable with fakes: no real network, no model, no clock.
 *
 * The loop per round: formulate a query plan (buildRetrievalQueryPlan) → search (injected) → rank the hits by
 * freshness×authority (rankByFreshnessAuthority) → fetch (injected) the top hits → assess sufficiency
 * (assessRetrievalSufficiency); if not sufficient, advance to the next query or exhaust the iteration budget; when
 * sufficient (or budget-exhausted) → synthesise (injected) a cited answer over the gathered evidence. Bounded by
 * `maxIterations`; a dead-end (zero-hit) query advances the round rather than re-searching; a failed fetch is skipped.
 */

import { classifyTopicVolatility, freshnessThresholdsForVolatility } from "./knowledge-volatility-ttl";
import { type RankableSource, rankByFreshnessAuthority } from "./retrieval-freshness-authority-rank";
import { nextRetrievalAction, type RetrievalAction, type RetrievalLoopState } from "./retrieval-loop-state";
import { buildRetrievalQueryPlan, type RetrievalQueryPlan } from "./retrieval-query-plan";
import type { SourceKind } from "./retrieval-source-trust";
import { assessRetrievalSufficiency, type SufficiencyVerdict } from "./retrieval-sufficiency";

/** A search hit the injected `search` returns (before its full text is fetched). */
export interface RetrievalHit {
	/** Stable id for identity across rank → fetch. */
	id: string;
	url?: string;
	title?: string;
	snippet?: string;
	sourceType?: SourceKind;
	publishedAt?: Date | string | number | null;
	/** Optional pre-computed query relevance in [0,1] (e.g. from a reranker) — folded into the ranking. */
	relevance?: number;
}

/** Evidence the injected `fetch` returns for a hit (its usable text). */
export interface RetrievalEvidence {
	id: string;
	url?: string;
	text: string;
	sourceType?: SourceKind;
	publishedAt?: Date | string | number | null;
}

/** The injected, CALLER-GATED effects (prime directive #1: egress + model live ONLY here, opt-in). */
export interface RetrievalLoopDeps {
	/** EGRESS: search a query → hits (order-agnostic; the driver ranks them by freshness×authority). */
	search: (query: string, signal?: AbortSignal) => Promise<readonly RetrievalHit[]>;
	/** EGRESS: fetch one hit → its evidence text. May reject — the driver SKIPS a failed fetch, never rethrows it. */
	fetch: (hit: RetrievalHit, signal?: AbortSignal) => Promise<RetrievalEvidence>;
	/** MODEL (optional): synthesise gathered evidence into a cited answer. Omitted ⇒ `answer` is null (evidence only). */
	synthesize?: (
		input: { task: string; evidence: readonly RetrievalEvidence[] },
		signal?: AbortSignal,
	) => Promise<string>;
	/** Injected clock (ms) for the recency axis — prime directive: no `Date.now()` inside the loop. */
	now: () => number;
}

export interface RetrievalLoopOptions {
	/** Hard cap on search rounds (each round = one query's search + fetch + sufficiency check). Default 3. */
	maxIterations?: number;
	/** Max hits fetched per query (bounds the egress fan-out). Default 3. */
	maxFetchPerQuery?: number;
	/** Sufficiency source floor — avoids single-source brittleness. Default 2. */
	minSources?: number;
	/** Force the freshness gate (else inferred from the task's recency cues by buildRetrievalQueryPlan). */
	freshnessSensitive?: boolean;
	/**
	 * OPT-IN (default false): tune the ranker's freshness bands to the task's knowledge VOLATILITY (§5.AC
	 * `knowledge-volatility-ttl.ts`). When on, the task text is classified once (`classifyTopicVolatility`) and the
	 * derived `freshnessThresholdsForVolatility(class)` are passed to `rankByFreshnessAuthority`, so a fast-moving topic
	 * bands an aged source `stale` while an evergreen one bands the SAME source `current`. When off (default) the ranker
	 * is called exactly as before (default thresholds) — byte-identical, no behaviour change.
	 */
	topicAwareFreshness?: boolean;
	/** §5.B knowledge-debt items → alternate queries. */
	knowledgeDebt?: readonly string[];
	signal?: AbortSignal;
}

export interface RetrievalLoopResult {
	queryPlan: RetrievalQueryPlan;
	/** The ordered action trace (from nextRetrievalAction) — audit/telemetry. */
	actions: RetrievalAction[];
	/** The gathered, fetched evidence (deduped by id, in fetch order). */
	evidence: RetrievalEvidence[];
	/** The final sufficiency verdict over the gathered evidence. */
	sufficiency: SufficiencyVerdict;
	/** The synthesised cited answer, or null when no synthesiser was supplied / no evidence was gathered. */
	answer: string | null;
	/** Why the loop stopped. */
	stoppedBecause: "sufficient" | "budget_exhausted";
	/** Number of search rounds run. */
	iterations: number;
}

/** Freshness verdicts that satisfy a "fresh" plan's freshness gate. */
const FRESH_VERDICTS: ReadonlySet<string> = new Set(["current", "recent"]);

function toRankable(hit: RetrievalHit): RankableSource {
	return {
		id: hit.id,
		...(hit.url !== undefined ? { url: hit.url } : {}),
		...(hit.sourceType !== undefined ? { sourceType: hit.sourceType } : {}),
		...(hit.publishedAt !== undefined ? { publishedAt: hit.publishedAt } : {}),
		...(hit.relevance !== undefined ? { relevance: hit.relevance } : {}),
	};
}

/**
 * Drive the §5.AC retrieval loop to a cited answer. Deterministic given deterministic injected deps; bounded by
 * `maxIterations` (plus a defensive step ceiling). Never throws for a failed fetch (that hit is skipped).
 */
export async function runRetrievalLoop(
	task: string,
	deps: RetrievalLoopDeps,
	options: RetrievalLoopOptions = {},
): Promise<RetrievalLoopResult> {
	const maxIterations = Math.max(1, Math.trunc(options.maxIterations ?? 3));
	const maxFetchPerQuery = Math.max(1, Math.trunc(options.maxFetchPerQuery ?? 3));
	const minSources = options.minSources ?? 2;

	const queryPlan = buildRetrievalQueryPlan({
		task,
		...(options.knowledgeDebt !== undefined ? { knowledgeDebt: options.knowledgeDebt } : {}),
		...(options.freshnessSensitive !== undefined ? { freshnessSensitive: options.freshnessSensitive } : {}),
	});

	// OPT-IN topic-aware freshness: classify the task's volatility ONCE and derive volatility-tuned freshness bands to
	// hand the ranker. Left undefined when the flag is off ⇒ the ranking call below stays byte-identical to before.
	const freshnessThresholds = options.topicAwareFreshness
		? freshnessThresholdsForVolatility(classifyTopicVolatility(task).volatility)
		: undefined;
	const rankOptions = freshnessThresholds ? { freshnessThresholds } : undefined;
	const queries = [queryPlan.primaryQuery, ...queryPlan.alternateQueries].filter((q) => q.length > 0);
	// The coverage requirement for sufficiency is the sub-questions the loop can ACTUALLY pursue within its iteration
	// budget: it covers one query per round and stops at `maxIterations`, so it can cover at most min(queries, maxIter).
	// Requiring coverage of MORE than that (e.g. 4 knowledge-debt sub-questions under the default 3-round budget) made
	// sufficiency permanently UNREACHABLE — the loop always falsely reported insufficient (→ needless escalation) even
	// with complete, fresh evidence (bug-hunt 2026-07-05). Cap the coverage set to what the budget allows; the source
	// floor + freshness gate still guard against declaring sufficiency without enough real/fresh evidence.
	const subQuestions = (queries.length > 0 ? queries : [queryPlan.primaryQuery]).slice(0, maxIterations);

	const evidence: RetrievalEvidence[] = [];
	const seenEvidence = new Set<string>();
	const coveredQueries: string[] = [];
	const actions: RetrievalAction[] = [];
	// Each hit's freshness verdict (by id), recorded at rank time and read when the hit is actually FETCHED — the gate is
	// flipped only by a fetched-and-kept fresh source (bug-hunt 2026-07-05), never by a hit that never reached evidence.
	const freshnessVerdictById = new Map<string, string>();
	let freshnessSatisfied = queryPlan.freshnessNeed === "any";

	let queryIndex = 0;
	let toFetch: RetrievalHit[] = [];

	const state: RetrievalLoopState = {
		iteration: 0,
		maxIterations,
		hasQueryPlan: false,
		hitCount: 0,
		fetchedCount: 0,
		sufficient: false,
	};

	// Advance to the next query (or exhaust the budget when none remain) and reset per-query search state.
	const advanceRound = (): void => {
		queryIndex++;
		state.iteration++;
		if (queryIndex >= queries.length) {
			state.iteration = maxIterations; // no queries left → budget-exhausted stop
		}
		state.hitCount = 0; // → next action is "search"
		state.fetchedCount = 0;
	};

	// Defensive step ceiling (each round ≤ 1 search + maxFetch fetches + 1 synthesize decision) so a mis-transition
	// can never spin — the loop's real termination is `sufficient` or `iteration >= maxIterations`.
	const stepCeiling = maxIterations * (maxFetchPerQuery + 3) + 4;
	let steps = 0;

	while (steps++ < stepCeiling) {
		const action = nextRetrievalAction(state);
		actions.push(action);
		if (action === "stop_sufficient" || action === "stop_budget_exhausted") {
			break;
		}
		if (action === "formulate_query") {
			state.hasQueryPlan = true;
			continue;
		}
		if (action === "search") {
			const query = queries[queryIndex] ?? queryPlan.primaryQuery;
			const hits = await deps.search(query, options.signal);
			const ranked = rankByFreshnessAuthority(hits.map(toRankable), new Date(deps.now()), rankOptions);
			// Record each hit's freshness verdict by id — do NOT flip the gate here. A fresh hit only satisfies the
			// freshness gate once it is actually FETCHED into `evidence` (below); flipping from `ranked` let a fresh hit
			// that is never fetched (buried past maxFetchPerQuery, or whose fetch throws) declare the loop "fresh &
			// sufficient" over purely stale evidence (bug-hunt 2026-07-05, HIGH, 3-lens consensus).
			for (const r of ranked) {
				freshnessVerdictById.set(r.id, r.freshnessVerdict);
			}
			const byId = new Map(hits.map((hit) => [hit.id, hit] as const));
			// Dedup by id BEFORE the slice: `ranked` can carry two entries for a duplicate hit id, both mapping (last-wins)
			// to the same hit — that would fill two of the `maxFetchPerQuery` slots with the same hit and STARVE a distinct
			// one. Keep the first occurrence of each id.
			const seenFetchIds = new Set<string>();
			toFetch = ranked
				.map((r) => byId.get(r.id))
				.filter((hit): hit is RetrievalHit => hit !== undefined)
				.filter((hit) => {
					if (seenFetchIds.has(hit.id)) {
						return false;
					}
					seenFetchIds.add(hit.id);
					return true;
				})
				.slice(0, maxFetchPerQuery);
			if (toFetch.length === 0) {
				// Dead-end query — don't re-search the same empty query; advance the round. Mark it covered too: an
				// ATTEMPTED query is covered for sufficiency even when it returned nothing, otherwise a single empty
				// query (e.g. the primary dead-ending while alternates return ample fresh evidence) would leave its
				// sub-question permanently uncovered and force the loop to always report INSUFFICIENT. The minSources
				// floor and the freshness gate still prevent declaring sufficiency without enough real/fresh evidence.
				coveredQueries.push(query);
				advanceRound();
			} else {
				coveredQueries.push(query); // a query that returned results counts as covered for sufficiency
				state.hitCount = toFetch.length;
				state.fetchedCount = 0;
			}
			continue;
		}
		if (action === "fetch") {
			const hit = toFetch[state.fetchedCount];
			if (hit) {
				try {
					const fetched = await deps.fetch(hit, options.signal);
					if (!seenEvidence.has(fetched.id)) {
						seenEvidence.add(fetched.id);
						evidence.push(fetched);
						// §5.AC freshness gate: satisfied ONLY by a fetched-and-kept fresh source (see the search branch).
						if (FRESH_VERDICTS.has(freshnessVerdictById.get(fetched.id) ?? "")) {
							freshnessSatisfied = true;
						}
					}
				} catch {
					// Skip a failed fetch (transient/blocked) — the loop still progresses.
				}
			}
			state.fetchedCount++;
			continue;
		}
		// action === "synthesize" (all hits for this query fetched): decide sufficiency, then stop or advance.
		const verdict = assessRetrievalSufficiency({
			subQuestions,
			coveredSubQuestions: coveredQueries,
			sourceCount: evidence.length,
			minSources,
			freshnessSatisfied,
		});
		if (verdict.sufficient) {
			state.sufficient = true; // → stop_sufficient on the next tick
		} else {
			advanceRound();
		}
	}

	const sufficiency = assessRetrievalSufficiency({
		subQuestions,
		coveredSubQuestions: coveredQueries,
		sourceCount: evidence.length,
		minSources,
		freshnessSatisfied,
	});
	const answer =
		deps.synthesize && evidence.length > 0 ? await deps.synthesize({ task, evidence }, options.signal) : null;
	const stoppedBecause: "sufficient" | "budget_exhausted" = state.sufficient ? "sufficient" : "budget_exhausted";
	return { queryPlan, actions, evidence, sufficiency, answer, stoppedBecause, iterations: state.iteration };
}
