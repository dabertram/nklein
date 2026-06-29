/**
 * Retrieval reranking: deterministic lexical scorer for search hits.
 *
 * Tied to §5.AC (retrieval loop — rerank hits by relevance, the llmaker pattern).
 * This is the cheap deterministic baseline; an LLM cross-encoder rerank can replace/augment it later.
 *
 * Exports a pure-logic core:
 * - `lexicalRelevanceScore`: fraction of DISTINCT query terms that appear as substrings in text (0..1).
 * - `rerankByRelevance`: tokenize query, score all candidates, return sorted by score DESC (stable ties).
 */

export interface RerankCandidate {
	/** Unique identifier for the candidate. */
	id: string;

	/** Title + snippet to score against the query. */
	text: string;
}

export interface RerankedHit {
	/** Candidate ID. */
	id: string;

	/** Relevance score: fraction of distinct query terms found (0..1). */
	score: number;
}

/**
 * Score a piece of text by the fraction of distinct query terms it contains (as substrings).
 *
 * @param queryTerms Distinct lowercased word terms (already split and normalized).
 * @param text The text to score (title + snippet).
 * @returns Fraction in [0, 1]. Returns 0 if no query terms or text is empty.
 */
export function lexicalRelevanceScore(queryTerms: readonly string[], text: string): number {
	if (queryTerms.length === 0 || text.length === 0) {
		return 0;
	}

	const lowerText = text.toLowerCase();
	let matchCount = 0;

	for (const term of queryTerms) {
		if (lowerText.includes(term)) {
			matchCount++;
		}
	}

	return matchCount / queryTerms.length;
}

/**
 * Rerank candidates by lexical relevance to the query.
 *
 * Tokenizes the query into distinct lowercased word terms (split on non-word chars, drop empties),
 * scores each candidate via `lexicalRelevanceScore`, and returns candidates sorted by score DESC.
 * Ties preserve the original input order (stable).
 *
 * @param query The search query string.
 * @param candidates The list of candidates to rerank.
 * @returns RerankedHit[] sorted by score DESC, with stable tie-breaking.
 */
export function rerankByRelevance(query: string, candidates: readonly RerankCandidate[]): RerankedHit[] {
	// Tokenize query: split on non-word chars, lowercase, deduplicate.
	const rawTerms = query.split(/\W+/).filter((term) => term.length > 0);
	const queryTermsSet = new Set(rawTerms.map((term) => term.toLowerCase()));
	const queryTerms = Array.from(queryTermsSet);

	// Score each candidate and pair with its original index (for stable sort).
	const scored = candidates.map((candidate, index) => ({
		id: candidate.id,
		score: lexicalRelevanceScore(queryTerms, candidate.text),
		originalIndex: index,
	}));

	// Sort by score DESC, then by original index ASC (stable).
	scored.sort((a, b) => {
		const scoreDiff = b.score - a.score;
		return scoreDiff !== 0 ? scoreDiff : a.originalIndex - b.originalIndex;
	});

	// Return the reranked hits without the original index.
	return scored.map(({ id, score }) => ({ id, score }));
}
