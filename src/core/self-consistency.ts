/**
 * Self-consistency sampling: majority-vote across N sampled reasoning paths (todo §5.AD).
 *
 * Cheap alternative to full ensemble diversity: run the reasoning loop N times, collect
 * samples, and let the majority decide. Stable tie-breaking (first-seen group wins) ensures
 * deterministic reproducibility across runs.
 */

export interface MajorityVoteResult<T> {
	/** The representative sample from the winning group (null when samples is empty). */
	winner: T | null;
	/** Size of the winning group. */
	count: number;
	/** Total number of samples. */
	total: number;
	/** Agreement ratio (count/total, 0 when empty). */
	agreement: number;
}

/**
 * Pick the most-frequent sample, grouped by a key function.
 *
 * @param samples - Readonly array of samples to vote on.
 * @param keyFn - Optional function to extract a grouping key from each sample.
 *                Defaults to `JSON.stringify` for stable equality.
 * @returns A result object with the winner (one representative from the majority group),
 *          group size, total samples, and agreement ratio (0–1). Ties break toward the
 *          first-seen group.
 */
export function majorityVote<T>(samples: readonly T[], keyFn?: (value: T) => string): MajorityVoteResult<T> {
	if (samples.length === 0) {
		return { winner: null, count: 0, total: 0, agreement: 0 };
	}

	const key = keyFn ?? ((v) => JSON.stringify(v));
	const groupCounts = new Map<string, number>();
	const groupFirstSample = new Map<string, T>();
	const groupOrder: string[] = [];

	for (const sample of samples) {
		const k = key(sample);
		if (!groupCounts.has(k)) {
			groupOrder.push(k);
			groupFirstSample.set(k, sample);
			groupCounts.set(k, 0);
		}
		groupCounts.set(k, (groupCounts.get(k) ?? 0) + 1);
	}

	// Find the winning group (first-seen breaks ties). groupOrder is non-empty (samples.length > 0 above).
	let winningKey = groupOrder[0] ?? "";
	let maxCount = groupCounts.get(winningKey) ?? 0;

	for (const k of groupOrder) {
		const count = groupCounts.get(k) ?? 0;
		if (count > maxCount) {
			maxCount = count;
			winningKey = k;
		}
	}

	return {
		winner: groupFirstSample.get(winningKey) ?? null,
		count: maxCount,
		total: samples.length,
		agreement: maxCount / samples.length,
	};
}
