import type { NKleinCodeEmbeddingVector } from "./nklein-code-embeddings";

/**
 * Pure sparse-vector helpers for the code index, extracted from nklein-code-index. A vector is a
 * `Map<token, weight>`; these serialize it to/from sorted entries and compute cosine similarity. No
 * I/O, so behavior-preserving and unit-testable.
 */

/** Serialize a sparse vector to entries, sorted by token for a stable on-disk representation. */
export function vectorToEntries(vector: NKleinCodeEmbeddingVector): Array<[string, number]> {
	return [...vector.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/** Rebuild a sparse vector from entries, dropping blank tokens and non-finite weights. */
export function entriesToVector(entries: Array<[string, number]>): NKleinCodeEmbeddingVector {
	return new Map(entries.filter(([token, value]) => token.trim().length > 0 && Number.isFinite(value)));
}

/** Cosine similarity of two sparse vectors; 0 when either is empty/zero-magnitude. */
export function cosineSimilarity(left: NKleinCodeEmbeddingVector, right: NKleinCodeEmbeddingVector): number {
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;
	for (const value of left.values()) {
		leftMagnitude += value * value;
	}
	for (const value of right.values()) {
		rightMagnitude += value * value;
	}
	for (const [token, leftValue] of left) {
		dot += leftValue * (right.get(token) ?? 0);
	}
	if (leftMagnitude === 0 || rightMagnitude === 0) {
		return 0;
	}
	return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
