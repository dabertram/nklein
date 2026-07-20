import { describe, expect, it } from "vitest";
import {
	type DraftClaim,
	type EvidenceRecord,
	groundClaims,
	renderClaimWithProvenance,
	summarizeGrounding,
} from "../../src/core/field-report-grounding";

const evidence: EvidenceRecord[] = [
	{ id: "obs-1", kind: "quant_floor_breach" },
	{ id: "obs-2", kind: "drift_critic_flagged" },
	{ id: "obs-3", kind: "drift_critic_flagged" },
];

describe("groundClaims", () => {
	it("keeps a claim backed by real evidence, with its provenance resolved", () => {
		const result = groundClaims(
			[{ text: "Drift was flagged twice.", citedEvidenceIds: ["obs-2", "obs-3"] }],
			evidence,
		);
		expect(result.grounded).toHaveLength(1);
		expect(result.grounded[0]?.evidence.map((e) => e.id)).toEqual(["obs-2", "obs-3"]);
	});

	it("DROPS an uncited claim rather than softening it", () => {
		// Softening keeps the fabrication and adds deniability; a hedged claim is still chased.
		const result = groundClaims([{ text: "The fleet seems unstable.", citedEvidenceIds: [] }], evidence);
		expect(result.grounded).toHaveLength(0);
		expect(result.dropped[0]?.reason).toBe("no_citations");
	});

	it("DROPS a claim whose citations match no recorded event — invented provenance", () => {
		const result = groundClaims(
			[{ text: "Reviews failed 30 times.", citedEvidenceIds: ["obs-999", "obs-1000"] }],
			evidence,
		);
		expect(result.grounded).toHaveLength(0);
		expect(result.dropped[0]?.reason).toBe("unknown_evidence");
		expect(result.dropped[0]?.detail).toContain("invented its own provenance");
	});

	it("does NOT partially repair a claim by silently dropping bad citations", () => {
		// A repaired claim would LOOK cited while resting on less than it claimed. With minCitations raised,
		// a claim surviving on one of three citations is dropped whole.
		const result = groundClaims(
			[{ text: "Widespread breach.", citedEvidenceIds: ["obs-1", "nope-1", "nope-2"] }],
			evidence,
			{ minCitations: 2 },
		);
		expect(result.grounded).toHaveLength(0);
		expect(result.dropped[0]?.reason).toBe("insufficient_citations");
		expect(result.dropped[0]?.detail).toContain("did not exist");
	});

	it("reports the drop RATE — a silently filtered report is as misleading as an ungrounded one", () => {
		const claims: DraftClaim[] = [
			{ text: "real", citedEvidenceIds: ["obs-1"] },
			{ text: "fake", citedEvidenceIds: [] },
		];
		const result = groundClaims(claims, evidence);
		expect(result.dropRate).toBe(0.5);
		expect(result.summary).toContain("DROPPED as unsupported");
	});

	it("warns LOUDLY when over half the claims were invented", () => {
		const claims: DraftClaim[] = [
			{ text: "a", citedEvidenceIds: [] },
			{ text: "b", citedEvidenceIds: [] },
			{ text: "c", citedEvidenceIds: ["obs-1"] },
		];
		const result = groundClaims(claims, evidence);
		expect(result.summary).toContain("MORE suspicion, not less");
	});

	it("handles an empty draft without inventing a summary", () => {
		expect(groundClaims([], evidence).summary).toBe("No claims were generated.");
	});

	it("never throws on junk citations", () => {
		expect(() => groundClaims([{ text: "x", citedEvidenceIds: ["", " "] }], evidence)).not.toThrow();
	});
});

describe("renderClaimWithProvenance", () => {
	it("shows evidence ids and kinds, never prose provenance", () => {
		const rendered = renderClaimWithProvenance({
			text: "Drift flagged twice.",
			evidence: [evidence[1] as EvidenceRecord, evidence[2] as EvidenceRecord],
		});
		expect(rendered).toContain("drift_critic_flagged:obs-2");
		expect(rendered).toContain("drift_critic_flagged:obs-3");
	});
});

describe("summarizeGrounding", () => {
	it("says so plainly when everything is grounded", () => {
		expect(summarizeGrounding(5, 0)).toContain("All 5 claim(s) are grounded");
	});
});
