import { describe, expect, it } from "vitest";
import { measureSynthesisEvidenceSaving } from "../../src/core/retrieval-synthesis-adapter";

/**
 * F4.6b (computable half) — measures the context saving of the LIVE evidence excerpt path. The value is that it
 * measures the real path, and that it states the one thing a token count cannot see: whether a saving dropped a
 * span the answer needed.
 */

const longIrrelevant = `${"padding sentence about unrelated topics. ".repeat(200)}`;
const shortText = "concise fact about quantum error correction thresholds.";

describe("measureSynthesisEvidenceSaving", () => {
	it("reports a real saving when long evidence is narrowed to query-relevant windows", () => {
		const m = measureSynthesisEvidenceSaving("quantum error correction threshold", [
			{ id: "e1", text: `intro. the threshold theorem states a bound. ${longIrrelevant}` },
		]);
		expect(m.tokensBefore).toBeGreaterThan(m.tokensAfter);
		expect(m.tokensSaved).toBeGreaterThan(0);
	});

	it("saves nothing on evidence already within the excerpt cap", () => {
		const m = measureSynthesisEvidenceSaving("quantum error correction", [{ id: "e1", text: shortText }]);
		expect(m.tokensSaved).toBe(0);
		expect(m.tokensBefore).toBe(m.tokensAfter);
	});

	it("attributes the saving per-evidence, not just in aggregate", () => {
		const m = measureSynthesisEvidenceSaving("threshold", [
			{ id: "big", text: `threshold. ${longIrrelevant}` },
			{ id: "small", text: shortText },
		]);
		const big = m.perEvidence.find((e) => e.id === "big");
		const small = m.perEvidence.find((e) => e.id === "small");
		expect((big?.before ?? 0) - (big?.after ?? 0)).toBeGreaterThan(0);
		expect(small?.before).toBe(small?.after);
	});

	it("STATES that answer quality is not measured — a dropped needed span is invisible to the token count", () => {
		const m = measureSynthesisEvidenceSaving("x", [{ id: "e1", text: `x. ${longIrrelevant}` }]);
		expect(m.summary).toContain("Answer-quality impact is NOT measured");
	});

	it("handles empty evidence without dividing by zero", () => {
		expect(measureSynthesisEvidenceSaving("q", []).summary).toContain("no evidence");
	});
});
