/**
 * Pure weighted PageRank over an index-keyed graph, extracted from nklein-repo-map (where it ranks
 * code symbols by reference importance). Operates only on plain numbers/Maps, so it is generic and
 * behavior-preserving relative to the inline implementation.
 */

const PAGERANK_DAMPING = 0.85;
const PAGERANK_ITERATIONS = 24;

/**
 * Build a normalized teleport (personalization) vector from per-node weights, or null when no node is
 * boosted (weight > 1) so the caller can fall back to a uniform teleport.
 */
export function buildPersonalizationVector(weights: readonly number[]): number[] | null {
	const hasBoost = weights.some((weight) => weight > 1);
	if (!hasBoost) {
		return null;
	}
	const totalWeight = weights.reduce((total, weight) => total + weight, 0);
	return weights.map((weight) => weight / totalWeight);
}

/** Accumulate a directed weighted edge into the adjacency map (self-loops and non-positive weights are ignored). */
export function addWeightedEdge(
	edges: Map<number, Map<number, number>>,
	fromIndex: number,
	toIndex: number,
	weight: number,
): void {
	if (fromIndex === toIndex || weight <= 0) {
		return;
	}
	const outgoing = edges.get(fromIndex) ?? new Map<number, number>();
	outgoing.set(toIndex, (outgoing.get(toIndex) ?? 0) + weight);
	edges.set(fromIndex, outgoing);
}

/**
 * Run damped PageRank for a fixed number of iterations over `symbolCount` nodes and the weighted
 * `edges` adjacency, redistributing dangling-node mass via the teleport vector. Uses the given
 * personalization vector (when its length matches) else a uniform teleport. Returns per-node ranks.
 */
export function calculatePageRank(
	symbolCount: number,
	edges: ReadonlyMap<number, ReadonlyMap<number, number>>,
	personalizationVector?: readonly number[] | null,
): number[] {
	if (symbolCount === 0) {
		return [];
	}
	const teleportVector =
		personalizationVector?.length === symbolCount
			? [...personalizationVector]
			: Array.from({ length: symbolCount }, () => 1 / symbolCount);
	let ranks = [...teleportVector];
	for (let iteration = 0; iteration < PAGERANK_ITERATIONS; iteration += 1) {
		const nextRanks = teleportVector.map((weight) => (1 - PAGERANK_DAMPING) * weight);
		let danglingRank = 0;
		for (let fromIndex = 0; fromIndex < symbolCount; fromIndex += 1) {
			const outgoing = edges.get(fromIndex);
			if (!outgoing || outgoing.size === 0) {
				danglingRank += ranks[fromIndex] ?? 0;
				continue;
			}
			const totalWeight = [...outgoing.values()].reduce((total, weight) => total + weight, 0);
			for (const [toIndex, weight] of outgoing) {
				nextRanks[toIndex] =
					(nextRanks[toIndex] ?? 0) + PAGERANK_DAMPING * (ranks[fromIndex] ?? 0) * (weight / totalWeight);
			}
		}
		ranks = nextRanks.map((rank, index) => rank + PAGERANK_DAMPING * danglingRank * (teleportVector[index] ?? 0));
	}
	return ranks;
}
