/**
 * Instrumented dependencies. FROZEN: evidence, not workspace.
 *
 * Both probes are pure and deterministic, so their CALL COUNTS are exact and identical on every machine — which is
 * the only kind of performance claim worth grading. Neither is slow in wall-clock terms; that is deliberate. The
 * question is not "did it feel fast" but "how many times did you ask for something you already knew".
 */

export function createPriceBook(rates) {
	const table = new Map(Object.entries(rates));
	let calls = 0;
	return {
		/** The rate for a currency. Counted. */
		rateFor(currency) {
			calls += 1;
			const rate = table.get(currency);
			if (rate === undefined) {
				throw new RangeError(`no rate for ${currency}`);
			}
			return rate;
		},
		calls: () => calls,
	};
}

export function createScorer() {
	let calls = 0;
	return {
		/** A pure score for an item. Counted. Same item, same score — always. */
		scoreOf(item) {
			calls += 1;
			let score = 0;
			for (const character of `${item.id}:${item.tier}`) {
				score = (score * 31 + character.codePointAt(0)) % 100000;
			}
			return score;
		},
		calls: () => calls,
	};
}
