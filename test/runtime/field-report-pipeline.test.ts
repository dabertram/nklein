import { describe, expect, it } from "vitest";
import { buildFieldReport, narrativeField, structuralField } from "../../src/core/field-report-content";
import { planFieldReportGeneration } from "../../src/core/field-report-generation";
import { type DraftClaim, type EvidenceRecord, groundClaims } from "../../src/core/field-report-grounding";
import { redactForFieldReport } from "../../src/core/field-report-redaction";
import { projectReviewState, type ReviewItem, renderIssueDraft } from "../../src/core/field-report-transport";

/**
 * P16.2b acceptance — the HALLUCINATION fixture, end to end.
 *
 * A grounding filter that has never been SEEN to reject anything is an assumption. This drives the whole Field
 * Report pipeline with a deterministic fixture model that invents provenance, and asserts the invented claims are
 * removed AND the removal is counted. No real model is required: the fixture's job is to lie predictably.
 */

/** A fixture "model" that mixes real citations with invented ones — the failure mode we must survive. */
function hallucinatingModel(): DraftClaim[] {
	return [
		// Grounded: cites evidence that exists.
		{ text: "The drift critic flagged the run twice.", citedEvidenceIds: ["obs-2", "obs-3"] },
		// Invented provenance: plausible ids that were never recorded.
		{ text: "Reviews failed 47 times due to a quantization floor breach.", citedEvidenceIds: ["obs-900"] },
		// No citation at all: a confident assertion with nothing behind it.
		{ text: "The fleet is fundamentally misconfigured.", citedEvidenceIds: [] },
		// Half-invented: one real id, one fabricated.
		{ text: "Every card stalled at the same step.", citedEvidenceIds: ["obs-1", "obs-901"] },
	];
}

const EVIDENCE: EvidenceRecord[] = [
	{ id: "obs-1", kind: "quant_floor_breach" },
	{ id: "obs-2", kind: "drift_critic_flagged" },
	{ id: "obs-3", kind: "drift_critic_flagged" },
];

describe("Field Report pipeline — adversarial hallucination fixture", () => {
	const draft = hallucinatingModel();
	const grounded = groundClaims(draft, EVIDENCE, { minCitations: 2 });

	it("REMOVES every claim the fixture invented", () => {
		const survivingText = grounded.grounded.map((c) => c.text).join(" ");
		expect(survivingText).not.toContain("47 times");
		expect(survivingText).not.toContain("fundamentally misconfigured");
		expect(survivingText).not.toContain("Every card stalled");
	});

	it("keeps the one genuinely grounded claim", () => {
		expect(grounded.grounded).toHaveLength(1);
		expect(grounded.grounded[0]?.text).toContain("flagged the run twice");
	});

	it("COUNTS the removals rather than hiding them", () => {
		expect(grounded.dropped).toHaveLength(3);
		expect(grounded.dropRate).toBeCloseTo(0.75, 2);
	});

	it("WARNS that a 75% drop rate means the survivors deserve more suspicion", () => {
		expect(grounded.summary).toContain("MORE suspicion, not less");
	});

	it("attributes each removal to the right reason", () => {
		const reasons = grounded.dropped.map((d) => d.reason).sort();
		expect(reasons).toEqual(["insufficient_citations", "no_citations", "unknown_evidence"]);
	});
});

describe("Field Report pipeline — end to end with a hostile model and secrets present", () => {
	it("produces a draft containing the grounded claim, no invented claims, and no secrets", () => {
		const grounded = groundClaims(hallucinatingModel(), EVIDENCE, { minCitations: 2 });

		// Narrative text carries a real path and the project name — both must be redacted before transport.
		const narrative = redactForFieldReport(
			`${grounded.grounded[0]?.text ?? ""} Seen while editing /Users/dana/GIT/AcmeLedger/src/a.ts.`,
			{ customTerms: ["AcmeLedger"] },
		);

		const report = buildFieldReport(
			[
				structuralField("cards_run", "12", "how many cards ran"),
				narrativeField("pattern", narrative.text, "a redacted description of a pattern"),
			],
			{ maxLayer: "B" },
		);

		const items: ReviewItem[] = report.included.map((field) => ({
			key: field.key,
			layer: field.layer,
			bytes: field.value,
			reveals: field.reveals,
			included: true,
		}));
		const result = renderIssueDraft(projectReviewState(items), {
			title: "Field report",
			disclosure: report.disclosure,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		// The grounded claim survives...
		expect(result.markdown).toContain("flagged the run twice");
		// ...the invented ones never reach the draft...
		expect(result.markdown).not.toContain("47 times");
		expect(result.markdown).not.toContain("fundamentally misconfigured");
		// ...and no secret does either.
		expect(result.markdown).not.toContain("/Users/dana");
		expect(result.markdown).not.toContain("AcmeLedger");
		// The draft still says who sent it.
		expect(result.markdown).toContain("!Klein did not send this");
	});

	it("still produces a complete Layer-A report when NO model is available", () => {
		// The hostile-model path is optional; the arithmetic path is not.
		const plan = planFieldReportGeneration({ modelAvailable: false });
		const report = buildFieldReport([structuralField("cards_run", "12", "how many cards ran")], {
			maxLayer: "A",
		});
		expect(plan.narrativeEnabled).toBe(false);
		expect(report.included).toHaveLength(1);
		expect(report.disclosure).toContain("layer(s): A");
	});
});
