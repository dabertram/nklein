/**
 * What is FILE-LEVEL conflict serialization actually costing us? PURE core.
 *
 * ── WHY THIS EXISTS ──
 * P21.12 proposes symbol-level conflict detection (lock AST symbols, not files) so two agents can edit different
 * functions in the same file. !Klein serializes on FILE overlap, which is strictly coarser — so the proposal is
 * obviously *better*, and the only real question is whether it is better by enough to be worth building.
 *
 * **Nothing measured that.** `getSharedLikelyTouchedPaths` exists so the runtime can LOG a culprit path, but no
 * aggregate ever asked how many card pairs are serialized, or by what. This computes it from real boards, so the
 * decision rests on a number instead of on the proposal sounding right.
 *
 * ── THE MEASUREMENT SEPARATES FIXTURES FROM REAL WORK, AND THAT IS THE WHOLE POINT ──
 * Measured 2026-08-01 over 14 real boards / 207 card pairs, the headline was **26% serialized** — which reads as
 * a strong case for P21.12. Split by board kind it inverts:
 *   · single-file benchmark katas (`aider-*`): **82%** of pairs serialized
 *   · real dev-test projects: **4%**
 * An aider kata is ONE FILE by construction, so every card necessarily collides; symbol-level detection would
 * unlock a lot of parallelism there and the parallelism would be an artifact of the fixture. On real multi-file
 * work the coarse rule is already ~96% precise, and 4% is an UPPER BOUND on what symbols could recover — some of
 * those pairs would conflict at symbol level too.
 *
 * Aggregating the two would have produced a number that justified building the thing. Splitting them is the
 * measurement.
 */

/** The slice of a board card this measurement needs. */
export interface SerializationCostCard {
	readonly id: string;
	readonly filesLikelyTouched?: readonly string[];
}

/** Classify a pair — injected so this core uses the SAME rule production does, never a re-implementation of it. */
export type PairConflictClassifier = (
	left: SerializationCostCard,
	right: SerializationCostCard,
) => { readonly conflictClass: string; readonly sharedSpecificPaths: readonly string[] };

export interface SerializationCostBoard {
	readonly name: string;
	/**
	 * True for single-file benchmark fixtures. Their collisions are a property of the fixture, not of !Klein's
	 * scheduling, so folding them into one rate produces a number that argues for work nobody needs.
	 */
	readonly isBenchmarkFixture: boolean;
	readonly cards: readonly SerializationCostCard[];
}

export interface SerializationCostGroup {
	readonly boards: number;
	readonly pairs: number;
	readonly serialized: number;
	/** null rather than 0 when there are no pairs — no boards is not "no serialization". */
	readonly rate: number | null;
}

export interface SerializationCostReport {
	readonly all: SerializationCostGroup;
	readonly realWork: SerializationCostGroup;
	readonly benchmarkFixtures: SerializationCostGroup;
	/** Paths causing the most serialization, worst first — the "one over-listed barrel index" signal. */
	readonly topPaths: readonly { readonly path: string; readonly pairs: number }[];
	/** Class tallies, so a mis-read verdict field cannot silently produce a clean zero. */
	readonly classCounts: Readonly<Record<string, number>>;
	readonly summary: string;
}

function group(boards: number, pairs: number, serialized: number): SerializationCostGroup {
	return { boards, pairs, serialized, rate: pairs === 0 ? null : serialized / pairs };
}

export function measureSerializationCost(input: {
	readonly boards: readonly SerializationCostBoard[];
	readonly classify: PairConflictClassifier;
	readonly topPathLimit?: number;
}): SerializationCostReport {
	const tally = { all: [0, 0, 0], real: [0, 0, 0], bench: [0, 0, 0] };
	const pathPairs = new Map<string, number>();
	const classCounts: Record<string, number> = {};

	for (const board of input.boards) {
		// A card with no declared scope cannot collide by this rule; counting it would dilute the rate with pairs
		// the mechanism never examines.
		const scoped = board.cards.filter((card) => (card.filesLikelyTouched?.length ?? 0) > 0);
		if (scoped.length < 2) {
			continue;
		}
		let pairs = 0;
		let serialized = 0;
		for (let i = 0; i < scoped.length; i += 1) {
			for (let j = i + 1; j < scoped.length; j += 1) {
				pairs += 1;
				const verdict = input.classify(scoped[i] as SerializationCostCard, scoped[j] as SerializationCostCard);
				classCounts[verdict.conflictClass] = (classCounts[verdict.conflictClass] ?? 0) + 1;
				if (verdict.conflictClass !== "red") {
					continue;
				}
				serialized += 1;
				for (const path of verdict.sharedSpecificPaths) {
					pathPairs.set(path, (pathPairs.get(path) ?? 0) + 1);
				}
			}
		}
		const bucket = board.isBenchmarkFixture ? tally.bench : tally.real;
		for (const target of [tally.all, bucket]) {
			target[0] = (target[0] as number) + 1;
			target[1] = (target[1] as number) + pairs;
			target[2] = (target[2] as number) + serialized;
		}
	}

	const all = group(tally.all[0] as number, tally.all[1] as number, tally.all[2] as number);
	const realWork = group(tally.real[0] as number, tally.real[1] as number, tally.real[2] as number);
	const benchmarkFixtures = group(tally.bench[0] as number, tally.bench[1] as number, tally.bench[2] as number);
	const topPaths = [...pathPairs.entries()]
		.map(([path, pairs]) => ({ path, pairs }))
		.sort((left, right) => right.pairs - left.pairs || left.path.localeCompare(right.path))
		.slice(0, input.topPathLimit ?? 10);

	const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
	return {
		all,
		realWork,
		benchmarkFixtures,
		topPaths,
		classCounts,
		summary:
			all.pairs === 0
				? "no board had two scope-declaring cards — this says nothing about serialization cost"
				: `${all.pairs} card pair(s): ${percent(all.rate)} serialized overall — but ${percent(benchmarkFixtures.rate)} on single-file benchmark fixtures vs ${percent(realWork.rate)} on real projects. ` +
					"The real-work figure is the one that decides whether symbol-level detection (P21.12) is worth building, and it is an UPPER BOUND: some of those pairs would collide at symbol level too",
	};
}
