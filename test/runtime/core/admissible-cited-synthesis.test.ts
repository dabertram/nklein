import { describe, expect, it } from "vitest";
import type { AdmissibilityCandidate } from "../../../src/core/admissible-cited-synthesis";
import { assembleAdmissibleCitedAnswer } from "../../../src/core/admissible-cited-synthesis";
import type { SynthesisClaim } from "../../../src/core/cited-synthesis";
import { assembleCitedAnswer } from "../../../src/core/cited-synthesis";

const evidence = [
	{ id: "e1", title: "Doc One", url: "https://a.example" },
	{ id: "e2", title: "Doc Two", url: "https://b.example" },
	{ id: "e3", title: "Doc Three", url: "https://c.example" },
];

/** Build an admissible (corroborated + current) candidate. */
function admissible(claim: SynthesisClaim): AdmissibilityCandidate {
	return { claim, corroborationStatus: "assertable", temporalStatus: "current" };
}

describe("assembleAdmissibleCitedAnswer", () => {
	it("(a) CENTERPIECE: excludes a stale/uncorroborated claim from the answer and reports it in droppedClaims with a reason", () => {
		const good: SynthesisClaim = { text: "The flag defaults on in v3.", citedEvidenceIds: ["e1"] };
		const stale: SynthesisClaim = { text: "As of v2 the flag defaults off.", citedEvidenceIds: ["e2"] };
		const uncorroborated: SynthesisClaim = { text: "One forum post says X.", citedEvidenceIds: ["e3"] };

		const out = assembleAdmissibleCitedAnswer({
			candidates: [
				admissible(good),
				// temporally inadmissible: an EXPIRED claim.
				{ claim: stale, corroborationStatus: "assertable", temporalStatus: "stale" },
				// corroboration inadmissible: single-source, needs another independent origin.
				{ claim: uncorroborated, corroborationStatus: "needs_corroboration", temporalStatus: "current" },
			],
			evidence,
		});

		// Only the good claim is rendered; neither inadmissible text leaks into the answer.
		expect(out.answer.answer).toBe("The flag defaults on in v3. [1]");
		expect(out.answer.answer).not.toContain("As of v2");
		expect(out.answer.answer).not.toContain("forum post");
		expect(out.answer.sources).toEqual([{ marker: 1, evidenceId: "e1", title: "Doc One", url: "https://a.example" }]);

		// Both inadmissible claims are reported, in input order, each with a reason naming the failing axis.
		expect(out.droppedClaims.map((d) => d.text)).toEqual([
			"As of v2 the flag defaults off.",
			"One forum post says X.",
		]);
		expect(out.droppedClaims[0].reason).toContain("temporally inadmissible");
		expect(out.droppedClaims[0].reason).toContain("stale");
		expect(out.droppedClaims[1].reason).toContain("insufficient corroboration");
		expect(out.droppedClaims[1].reason).toContain("needs_corroboration");
	});

	it("names BOTH axes in the reason when a claim fails corroboration AND temporal admissibility", () => {
		const doomed: SynthesisClaim = { text: "Future rumor, single source.", citedEvidenceIds: ["e1"] };
		const out = assembleAdmissibleCitedAnswer({
			candidates: [{ claim: doomed, corroborationStatus: "unsupported", temporalStatus: "anachronistic" }],
			evidence,
		});
		expect(out.droppedClaims).toHaveLength(1);
		const reason = out.droppedClaims[0].reason;
		expect(reason).toContain("insufficient corroboration");
		expect(reason).toContain("unsupported");
		expect(reason).toContain("temporally inadmissible");
		expect(reason).toContain("anachronistic");
		expect(reason).toContain(" and ");
	});

	it("(b) all-admissible: result is identical to a raw assembleCitedAnswer over the same claims, with no drops", () => {
		const claims: SynthesisClaim[] = [
			{ text: "Claim A.", citedEvidenceIds: ["e2"] },
			{ text: "Claim B.", citedEvidenceIds: ["e1", "e2"] },
			{ text: "Ungrounded claim.", citedEvidenceIds: ["missing"] },
		];
		// "undated" is also assertable — mix current + undated to prove both pass the temporal gate.
		const candidates: AdmissibilityCandidate[] = [
			{ claim: claims[0], corroborationStatus: "assertable", temporalStatus: "current" },
			{ claim: claims[1], corroborationStatus: "assertable", temporalStatus: "undated" },
			{ claim: claims[2], corroborationStatus: "assertable", temporalStatus: "current" },
		];

		const out = assembleAdmissibleCitedAnswer({ candidates, evidence });
		const raw = assembleCitedAnswer({ claims, evidence });

		expect(out.answer).toEqual(raw);
		expect(out.droppedClaims).toEqual([]);
	});

	it("(c) all-dropped: yields a no-claims answer plus every claim in droppedClaims", () => {
		const claims: SynthesisClaim[] = [
			{ text: "Anachronistic claim.", citedEvidenceIds: ["e1"] },
			{ text: "Unsupported claim.", citedEvidenceIds: ["e2"] },
		];
		const out = assembleAdmissibleCitedAnswer({
			candidates: [
				{ claim: claims[0], corroborationStatus: "assertable", temporalStatus: "anachronistic" },
				{ claim: claims[1], corroborationStatus: "unsupported", temporalStatus: "current" },
			],
			evidence,
		});

		// Empty rendered answer — no claims survived → identical to a raw assembleCitedAnswer over zero claims.
		const emptyRaw = assembleCitedAnswer({ claims: [], evidence });
		expect(out.answer).toEqual(emptyRaw);
		expect(out.answer.answer).toBe("");
		expect(out.answer.sources).toEqual([]);
		expect(out.answer.uncitedClaims).toEqual([]);

		expect(out.droppedClaims.map((d) => d.text)).toEqual(["Anachronistic claim.", "Unsupported claim."]);
	});

	it("(d) a mix preserves the ORIGINAL relative order of the admissible claims into assembleCitedAnswer", () => {
		// Interleave admissible/inadmissible; the surviving order must be [first, third, fifth].
		const first: SynthesisClaim = { text: "First.", citedEvidenceIds: ["e1"] };
		const second: SynthesisClaim = { text: "Second (dropped).", citedEvidenceIds: ["e2"] };
		const third: SynthesisClaim = { text: "Third.", citedEvidenceIds: ["e2"] };
		const fourth: SynthesisClaim = { text: "Fourth (dropped).", citedEvidenceIds: ["e3"] };
		const fifth: SynthesisClaim = { text: "Fifth.", citedEvidenceIds: ["e3"] };

		const out = assembleAdmissibleCitedAnswer({
			candidates: [
				admissible(first),
				{ claim: second, corroborationStatus: "needs_corroboration", temporalStatus: "current" },
				admissible(third),
				{ claim: fourth, corroborationStatus: "assertable", temporalStatus: "stale" },
				admissible(fifth),
			],
			evidence,
		});

		// The answer must equal a raw render over EXACTLY the survivors in their original order.
		const expected = assembleCitedAnswer({ claims: [first, third, fifth], evidence });
		expect(out.answer).toEqual(expected);
		// First-citation marker order confirms the ordering survived: e1→[1], e2→[2], e3→[3].
		expect(out.answer.answer).toBe("First. [1]\nThird. [2]\nFifth. [3]");
		expect(out.droppedClaims.map((d) => d.text)).toEqual(["Second (dropped).", "Fourth (dropped)."]);
	});

	it("does not mutate the input candidates or evidence", () => {
		const claim: SynthesisClaim = { text: "Stable.", citedEvidenceIds: ["e1"] };
		const candidates: AdmissibilityCandidate[] = [admissible(claim)];
		const frozenEvidence = Object.freeze([...evidence]);
		const snapshot = JSON.stringify(candidates);

		expect(() => assembleAdmissibleCitedAnswer({ candidates, evidence: frozenEvidence })).not.toThrow();
		expect(JSON.stringify(candidates)).toBe(snapshot);
	});
});
