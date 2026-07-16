/**
 * Best-of-N candidate selection: clustering + recursive tournament voting (F12.94, todo §5.AW).
 *
 * The existing `majorityVote` (self-consistency.ts) picks the most-frequent sample by EXACT key. That is the right cheap
 * path when several candidates converge on the same answer — but it DEGENERATES for diverse code candidates: when N attempts
 * each produce a unique program/output, every group has size 1, agreement is 1/N, and "first-seen wins" is no better than
 * picking attempt #0. Research (PDR+RTV, Semantic Voting) is clear that on agentic/code trajectories you want (a) clustering
 * by OUTPUT-equivalence (soft signature, not source identity) to collapse behaviourally-identical candidates, then (b) a
 * pairwise TOURNAMENT among the distinct survivors when no cluster holds a majority.
 *
 * This module is the PURE decision core for both. The two effectful signals are INJECTED as callbacks and never invoked
 * here directly:
 *   - `signatureOf(candidate)` — the output-equivalence key (in production: a hash of sandbox-execution output / normalized
 *     result; in tests: any deterministic function). Candidates sharing a signature are the same cluster.
 *   - `compare(a, b)` — a pairwise judge returning which candidate is better (in production: execution on a
 *     discriminating input, or an LLM A/B verdict; in tests: a deterministic comparator).
 * Everything here is pure/total/deterministic given those callbacks — no I/O, no clock, no RNG. Ties always break toward the
 * lower original index so a given input always yields the same winner.
 */

/** A candidate paired with its original index (preserved so tie-breaks and diagnostics are stable/traceable). */
export interface IndexedCandidate<T> {
	readonly index: number;
	readonly value: T;
}

/** One output-equivalence cluster: candidates whose `signatureOf` matched. */
export interface CandidateCluster<T> {
	readonly signature: string;
	/** Members in original order; `members[0]` is the cluster representative (lowest index). */
	readonly members: readonly IndexedCandidate<T>[];
	readonly size: number;
}

/**
 * Group candidates by output signature, returning clusters sorted by size (desc), ties broken by the representative's
 * original index (asc) so the ordering is deterministic. Empty input ⇒ empty array.
 */
export function clusterBySignature<T>(
	candidates: readonly T[],
	signatureOf: (value: T) => string,
): CandidateCluster<T>[] {
	const bySig = new Map<string, IndexedCandidate<T>[]>();
	const order: string[] = [];
	candidates.forEach((value, index) => {
		const signature = signatureOf(value);
		let members = bySig.get(signature);
		if (!members) {
			members = [];
			bySig.set(signature, members);
			order.push(signature);
		}
		members.push({ index, value });
	});

	return order
		.map((signature) => {
			const members = bySig.get(signature) ?? [];
			return { signature, members, size: members.length };
		})
		.sort((a, b) => (b.size !== a.size ? b.size - a.size : (a.members[0]?.index ?? 0) - (b.members[0]?.index ?? 0)));
}

/** Outcome of a single pairwise judgement. `tie` is allowed; the caller breaks ties deterministically. */
export type PairwiseVerdict = "a" | "b" | "tie";

/** A pairwise comparator over indexed candidates. Should be a pure function of its two arguments for reproducibility. */
export type PairwiseCompare<T> = (a: IndexedCandidate<T>, b: IndexedCandidate<T>) => PairwiseVerdict;

/**
 * Best-of-`votesPerPair` majority judgement between two candidates. Runs the comparator an ODD number of times (so there is
 * always a strict tally winner unless every vote is an explicit "tie"), then: more "a" votes ⇒ a, more "b" ⇒ b, otherwise
 * the lower-index candidate wins the tie. Deterministic when `compare` is deterministic; robust to a flaky comparator when
 * it is not, because the majority of an odd number of votes is taken.
 */
function judgePair<T>(
	a: IndexedCandidate<T>,
	b: IndexedCandidate<T>,
	compare: PairwiseCompare<T>,
	votesPerPair: number,
): IndexedCandidate<T> {
	const votes = Math.max(1, votesPerPair | 0);
	const odd = votes % 2 === 0 ? votes + 1 : votes; // force odd so a split has a majority
	let aWins = 0;
	let bWins = 0;
	for (let i = 0; i < odd; i++) {
		const verdict = compare(a, b);
		if (verdict === "a") {
			aWins += 1;
		} else if (verdict === "b") {
			bWins += 1;
		}
	}
	if (aWins > bWins) {
		return a;
	}
	if (bWins > aWins) {
		return b;
	}
	return a.index <= b.index ? a : b; // tie ⇒ lower original index
}

export interface TournamentOptions {
	/** Odd number of comparator calls per matchup (coerced to odd; min 1). Default 1. */
	readonly votesPerPair?: number;
}

export interface TournamentResult<T> {
	readonly winner: IndexedCandidate<T> | null;
	/** Total matchups played (0 for 0/1 candidates). */
	readonly rounds: number;
	readonly matchups: number;
}

/**
 * Single-elimination tournament over the candidates, in original index order (candidate 0 vs 1, 2 vs 3, …; an odd one out
 * gets a bye to the next round). Each matchup is decided by `judgePair`. Deterministic bracket (no shuffling) so the result
 * is reproducible. Returns the surviving candidate plus how much comparison work it cost.
 */
export function recursiveTournamentVote<T>(
	candidates: readonly IndexedCandidate<T>[],
	compare: PairwiseCompare<T>,
	options: TournamentOptions = {},
): TournamentResult<T> {
	if (candidates.length === 0) {
		return { winner: null, rounds: 0, matchups: 0 };
	}
	const votesPerPair = options.votesPerPair ?? 1;
	let current = [...candidates];
	let rounds = 0;
	let matchups = 0;
	while (current.length > 1) {
		rounds += 1;
		const next: IndexedCandidate<T>[] = [];
		for (let i = 0; i < current.length; i += 2) {
			const a = current[i];
			const b = current[i + 1];
			if (a === undefined) {
				continue; // unreachable (i < length), guards the type
			}
			if (b === undefined) {
				next.push(a); // bye
				continue;
			}
			matchups += 1;
			next.push(judgePair(a, b, compare, votesPerPair));
		}
		current = next;
	}
	return { winner: current[0] ?? null, rounds, matchups };
}

export type SelectionMethod = "empty" | "single" | "majority-cluster" | "tournament";

export interface SelectBestOptions<T> {
	/** Output-equivalence key. Omit to treat every candidate as its own cluster (pure tournament). */
	readonly signatureOf?: (value: T) => string;
	/** Pairwise judge, required to resolve a field with no majority cluster. */
	readonly compare: PairwiseCompare<T>;
	/**
	 * A cluster wins outright (skipping the tournament) when its share of all candidates is ≥ this fraction. Default 0.5
	 * (strict majority — the cheap self-consistency path). Set to 1 to always run the tournament.
	 */
	readonly majorityThreshold?: number;
	readonly votesPerPair?: number;
}

export interface SelectBestResult<T> {
	readonly winner: T | null;
	readonly winnerIndex: number | null;
	readonly method: SelectionMethod;
	readonly clusters: readonly CandidateCluster<T>[];
	/** Comparator matchups spent (0 on the cheap majority path). */
	readonly matchups: number;
	readonly reason: string;
}

/**
 * Select the best of N candidates. Strategy, cheapest-first:
 *   1. 0 candidates ⇒ null; exactly 1 ⇒ that one (no work).
 *   2. Cluster by output signature. If the largest cluster's share ≥ `majorityThreshold`, return its representative — this
 *      is the classic self-consistency win and costs ZERO comparator calls.
 *   3. Otherwise the field is genuinely diverse (the degenerate case for plain majority-vote): run a single-elimination
 *      tournament among the CLUSTER REPRESENTATIVES (deduping behaviourally-identical candidates first) using `compare`.
 * The comparator is only ever invoked in step 3, so a purely-convergent field never pays for the expensive judge.
 */
export function selectBestCandidate<T>(candidates: readonly T[], options: SelectBestOptions<T>): SelectBestResult<T> {
	const { signatureOf, compare, majorityThreshold = 0.5, votesPerPair } = options;

	if (candidates.length === 0) {
		return { winner: null, winnerIndex: null, method: "empty", clusters: [], matchups: 0, reason: "no candidates." };
	}
	if (candidates.length === 1) {
		return {
			winner: candidates[0] ?? null,
			winnerIndex: 0,
			method: "single",
			clusters: [],
			matchups: 0,
			reason: "only one candidate.",
		};
	}

	// With a signature, cluster by output-equivalence. Without one, every candidate is its own cluster (index-keyed) so
	// step 2 can never short-circuit and selection falls through to a pure tournament.
	const clusters = signatureOf
		? clusterBySignature(candidates, signatureOf)
		: candidates.map((value, index) => ({ signature: `#${index}`, members: [{ index, value }], size: 1 }));
	const largest = clusters[0];
	if (largest && largest.size / candidates.length >= majorityThreshold) {
		const rep = largest.members[0];
		return {
			winner: rep?.value ?? null,
			winnerIndex: rep?.index ?? null,
			method: "majority-cluster",
			clusters,
			matchups: 0,
			reason: `majority cluster: ${largest.size}/${candidates.length} candidates agree (≥ ${(majorityThreshold * 100).toFixed(0)}%).`,
		};
	}

	const representatives = clusters.map((c) => c.members[0]).filter((m): m is IndexedCandidate<T> => m !== undefined);
	const tournament = recursiveTournamentVote(representatives, compare, { votesPerPair });
	return {
		winner: tournament.winner?.value ?? null,
		winnerIndex: tournament.winner?.index ?? null,
		method: "tournament",
		clusters,
		matchups: tournament.matchups,
		reason: `no majority (largest cluster ${largest?.size ?? 0}/${candidates.length}); tournament over ${representatives.length} distinct candidates in ${tournament.matchups} matchups.`,
	};
}
