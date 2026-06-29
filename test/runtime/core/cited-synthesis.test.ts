import { describe, expect, it } from "vitest";
import { assembleCitedAnswer } from "../../../src/core/cited-synthesis";

const ev = [
	{ id: "e1", title: "Doc One", url: "https://a" },
	{ id: "e2", title: "Doc Two", url: "https://b" },
	{ id: "e3", title: "Doc Three" },
];

describe("assembleCitedAnswer", () => {
	it("assigns markers in first-citation order and renders claims with [n] suffixes", () => {
		const out = assembleCitedAnswer({
			claims: [
				{ text: "Claim A.", citedEvidenceIds: ["e2"] },
				{ text: "Claim B.", citedEvidenceIds: ["e1"] },
			],
			evidence: ev,
		});
		// e2 cited first → marker 1; e1 next → marker 2.
		expect(out.answer).toBe("Claim A. [1]\nClaim B. [2]");
		expect(out.sources).toEqual([
			{ marker: 1, evidenceId: "e2", title: "Doc Two", url: "https://b" },
			{ marker: 2, evidenceId: "e1", title: "Doc One", url: "https://a" },
		]);
		expect(out.uncitedClaims).toEqual([]);
	});

	it("reuses the same marker when an evidence id is cited again", () => {
		const out = assembleCitedAnswer({
			claims: [
				{ text: "First.", citedEvidenceIds: ["e1"] },
				{ text: "Second.", citedEvidenceIds: ["e1", "e2"] },
			],
			evidence: ev,
		});
		expect(out.answer).toBe("First. [1]\nSecond. [1][2]");
		expect(out.sources.map((s) => s.evidenceId)).toEqual(["e1", "e2"]);
	});

	it("dedupes repeated citations within a single claim", () => {
		const out = assembleCitedAnswer({
			claims: [{ text: "Repeats.", citedEvidenceIds: ["e1", "e1"] }],
			evidence: ev,
		});
		expect(out.answer).toBe("Repeats. [1]");
		expect(out.sources).toHaveLength(1);
	});

	it("ignores citations to non-existent evidence and flags a claim left ungrounded", () => {
		const out = assembleCitedAnswer({
			claims: [
				{ text: "Grounded.", citedEvidenceIds: ["e1"] },
				{ text: "Ghost cite.", citedEvidenceIds: ["does-not-exist"] },
				{ text: "No cites.", citedEvidenceIds: [] },
			],
			evidence: ev,
		});
		// Ghost + empty → no marker, rendered bare, reported uncited.
		expect(out.answer).toBe("Grounded. [1]\nGhost cite.\nNo cites.");
		expect(out.uncitedClaims).toEqual(["Ghost cite.", "No cites."]);
		expect(out.sources).toEqual([{ marker: 1, evidenceId: "e1", title: "Doc One", url: "https://a" }]);
	});

	it("only lists CITED evidence in sources (unreferenced evidence is omitted) and carries title-only refs", () => {
		const out = assembleCitedAnswer({
			claims: [{ text: "Uses three.", citedEvidenceIds: ["e3"] }],
			evidence: ev,
		});
		expect(out.sources).toEqual([{ marker: 1, evidenceId: "e3", title: "Doc Three", url: undefined }]);
	});

	it("handles empty claims", () => {
		expect(assembleCitedAnswer({ claims: [], evidence: ev })).toEqual({ answer: "", sources: [], uncitedClaims: [] });
	});
});
