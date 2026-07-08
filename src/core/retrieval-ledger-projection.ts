/**
 * §5.AC/§5.AF retrieval-usefulness projection — the query over the `retrieval` ledger events (see
 * {@link buildRetrievalEvent}) that answers "is online retrieval actually EARNING its keep?": how often did a retrieval
 * turn HELP vs HURT the attempt, how aggressively are distractors pruned, and how many distinct sources get cited.
 * Pure over injected events (mirrors `agent-ledger-projections.ts`), so the retrieval loop's value is a testable read
 * over the same substrate as attempts — usable before/independent of any live retrieval run.
 */

import type { AgentLedgerEvent, AgentRetrievalEvent } from "./agent-attempt-ledger.js";

export interface RetrievalUsefulnessSummary {
	/** Total retrieval events. */
	total: number;
	helped: number;
	hurt: number;
	neutral: number;
	unknown: number;
	/**
	 * helped / (helped + hurt + neutral) — over events that carried a VERDICT (unknown excluded). 0 when none had a
	 * verdict. A retrieval loop that's earning its keep has this high.
	 */
	helpfulRate: number;
	/** Mean (distractorsPruned / hitsConsidered) over events with hitsConsidered > 0 — how selective the loop is. null when none. */
	meanDistractorPruneRatio: number | null;
	/** Total citations emitted across all retrieval turns (bag count). */
	totalCitations: number;
	/** Distinct cited sources across all turns (set count). */
	distinctCitedSources: number;
}

function isRetrieval(event: AgentLedgerEvent): event is AgentRetrievalEvent {
	return event.kind === "retrieval";
}

/**
 * Summarize the retrieval events in a ledger into usefulness metrics. Pure + total: an empty/retrieval-free ledger
 * yields all-zero counts with a 0 helpful rate and a null prune ratio.
 */
export function summarizeRetrievalUsefulness(events: readonly AgentLedgerEvent[]): RetrievalUsefulnessSummary {
	const retrievals = events.filter(isRetrieval);
	let helped = 0;
	let hurt = 0;
	let neutral = 0;
	let unknown = 0;
	let totalCitations = 0;
	const distinctSources = new Set<string>();
	const pruneRatios: number[] = [];

	for (const event of retrievals) {
		switch (event.signal) {
			case "helped":
				helped += 1;
				break;
			case "hurt":
				hurt += 1;
				break;
			case "neutral":
				neutral += 1;
				break;
			case "unknown":
				unknown += 1;
				break;
		}
		totalCitations += event.citations.length;
		for (const source of event.citations) {
			distinctSources.add(source);
		}
		if (event.hitsConsidered > 0) {
			pruneRatios.push(event.distractorsPruned / event.hitsConsidered);
		}
	}

	const verdicts = helped + hurt + neutral;
	const meanDistractorPruneRatio =
		pruneRatios.length === 0 ? null : pruneRatios.reduce((total, value) => total + value, 0) / pruneRatios.length;
	return {
		total: retrievals.length,
		helped,
		hurt,
		neutral,
		unknown,
		helpfulRate: verdicts === 0 ? 0 : helped / verdicts,
		meanDistractorPruneRatio,
		totalCitations,
		distinctCitedSources: distinctSources.size,
	};
}
