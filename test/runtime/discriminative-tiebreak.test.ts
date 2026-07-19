import { describe, expect, it } from "vitest";
import {
	buildDiscriminativeProbePrompt,
	needsDiscriminativeTiebreak,
	parseDiscriminativeProbes,
	voteDiscriminativeTiebreak,
} from "../../src/core/discriminative-tiebreak";

describe("discriminative tie-break need (F12.95)", () => {
	it("fires only when multiple passing candidates look identical on the given tests", () => {
		const need = needsDiscriminativeTiebreak({
			passingCandidateIds: ["a", "b"],
			existingSignatures: ["sig", "sig"],
		});
		expect(need.needed).toBe(true);
		expect(need.reason).toContain("expose the difference");
	});

	it("skips when there is nothing to separate or the tests already separate them", () => {
		expect(needsDiscriminativeTiebreak({ passingCandidateIds: ["a"], existingSignatures: ["s"] }).needed).toBe(false);
		const alreadyDiffer = needsDiscriminativeTiebreak({
			passingCandidateIds: ["a", "b"],
			existingSignatures: ["s1", "s2"],
		});
		expect(alreadyDiffer.needed).toBe(false);
		expect(alreadyDiffer.reason).toContain("cluster/arbitrate");
	});
});

describe("discriminative probe prompt (F12.95)", () => {
	const prompt = buildDiscriminativeProbePrompt({
		taskObjective: "Clamp the retry count to at most 5.",
		candidateSummaries: [
			{ candidateId: "cand-a", summary: "uses Math.min(count, 5)" },
			{ candidateId: "cand-b", summary: "throws above 5" },
		],
		probeCount: 3,
	});

	it("asks for inputs only — never for a verdict or predicted outputs", () => {
		expect(prompt).toContain("Propose exactly 3 concrete INPUTS");
		expect(prompt).toContain("Do NOT say which implementation is correct");
		expect(prompt).toContain("do NOT predict outputs");
		expect(prompt).toContain("the sandbox will run these and the results decide");
	});

	it("carries the objective and every candidate summary", () => {
		expect(prompt).toContain("Clamp the retry count to at most 5.");
		expect(prompt).toContain("cand-a");
		expect(prompt).toContain("throws above 5");
	});
});

describe("discriminative probe parsing (F12.95)", () => {
	it("parses, de-duplicates and caps probes", () => {
		const probes = parseDiscriminativeProbes(
			["PROBE: -1", "- PROBE: 0", "PROBE: -1", "PROBE: 2147483647", "PROBE: extra"].join("\n"),
			3,
		);
		expect(probes).toEqual(["-1", "0", "2147483647"]);
	});

	it("returns nothing for an unparseable reply rather than guessing inputs", () => {
		expect(parseDiscriminativeProbes("I think candidate A is better.")).toEqual([]);
	});
});

describe("discriminative vote (F12.95)", () => {
	it("picks the majority behaviour when the probes separate the candidates", () => {
		const verdict = voteDiscriminativeTiebreak([
			{ candidateId: "a", outputs: ["1", "2"] },
			{ candidateId: "b", outputs: ["1", "2"] },
			{ candidateId: "c", outputs: ["1", "X"] },
		]);
		expect(verdict.conclusive).toBe(true);
		expect(verdict.agreeingIds).toEqual(["a", "b"]);
		expect(verdict.winnerId).toBe("a");
	});

	it("reports INCONCLUSIVE when every candidate still looks identical", () => {
		const verdict = voteDiscriminativeTiebreak([
			{ candidateId: "a", outputs: ["1"] },
			{ candidateId: "b", outputs: ["1"] },
		]);
		expect(verdict.conclusive).toBe(false);
		expect(verdict.winnerId).toBeNull();
		expect(verdict.reason).toContain("still indistinguishable");
	});

	it("refuses to guess on an even split", () => {
		const verdict = voteDiscriminativeTiebreak([
			{ candidateId: "a", outputs: ["1"] },
			{ candidateId: "b", outputs: ["2"] },
		]);
		expect(verdict.conclusive).toBe(false);
		expect(verdict.winnerId).toBeNull();
		expect(verdict.reason).toContain("no majority");
	});

	it("handles the empty case honestly", () => {
		const verdict = voteDiscriminativeTiebreak([]);
		expect(verdict.conclusive).toBe(false);
		expect(verdict.reason).toContain("no candidate results");
	});
});
