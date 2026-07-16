import { describe, expect, it } from "vitest";
import {
	clusterBySignature,
	type IndexedCandidate,
	type PairwiseVerdict,
	recursiveTournamentVote,
	selectBestCandidate,
} from "../../../src/core/candidate-tournament";

/** A comparator that prefers the candidate with the larger numeric value; deterministic. */
const preferLarger = (a: IndexedCandidate<number>, b: IndexedCandidate<number>): PairwiseVerdict =>
	a.value > b.value ? "a" : b.value > a.value ? "b" : "tie";

describe("clusterBySignature", () => {
	it("groups by signature and sorts by size desc, then representative index asc", () => {
		// signatures: a,b,a,a,b,c → clusters a(3) b(2) c(1)
		const clusters = clusterBySignature(["a", "b", "a", "a", "b", "c"], (s) => s);
		expect(clusters.map((c) => [c.signature, c.size])).toEqual([
			["a", 3],
			["b", 2],
			["c", 1],
		]);
		// representative is the lowest-index member
		expect(clusters[0]?.members[0]).toEqual({ index: 0, value: "a" });
		expect(clusters[1]?.members[0]).toEqual({ index: 1, value: "b" });
	});

	it("breaks equal-size ties by the representative's original index", () => {
		// two clusters both size 1: 'x' first at index 0, 'y' first at index 1
		const clusters = clusterBySignature(["x", "y"], (s) => s);
		expect(clusters.map((c) => c.signature)).toEqual(["x", "y"]);
	});

	it("returns an empty array for no candidates", () => {
		expect(clusterBySignature([], (s: string) => s)).toEqual([]);
	});
});

describe("recursiveTournamentVote", () => {
	const indexed = (values: number[]): IndexedCandidate<number>[] => values.map((value, index) => ({ index, value }));

	it("selects the best via single-elimination with a deterministic comparator", () => {
		const result = recursiveTournamentVote(indexed([3, 7, 1, 9, 2]), preferLarger);
		expect(result.winner?.value).toBe(9);
		// 5 candidates: round1 has 2 matchups + 1 bye → 3 advance; round2 1 matchup + 1 bye → 2; round3 1 matchup → 1.
		expect(result.rounds).toBe(3);
		expect(result.matchups).toBe(4);
	});

	it("gives a bye to the odd candidate without a spurious matchup", () => {
		const result = recursiveTournamentVote(indexed([5, 1, 3]), preferLarger);
		expect(result.winner?.value).toBe(5);
	});

	it("takes the majority of an ODD number of votes, tolerating a flaky comparator", () => {
		// Comparator that alternates but leans 'a': returns b only every 3rd call. With 3 votes/pair, 'a' still wins.
		let calls = 0;
		const flaky = (): PairwiseVerdict => {
			calls += 1;
			return calls % 3 === 0 ? "b" : "a";
		};
		const result = recursiveTournamentVote(indexed([10, 20]), flaky, { votesPerPair: 3 });
		expect(result.winner?.index).toBe(0); // 'a' won 2 of 3
	});

	it("breaks an all-tie matchup toward the lower original index", () => {
		const allTie = (): PairwiseVerdict => "tie";
		const result = recursiveTournamentVote(indexed([1, 2]), allTie);
		expect(result.winner?.index).toBe(0);
	});

	it("handles single and empty fields", () => {
		expect(recursiveTournamentVote(indexed([42]), preferLarger)).toMatchObject({ matchups: 0, rounds: 0 });
		expect(recursiveTournamentVote(indexed([42]), preferLarger).winner?.value).toBe(42);
		expect(recursiveTournamentVote([], preferLarger).winner).toBeNull();
	});
});

describe("selectBestCandidate", () => {
	it("takes the cheap majority-cluster path with ZERO comparator calls when candidates converge", () => {
		let compareCalls = 0;
		const spy = (a: IndexedCandidate<string>, b: IndexedCandidate<string>): PairwiseVerdict => {
			compareCalls += 1;
			return preferLarger({ ...a, value: a.value.length }, { ...b, value: b.value.length });
		};
		// 3 of 4 produce the same output signature "42" → majority.
		const result = selectBestCandidate(["42", "42", "42", "7"], { signatureOf: (s) => s, compare: spy });
		expect(result.method).toBe("majority-cluster");
		expect(result.winner).toBe("42");
		expect(result.matchups).toBe(0);
		expect(compareCalls).toBe(0); // never invoked the expensive judge
		expect(result.reason).toContain("majority cluster");
	});

	it("falls through to a tournament when the field is all distinct (majority-vote's degenerate case)", () => {
		// Every candidate is a unique output → largest cluster size 1 → tournament decides by value.
		const result = selectBestCandidate([3, 8, 5, 1], { signatureOf: (n) => String(n), compare: preferLarger });
		expect(result.method).toBe("tournament");
		expect(result.winner).toBe(8);
		expect(result.matchups).toBeGreaterThan(0);
		expect(result.reason).toContain("no majority");
	});

	it("dedupes behaviourally-identical candidates before the tournament (clusters, not raw N)", () => {
		// Six candidates, three distinct signatures 'a'/'b'/'c' at 2 each — no majority (2/6 < 0.5) → tournament over the
		// 3 representatives, not 6. The comparator prefers the alphabetically-later signature.
		const compare = (a: IndexedCandidate<string>, b: IndexedCandidate<string>): PairwiseVerdict =>
			a.value > b.value ? "a" : b.value > a.value ? "b" : "tie";
		const result = selectBestCandidate(["a", "b", "c", "a", "b", "c"], { signatureOf: (s) => s, compare });
		expect(result.method).toBe("tournament");
		expect(result.winner).toBe("c");
		// 3 representatives → 1 matchup + 1 bye in round 1, then 1 matchup in round 2 = 2 matchups (not the 5 that 6-wide would cost).
		expect(result.matchups).toBe(2);
	});

	it("majorityThreshold=1 always runs the tournament even on a strong plurality", () => {
		const compare = (a: IndexedCandidate<string>, b: IndexedCandidate<string>): PairwiseVerdict =>
			a.value > b.value ? "a" : b.value > a.value ? "b" : "tie";
		const result = selectBestCandidate(["9", "9", "1"], { signatureOf: (s) => s, compare, majorityThreshold: 1 });
		expect(result.method).toBe("tournament");
	});

	it("with no signature function, every candidate is its own cluster ⇒ pure tournament", () => {
		const result = selectBestCandidate([4, 2, 9, 6], { compare: preferLarger });
		expect(result.method).toBe("tournament");
		expect(result.winner).toBe(9);
	});

	it("handles empty and single fields without invoking the comparator", () => {
		const empty = selectBestCandidate([], { compare: preferLarger });
		expect(empty).toMatchObject({ winner: null, winnerIndex: null, method: "empty", matchups: 0 });

		const single = selectBestCandidate([7], { compare: preferLarger });
		expect(single).toMatchObject({ winner: 7, winnerIndex: 0, method: "single", matchups: 0 });
	});
});
