import { describe, expect, it } from "vitest";
import type { CandidateValidation, RepairCandidate } from "../../../src/core/repair-kernel";
import { type RepairKernelRunTrace, summarizeRepairKernelRun } from "../../../src/core/repair-kernel-ledger";

function candidate(id: string, touchedFiles?: readonly string[]): RepairCandidate {
	return { id, patch: `patch-${id}`, touchedFiles };
}

function validation(candidateId: string, partial: Partial<CandidateValidation>): CandidateValidation {
	return { candidateId, reproPass: false, regressionPass: false, checksPass: false, diffSize: 10, ...partial };
}

/** A two-round run: round 1 lands only a repro-only partial; round 2's refinement lands the full fix. */
const twoRoundRun: RepairKernelRunTrace = {
	localization: ["src/foo.ts:bar", "src/foo.ts:baz"],
	rounds: [
		{
			round: 1,
			candidates: [candidate("a", ["src/foo.ts"]), candidate("b")],
			validations: [validation("a", { reproPass: true, diffSize: 7 }), validation("b", { diffSize: 2 })],
		},
		{
			round: 2,
			candidates: [candidate("fix", ["src/foo.ts"])],
			validations: [validation("fix", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 1 })],
		},
	],
};

describe("summarizeRepairKernelRun", () => {
	it("records the localization candidates (leaf 1)", () => {
		expect(summarizeRepairKernelRun(twoRoundRun).localizationCandidates).toEqual([
			"src/foo.ts:bar",
			"src/foo.ts:baz",
		]);
	});

	it("records patch candidates grouped by round (leaf 2)", () => {
		expect(summarizeRepairKernelRun(twoRoundRun).patchCandidatesByRound).toEqual([
			{ round: 1, candidateIds: ["a", "b"] },
			{ round: 2, candidateIds: ["fix"] },
		]);
	});

	it("flattens validator results across rounds with the composite gate score (leaf 3)", () => {
		const results = summarizeRepairKernelRun(twoRoundRun).validatorResults;
		expect(results.map((r) => r.candidateId)).toEqual(["a", "b", "fix"]);
		expect(results.find((r) => r.candidateId === "a")?.gateScore).toBe(4); // repro only
		expect(results.find((r) => r.candidateId === "b")?.gateScore).toBe(0); // nothing
		expect(results.find((r) => r.candidateId === "fix")?.gateScore).toBe(7); // all gates
	});

	it("computes refinement deltas — round 2 strictly improves the best gate score (leaf 4)", () => {
		const deltas = summarizeRepairKernelRun(twoRoundRun).refinementDeltas;
		expect(deltas).toEqual([
			{ round: 1, bestGateScore: 4, gateScoreDelta: 0, improved: false },
			{ round: 2, bestGateScore: 7, gateScoreDelta: 3, improved: true },
		]);
	});

	it("a round that fails to improve reports improved:false with a non-positive delta", () => {
		const flat: RepairKernelRunTrace = {
			localization: [],
			rounds: [
				{ round: 1, candidates: [candidate("x")], validations: [validation("x", { reproPass: true })] },
				{ round: 2, candidates: [candidate("y")], validations: [validation("y", { reproPass: true })] },
			],
		};
		const deltas = summarizeRepairKernelRun(flat).refinementDeltas;
		expect(deltas[1]).toEqual({ round: 2, bestGateScore: 4, gateScoreDelta: 0, improved: false });
	});

	it("builds a final ranking rationale naming the fully-passing winner (leaf 5)", () => {
		const rationale = summarizeRepairKernelRun(twoRoundRun).finalRankingRationale;
		expect(rationale).toContain('"fix"');
		expect(rationale).toContain("fully passes");
		expect(rationale).toContain("gate score 7/7");
		expect(rationale).toContain("after 2 rounds");
	});

	it("the rationale flags a best-partial run when no candidate fully passes", () => {
		const partialRun: RepairKernelRunTrace = {
			localization: ["src/x.ts"],
			rounds: [
				{
					round: 1,
					candidates: [candidate("p")],
					validations: [validation("p", { reproPass: true, regressionPass: true, diffSize: 3 })],
				},
			],
		};
		const rationale = summarizeRepairKernelRun(partialRun).finalRankingRationale;
		expect(rationale).toContain("best partial");
		expect(rationale).not.toContain("after"); // single round ⇒ no rounds note
	});

	it("the rationale respects injected tiebreaks when the gates tie", () => {
		const tied: RepairKernelRunTrace = {
			localization: [],
			rounds: [
				{
					round: 1,
					candidates: [candidate("lo"), candidate("hi")],
					validations: [
						validation("lo", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 10 }),
						validation("hi", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 10 }),
					],
					tiebreaksFor: (id) => (id === "hi" ? { reviewerEvidence: 1 } : undefined),
				},
			],
		};
		const rationale = summarizeRepairKernelRun(tied).finalRankingRationale;
		expect(rationale).toContain('"hi"'); // tiebreak evidence broke the gate+diff tie
		expect(rationale).toContain("tiebreak evidence 1");
	});

	it("an all-empty run yields empty records and a no-candidate rationale", () => {
		const empty: RepairKernelRunTrace = { localization: [], rounds: [] };
		const record = summarizeRepairKernelRun(empty);
		expect(record.validatorResults).toEqual([]);
		expect(record.refinementDeltas).toEqual([]);
		expect(record.finalRankingRationale).toContain("nothing to rank");
	});
});
