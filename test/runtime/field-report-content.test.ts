import { describe, expect, it } from "vitest";
import {
	buildFieldReport,
	narrativeField,
	type ReportField,
	renderReviewPayload,
	structuralField,
	verbatimField,
} from "../../src/core/field-report-content";

const candidates: ReportField[] = [
	structuralField("cards_run", "42", "how many cards ran"),
	structuralField("model_class", "14B-class local", "the size band of the model used"),
	narrativeField(
		"stall_pattern",
		"Cards stalled after repeated edits to <FILE_A>.",
		"a redacted description of a stall",
	),
	verbatimField("failing_diff", "- const a = 1;\n+ const a = 2;", "an actual code excerpt from your project"),
];

describe("buildFieldReport", () => {
	it("includes only layer A by default", () => {
		const report = buildFieldReport(candidates, { maxLayer: "A" });
		expect(report.included.map((f) => f.key)).toEqual(["cards_run", "model_class"]);
		expect(report.layersIncluded).toEqual(["A"]);
	});

	it("WITHHOLDS higher layers with a reason rather than dropping them silently", () => {
		const report = buildFieldReport(candidates, { maxLayer: "A" });
		expect(report.withheld.map((w) => w.key)).toEqual(["stall_pattern", "failing_diff"]);
		expect(report.withheld[0]?.reason).toContain("not individually approved");
	});

	it("honours PER-ITEM approval above the consented layer", () => {
		// The point of per-item consent: the user approves findings, not a blanket disclosure level.
		const report = buildFieldReport(candidates, { maxLayer: "A", approvedKeys: ["failing_diff"] });
		expect(report.included.map((f) => f.key)).toContain("failing_diff");
		expect(report.included.map((f) => f.key)).not.toContain("stall_pattern");
	});

	it("distinguishes 'nothing withheld' from 'a layer was declined' in the disclosure", () => {
		const withheldSome = buildFieldReport(candidates, { maxLayer: "A" });
		const withheldNone = buildFieldReport(candidates, { maxLayer: "C" });
		expect(withheldSome.disclosure).toContain("incomplete by your choice, not empty");
		expect(withheldNone.disclosure).toContain("No fields were withheld");
	});

	it("always emits a disclosure, even for an empty report", () => {
		const report = buildFieldReport([], { maxLayer: "A" });
		expect(report.disclosure).toContain("(none)");
	});

	it("orders included layers by ascending disclosure", () => {
		const report = buildFieldReport(candidates, { maxLayer: "C" });
		expect(report.layersIncluded).toEqual(["A", "B", "C"]);
	});
});

describe("renderReviewPayload", () => {
	it("returns the EXACT bytes per field, not a rendered summary", () => {
		const report = buildFieldReport(candidates, { maxLayer: "C" });
		const payload = renderReviewPayload(report);
		const diff = payload.find((p) => p.key === "failing_diff");
		// Byte-for-byte identical to the field value — the user reviews what is sent, not a prettified version.
		expect(diff?.bytes).toBe("- const a = 1;\n+ const a = 2;");
	});

	it("carries the 'reveals' explanation so consent is informed", () => {
		const payload = renderReviewPayload(buildFieldReport(candidates, { maxLayer: "C" }));
		expect(payload.every((p) => p.reveals.length > 0)).toBe(true);
	});

	it("never exposes a withheld field", () => {
		const payload = renderReviewPayload(buildFieldReport(candidates, { maxLayer: "A" }));
		expect(payload.map((p) => p.key)).not.toContain("failing_diff");
	});
});

describe("layer typing", () => {
	it("brands each constructor with its own layer", () => {
		expect(structuralField("k", "v", "r").layer).toBe("A");
		expect(narrativeField("k", "v", "r").layer).toBe("B");
		expect(verbatimField("k", "v", "r").layer).toBe("C");
	});

	// The compile-time guarantee is the real defence: `const a: ReportField<"A"> = verbatimField(...)` does not
	// typecheck, so a Layer-C value cannot be placed where Layer-A is required. Asserted by the typechecker in
	// CI rather than at runtime — a runtime check would only catch it after the value already existed.
});
