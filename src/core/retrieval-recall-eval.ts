/**
 * §5.I — recall@k evaluation for the code-retrieval modes (lexical-only · dense-only · lexical→dense rerank) on a
 * LABELED query set, so the "does dense pay its way?" decision is made from numbers, not vibes. Pure: retrieval per
 * mode is injected as a ranking function (the runtime wires the real lexical scorer / embedding search), so the
 * measurement math is deterministic + unit-testable, and the same harness runs against the live index later.
 *
 * recall@k = |relevant ∩ top-k| / |relevant| per query, averaged (macro) across the query set — the standard IR
 * definition; k defaults to the caller's cutoffs (e.g. [1, 5, 10]).
 */

export interface LabeledRetrievalQuery {
	/** The natural-language query. */
	query: string;
	/** The ids of ALL documents/chunks that count as relevant for this query (ground truth). */
	relevantIds: readonly string[];
}

/** A retrieval mode: rank the corpus for a query, best first (return document ids). */
export type RetrievalRanker = (query: string) => readonly string[];

export interface RecallAtK {
	k: number;
	/** Macro-averaged recall@k in [0,1] across the labeled queries. */
	recall: number;
}

export interface RetrievalModeReport {
	mode: string;
	recallAtK: RecallAtK[];
}

export interface RecallComparisonReport {
	modes: RetrievalModeReport[];
	/** Number of labeled queries evaluated. */
	queryCount: number;
	/**
	 * The winning mode per k (highest recall; ties keep the EARLIER mode — list cheaper modes first so a tie reads
	 * "the cheaper mode is enough").
	 */
	bestModeByK: Record<number, string>;
}

/** recall@k for one query: |relevant ∩ top-k| / |relevant|. An empty ground truth contributes 0 (a labeling bug). */
export function recallAtK(rankedIds: readonly string[], relevantIds: readonly string[], k: number): number {
	if (relevantIds.length === 0 || k <= 0) {
		return 0;
	}
	const relevant = new Set(relevantIds);
	let hits = 0;
	for (const id of rankedIds.slice(0, k)) {
		if (relevant.has(id)) {
			hits += 1;
		}
	}
	return hits / relevant.size;
}

/** Evaluate one retrieval mode over the labeled set at the given cutoffs (macro-averaged). */
export function evaluateRetrievalMode(
	mode: string,
	ranker: RetrievalRanker,
	queries: readonly LabeledRetrievalQuery[],
	ks: readonly number[],
): RetrievalModeReport {
	const totals = new Map<number, number>(ks.map((k) => [k, 0]));
	for (const labeled of queries) {
		const ranked = ranker(labeled.query);
		for (const k of ks) {
			totals.set(k, (totals.get(k) ?? 0) + recallAtK(ranked, labeled.relevantIds, k));
		}
	}
	const count = Math.max(1, queries.length);
	return {
		mode,
		recallAtK: ks.map((k) => ({ k, recall: (totals.get(k) ?? 0) / count })),
	};
}

/**
 * Compare retrieval modes on one labeled set. `modes` order matters for ties: list the cheaper mode first so an
 * equal-recall tie resolves to it ("dense must BEAT lexical to pay its way", not just match it).
 */
export function compareRetrievalModes(
	modes: ReadonlyArray<{ mode: string; ranker: RetrievalRanker }>,
	queries: readonly LabeledRetrievalQuery[],
	ks: readonly number[] = [1, 5, 10],
): RecallComparisonReport {
	const reports = modes.map((entry) => evaluateRetrievalMode(entry.mode, entry.ranker, queries, ks));
	const bestModeByK: Record<number, string> = {};
	for (const k of ks) {
		let best: { mode: string; recall: number } | null = null;
		for (const report of reports) {
			const point = report.recallAtK.find((entry) => entry.k === k);
			if (point && (best === null || point.recall > best.recall)) {
				best = { mode: report.mode, recall: point.recall };
			}
		}
		if (best) {
			bestModeByK[k] = best.mode;
		}
	}
	return { modes: reports, queryCount: queries.length, bestModeByK };
}
