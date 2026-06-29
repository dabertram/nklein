/**
 * Query-plan ("rewrite") step for the §5.AC retrieval loop. Given a task and its §5.B knowledge-debt items, this module
 * produces a small, deterministic query plan that the retrieval loop uses to drive searches. It is the structural core
 * of the rewrite step: a model-assisted pass can later refine the queries, but this pure layer ensures the loop always
 * has a valid, well-formed plan even without a live LLM call.
 *
 * Design notes
 * ────────────
 * • PURE — no LLM, no network, no I/O, no `Date.now()`. Every input → output mapping is fully deterministic.
 * • `primaryQuery` is the trimmed, whitespace-collapsed task text — the most direct expression of what the agent needs.
 * • `alternateQueries` are formed from knowledge-debt items (§5.B): each debt item is prepended to the task text so the
 *   retrieval loop can surface sources that specifically address the gap. They are deduped, stripped of any item that
 *   already equals the primary, and capped at 5 to keep the retrieval fan-out bounded.
 * • `freshnessNeed` is "fresh" when the caller flags `freshnessSensitive` or when the task text itself contains a
 *   recency cue (see RECENCY_CUES below). The retrieval loop uses this to route results through the §5.AC freshness
 *   judge (retrieval-freshness.ts) before accepting a source.
 */

/** Recency cue patterns that force `freshnessNeed = "fresh"` regardless of the `freshnessSensitive` flag. */
const RECENCY_CUES = ["latest", "current", "newest", "today", "2025", "2026", "release notes", "changelog"] as const;

/** Input to the query-plan builder. */
export interface RetrievalQueryPlanInput {
	/** The task text to be answered by retrieval. */
	task: string;
	/**
	 * Knowledge-debt items (§5.B): gaps the current context cannot fill from memory alone. Each drives one alternate
	 * query that targets that specific gap.
	 */
	knowledgeDebt?: readonly string[];
	/**
	 * When true, the plan is forced to `freshnessNeed = "fresh"` regardless of task text. Set by the caller when the
	 * task domain is inherently time-sensitive (e.g. market data, live API state, version checks).
	 */
	freshnessSensitive?: boolean;
}

/** A small, structured query plan produced by the rewrite step. */
export interface RetrievalQueryPlan {
	/** The primary query: trimmed, whitespace-collapsed task text. */
	primaryQuery: string;
	/**
	 * Alternate queries derived from knowledge-debt items. Each is `"${debtItem} ${task}"`, trimmed and
	 * whitespace-collapsed, deduped, and capped at 5. Any item that would equal the primaryQuery is excluded.
	 */
	alternateQueries: string[];
	/**
	 * "fresh" when the plan requires up-to-date sources (caller flag or recency cue detected in the task text);
	 * "any" when temporal currency is not critical.
	 */
	freshnessNeed: "fresh" | "any";
}

/** Collapse runs of whitespace to a single space and trim leading/trailing whitespace. */
function normalise(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Return true when `text` contains any recency cue (case-insensitive). */
function hasRecencyCue(text: string): boolean {
	const lower = text.toLowerCase();
	return RECENCY_CUES.some((cue) => lower.includes(cue));
}

/**
 * Build a deterministic query plan for the §5.AC retrieval loop.
 *
 * The plan is the "rewrite" step: it transforms a raw task + knowledge-debt into a set of well-formed queries ready
 * for the retrieval layer, plus a freshness directive the loop uses to gate source age.
 */
export function buildRetrievalQueryPlan(input: RetrievalQueryPlanInput): RetrievalQueryPlan {
	const primaryQuery = normalise(input.task);

	const freshnessNeed: "fresh" | "any" =
		input.freshnessSensitive === true || hasRecencyCue(primaryQuery) ? "fresh" : "any";

	const debt = input.knowledgeDebt ?? [];
	const seen = new Set<string>();
	const alternateQueries: string[] = [];

	for (const debtItem of debt) {
		if (alternateQueries.length >= 5) {
			break;
		}
		const candidate = normalise(`${debtItem} ${input.task}`);
		if (candidate === primaryQuery || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		alternateQueries.push(candidate);
	}

	return { primaryQuery, alternateQueries, freshnessNeed };
}
