import type { BasicMemoryRecallSource } from "../core/basic-memory-note-reader.js";
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
}

const DEFAULT_EXCERPT_CHARS = 240;

export function rankBasicMemoryNotesForRecall(
	sources: readonly BasicMemoryRecallSource[],
	query: string,
	limit = 6,
): RankedBasicMemoryNote[] {
	return sources
		.map((source) => ({
			permalink: source.permalink,
			title: source.title,
			excerpt: source.body.replace(/\s+/g, " ").trim().slice(0, DEFAULT_EXCERPT_CHARS),
			score: lexicalSimilarity(query, `${source.title} ${source.body}`),
		}))
		.filter((note) => note.score > 0)
		.sort((a, b) => b.score - a.score || a.permalink.localeCompare(b.permalink))
		.slice(0, Math.max(0, limit));
}
