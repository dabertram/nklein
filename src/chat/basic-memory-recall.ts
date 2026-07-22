import type { BasicMemoryRecallSource } from "../core/basic-memory-note-reader.js";
import { ageDecay, explainRecall, verdictRecallWeight } from "../core/basic-memory-provenance.js";
import { lexicalSimilarity } from "./chat-memory-store.js";

/**
 * F2.9b — rank basic-memory notes for chat recall against the turn's query. A first-cut LEXICAL ranker (token overlap
 * of the query against title + body, via {@link lexicalSimilarity}); the deeper semantic tuning is deferred. Returns the
 * `BasicMemoryNoteInput` shape `projectUnifiedMemory` consumes: only notes with a positive score, highest first, capped.
 */

export interface RankedBasicMemoryNote {
	permalink: string;
	title: string;
	excerpt: string;
	score: number;
	auditVerdict: BasicMemoryRecallSource["auditVerdict"];
	recallReason: string;
}

const DEFAULT_EXCERPT_CHARS = 240;

export function rankBasicMemoryNotesForRecall(
	sources: readonly BasicMemoryRecallSource[],
	query: string,
	limit = 6,
	now = Date.now(),
): RankedBasicMemoryNote[] {
	return sources
		.filter((source) => source.auditVerdict !== "contradicted")
		.map((source) => {
			const baseRelevance = lexicalSimilarity(query, `${source.title} ${source.body}`);
			const ageDays = Math.max(0, now - (source.createdAtMs ?? now)) / 86_400_000;
			const verdictWeight = verdictRecallWeight(source.auditVerdict);
			const ageDecayFactor = ageDecay(ageDays);
			const score = baseRelevance * verdictWeight * ageDecayFactor;
			return {
				permalink: source.permalink,
				title: source.title,
				excerpt: source.body.replace(/\s+/g, " ").trim().slice(0, DEFAULT_EXCERPT_CHARS),
				score,
				auditVerdict: source.auditVerdict ?? null,
				recallReason: explainRecall({
					ref: source.permalink,
					baseRelevance,
					auditVerdict: source.auditVerdict ?? null,
					ageDays,
					effectiveScore: score,
					verdictWeight,
					ageDecayFactor,
				}),
			};
		})
		.filter((note) => note.score > 0)
		.sort((a, b) => b.score - a.score || a.permalink.localeCompare(b.permalink))
		.slice(0, Math.max(0, limit));
}
