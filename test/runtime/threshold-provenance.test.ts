import { describe, expect, it } from "vitest";
import {
	assessThreshold,
	MIN_MEASURED_SAMPLE,
	SHIPPED_THRESHOLDS,
	type ThresholdDeclaration,
} from "../../src/core/threshold-provenance";

function declaration(overrides: Partial<ThresholdDeclaration> = {}): ThresholdDeclaration {
	return {
		id: "x.threshold",
		value: 0.5,
		provenance: "operational",
		basis: "chosen as a starting point",
		...overrides,
	};
}

describe("assessThreshold", () => {
	it("accepts a genuinely measured threshold", () => {
		const assessment = assessThreshold(
			declaration({ provenance: "measured", sampleSize: 100, basis: "eval harness, 100 runs" }),
		);
		expect(assessment.citableAsMeasured).toBe(true);
		expect(assessment.label).toContain("MEASURED on this workload");
	});

	it("DOWNGRADES a measured claim with too small a sample", () => {
		// A small sample wearing a lab coat is the one label that can flatter a number.
		const assessment = assessThreshold(declaration({ provenance: "measured", sampleSize: MIN_MEASURED_SAMPLE - 1 }));
		expect(assessment.citableAsMeasured).toBe(false);
		expect(assessment.defects).toContain("measured_undersampled");
		expect(assessment.label).toContain("treat as an operational default");
	});

	it("DOWNGRADES a measured claim with no sample at all", () => {
		const assessment = assessThreshold(declaration({ provenance: "measured" }));
		expect(assessment.defects).toContain("measured_without_sample");
		expect(assessment.citableAsMeasured).toBe(false);
	});

	it("polices ONLY the label that can flatter — the others are taken at their word", () => {
		// operational/borrowed/folklore are already admitting they are not evidence, so there is nothing to police.
		for (const provenance of ["operational", "borrowed", "folklore"] as const) {
			expect(assessThreshold(declaration({ provenance })).defects).toEqual([]);
		}
	});

	it("marks folklore usable but never presentable as evidence", () => {
		const assessment = assessThreshold(declaration({ provenance: "folklore", basis: "widely repeated" }));
		expect(assessment.citableAsMeasured).toBe(false);
		expect(assessment.label).toContain("never be presented as evidence");
	});

	it("flags an empty basis — an unexplained threshold is the thing this prevents", () => {
		expect(assessThreshold(declaration({ basis: "   " })).defects).toContain("empty_basis");
	});

	it("says a borrowed number may not transfer", () => {
		const assessment = assessThreshold(declaration({ provenance: "borrowed", basis: "arXiv 1234" }));
		expect(assessment.label).toContain("may not transfer");
	});
});

describe("SHIPPED_THRESHOLDS", () => {
	it("every shipped threshold has a non-empty basis", () => {
		for (const threshold of SHIPPED_THRESHOLDS) {
			expect(assessThreshold(threshold).defects).not.toContain("empty_basis");
		}
	});

	it("catches an over-claim in OUR OWN table — cold_load is labelled measured with no sample", () => {
		// Writing the table down was itself the finding. The cold-load figure comes from a field range, not from a
		// recorded experiment on this fleet, so the assessor downgrades it. Pinned rather than quietly relabelled:
		// the mechanism catching its author's over-claim is the demonstration that it works.
		const coldLoad = SHIPPED_THRESHOLDS.find((t) => t.id === "cold_load.seconds");
		expect(coldLoad?.provenance).toBe("measured");
		expect(assessThreshold(coldLoad!).citableAsMeasured).toBe(false);
	});

	it("NOTHING this project ships is citable as measured today", () => {
		// The accurate current state. Not a criticism of the numbers — stating it is what stops the next reader
		// treating operational defaults as results.
		const citable = SHIPPED_THRESHOLDS.filter((t) => assessThreshold(t).citableAsMeasured);
		expect(citable).toEqual([]);
	});
});
