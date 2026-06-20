/**
 * LLMLingua-2-style selective prompt compression (arXiv:2403.12968).
 *
 * LLMLingua-2 frames compression as token classification: keep the highest-information tokens, drop the rest,
 * to hit a target compression ratio while preserving meaning. The keep/drop *decision* is the value; the
 * *scorer* is pluggable:
 *  - `heuristicTokenImportanceScorer` (default, zero dependencies) — best for limited hardware, runs anywhere.
 *  - an ONNX/transformer scorer (XLM-RoBERTa token classifier) injected via `TokenImportanceScorer` when the
 *    user opts into the heavier "batteries-included" model (downloaded at runtime; see
 *    `cline-compression-model-manager`).
 *
 * Shipping a 500MB encoder for compression on limited hardware competes with the main model for RAM, so the
 * heuristic is the default and the ONNX scorer is opt-in. This module is pure and unit-tested.
 */

export interface CompressibleToken {
	text: string;
	/** Index in the original token stream. */
	index: number;
	/** Token is structural (whitespace/punctuation/newline) and is always preserved. */
	structural: boolean;
}

export type TokenImportanceScorer = (tokens: CompressibleToken[], context: { fullText: string }) => number[];

export interface CompressOptions {
	/** Fraction of *droppable* tokens to keep (0..1). 1 keeps everything; 0.5 drops the least-important half. */
	targetRatio: number;
	scorer?: TokenImportanceScorer;
}

export interface CompressResult {
	compressed: string;
	originalTokenCount: number;
	keptTokenCount: number;
	keptRatio: number;
}

const WORD_OR_GAP = /(\s+|[^\s]+)/gu;
const STRUCTURAL = /^\s+$/u;

export function tokenizeForCompression(text: string): CompressibleToken[] {
	const tokens: CompressibleToken[] = [];
	const matches = text.match(WORD_OR_GAP) ?? [];
	let index = 0;
	for (const piece of matches) {
		tokens.push({ text: piece, index, structural: STRUCTURAL.test(piece) });
		index += 1;
	}
	return tokens;
}

const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"but",
	"of",
	"to",
	"in",
	"on",
	"for",
	"with",
	"as",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"that",
	"this",
	"these",
	"those",
	"it",
	"its",
	"at",
	"by",
	"from",
	"so",
	"if",
	"then",
	"than",
	"into",
	"about",
	"we",
	"you",
	"i",
	"they",
	"he",
	"she",
	"them",
	"our",
	"your",
]);

/**
 * Heuristic importance: rare words, identifiers/symbols, capitalized/long tokens, and tokens near the start/end
 * score higher; stop-words score lowest. Deterministic and dependency-free.
 */
export function heuristicTokenImportanceScorer(tokens: CompressibleToken[], _context: { fullText: string }): number[] {
	const frequency = new Map<string, number>();
	for (const token of tokens) {
		if (token.structural) {
			continue;
		}
		const key = token.text.toLowerCase();
		frequency.set(key, (frequency.get(key) ?? 0) + 1);
	}
	const wordTokens = tokens.filter((token) => !token.structural).length;
	return tokens.map((token) => {
		if (token.structural) {
			return Number.POSITIVE_INFINITY; // never dropped
		}
		const lower = token.text.toLowerCase();
		if (STOP_WORDS.has(lower)) {
			return 0.1;
		}
		let score = 1;
		// Rarity: a token appearing once is more informative than a frequently repeated one.
		score += 1 / (frequency.get(lower) ?? 1);
		// Code/identifier signal: punctuation, camelCase, snake_case, digits, paths.
		if (/[A-Z]/u.test(token.text) || /[_.()[\]{}/<>:;=]/u.test(token.text) || /\d/u.test(token.text)) {
			score += 1;
		}
		// Longer tokens tend to carry more meaning.
		if (token.text.length >= 8) {
			score += 0.5;
		}
		// Position: earliest and latest content tends to anchor meaning.
		const positionRatio = wordTokens > 0 ? token.index / tokens.length : 0;
		if (positionRatio < 0.1 || positionRatio > 0.9) {
			score += 0.5;
		}
		return score;
	});
}

export function compressByTokenImportance(text: string, options: CompressOptions): CompressResult {
	const tokens = tokenizeForCompression(text);
	const droppable = tokens.filter((token) => !token.structural);
	const originalTokenCount = droppable.length;
	const targetRatio = Math.min(1, Math.max(0, options.targetRatio));
	if (originalTokenCount === 0 || targetRatio >= 1) {
		return { compressed: text, originalTokenCount, keptTokenCount: originalTokenCount, keptRatio: 1 };
	}
	const scorer = options.scorer ?? heuristicTokenImportanceScorer;
	const scores = scorer(tokens, { fullText: text });
	// Rank droppable tokens by score; keep the top `targetRatio` fraction.
	const keepCount = Math.max(1, Math.round(originalTokenCount * targetRatio));
	const rankedDroppable = droppable
		.map((token) => ({ index: token.index, score: scores[token.index] ?? 0 }))
		.sort((a, b) => b.score - a.score);
	const keptIndices = new Set(rankedDroppable.slice(0, keepCount).map((entry) => entry.index));

	const pieces: string[] = [];
	let previousKeptStructural = true;
	for (const token of tokens) {
		if (token.structural) {
			pieces.push(token.text);
			previousKeptStructural = true;
			continue;
		}
		if (keptIndices.has(token.index)) {
			pieces.push(token.text);
			previousKeptStructural = false;
		} else if (!previousKeptStructural) {
			// Collapse runs of dropped words into a single space to avoid double spaces.
			pieces.push(" ");
			previousKeptStructural = true;
		}
	}
	const compressed = pieces
		.join("")
		.replace(/[ \t]{2,}/gu, " ")
		.replace(/ *\n */gu, "\n");
	return {
		compressed,
		originalTokenCount,
		keptTokenCount: keptIndices.size,
		keptRatio: keptIndices.size / originalTokenCount,
	};
}
