/**
 * Pure lexical (keyword) scoring for the code index, extracted from nklein-code-index. Complements
 * the semantic vector score with a cheap substring/token overlap heuristic. No I/O, so
 * behavior-preserving and unit-testable.
 */

/**
 * Tokenize text for lexical scoring: split camelCase boundaries, lowercase, split on non-identifier
 * characters, trim, and keep tokens of length >= 2.
 */
export function tokenizeForLexicalScore(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9_$.-]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

/**
 * Score a chunk against a query: 50 for a full case-insensitive substring match, plus 8 per distinct
 * query token also present in the chunk.
 */
export function lexicalScore(chunkText: string, query: string): number {
	const lowerText = chunkText.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let score = lowerText.includes(lowerQuery) ? 50 : 0;
	for (const token of new Set(tokenizeForLexicalScore(query))) {
		if (lowerText.includes(token)) {
			score += 8;
		}
	}
	return score;
}
