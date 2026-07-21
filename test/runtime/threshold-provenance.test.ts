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

	it("keeps the historical cold-load over-claim downgraded", () => {
		// Writing the table down was itself the finding. The cold-load figure comes from a field range, not from a
		// recorded experiment on this fleet, so the assessor downgrades it. Pinned rather than quietly relabelled:
		// the mechanism catching its author's over-claim is the demonstration that it works.
		const coldLoad = SHIPPED_THRESHOLDS.find((t) => t.id === "cold_load.seconds");
		expect(coldLoad?.provenance).toBe("measured");
		if (!coldLoad) throw new Error("missing cold-load threshold fixture");
		expect(assessThreshold(coldLoad).citableAsMeasured).toBe(false);
	});

	it("cites only the context threshold backed by the 20-task paired measurement", () => {
		const citable = SHIPPED_THRESHOLDS.filter((t) => assessThreshold(t).citableAsMeasured);
		expect(citable.map((threshold) => threshold.id)).toEqual(["compaction.context_utilisation"]);
		expect(citable[0]?.sampleSize).toBe(20);
		expect(citable[0]?.basis).toContain("does not claim");
	});
});

describe("the table must not DRIFT from the live constants", () => {
	it("every catalogued value matches the constant actually in force", async () => {
		// Without this the table is documentation, and documentation that duplicates a constant drifts from it —
		// at which point the provenance labels describe numbers the system no longer uses. That would be worse
		// than no table: a confident, wrong account of where our thresholds came from.
		const [offTrack, codeact, residency] = await Promise.all([
			import("../../src/core/off-track-intervention"),
			import("../../src/core/codeact-gating"),
			import("../../src/core/resident-set-recommendation"),
		]);
		const nightly = await import("../../src/core/nightly-schedule");
		const live = new Map<string, number>([
			["compaction.context_utilisation", offTrack.COMPACTION_UTILISATION],
			["codeact.fitness_bar", codeact.CODEACT_FITNESS_BAR],
			["residency.fitness_bar", residency.RESIDENCY_FITNESS_BAR],
			["cold_load.seconds", residency.COLD_LOAD_SECONDS],
			["regression.slowdown_ratio", nightly.REGRESSION_RATIO],
		]);
		for (const threshold of SHIPPED_THRESHOLDS) {
			expect(live.get(threshold.id), `${threshold.id} is catalogued but has no live constant bound`).toBeDefined();
			expect(threshold.value, `${threshold.id} drifted from its live constant`).toBe(live.get(threshold.id));
		}
	});
});
