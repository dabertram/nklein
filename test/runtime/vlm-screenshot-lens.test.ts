import { describe, expect, it } from "vitest";
import { buildVlmLensPrompt, decideVlmLens, parseVlmLensVerdict } from "../../src/core/vlm-screenshot-lens";

const base = { visionModelAvailable: true, hasScreenshot: true };

describe("decideVlmLens", () => {
	it("applies when UI files changed and a screenshot exists", () => {
		expect(decideVlmLens({ ...base, changedFilePaths: ["web-ui/src/Card.tsx"] }).applicability).toBe("applicable");
	});

	it("declines when no UI-surface files changed", () => {
		expect(decideVlmLens({ ...base, changedFilePaths: ["src/core/router.ts"] }).applicability).toBe("not_applicable");
	});

	it("DECLINES rather than judging when UI changed but no screenshot exists", () => {
		// The important branch: a vision lens without an image has no evidence, and must not guess from the diff.
		const decision = decideVlmLens({ ...base, hasScreenshot: false, changedFilePaths: ["a.tsx"] });
		expect(decision.applicability).toBe("not_applicable");
		expect(decision.reason).toContain("cannot see");
	});

	it("is fleet-gated on a vision model actually being loaded", () => {
		const decision = decideVlmLens({ ...base, visionModelAvailable: false, changedFilePaths: ["a.tsx"] });
		expect(decision.applicability).toBe("not_applicable");
	});

	it("recognizes the common UI extensions", () => {
		for (const path of ["a.tsx", "b.vue", "c.svelte", "d.scss", "e.html", "f.css"]) {
			expect(decideVlmLens({ ...base, changedFilePaths: [path] }).applicability).toBe("applicable");
		}
	});
});

describe("buildVlmLensPrompt", () => {
	it("demands a SEEN citation for every defect", () => {
		const prompt = buildVlmLensPrompt({ objective: "center the modal" });
		expect(prompt).toContain("SEEN:");
		expect(prompt).toContain("A claim you cannot point at is a guess");
	});

	it("offers explicit escapes for both 'cannot judge' and 'no defects'", () => {
		const prompt = buildVlmLensPrompt({ objective: "x" });
		expect(prompt).toContain("NOTHING_VISIBLE");
		expect(prompt).toContain("NO_DEFECTS");
	});
});

describe("parseVlmLensVerdict", () => {
	it("parses cited defects", () => {
		const verdict = parseVlmLensVerdict(
			"DEFECT: modal overlaps the header | SEEN: the dialog top edge sits above the nav bar",
		);
		expect(verdict.kind).toBe("defects");
		expect(verdict.defects).toHaveLength(1);
		expect(verdict.reviewerNote).toContain("ADVISORY");
	});

	it("DROPS a defect claim with no SEEN citation — an uncited claim is a guess", () => {
		const verdict = parseVlmLensVerdict("DEFECT: the spacing looks wrong");
		expect(verdict.kind).toBe("inconclusive");
		expect(verdict.defects).toHaveLength(0);
	});

	it("reads NOTHING_VISIBLE as inconclusive, never as approval", () => {
		expect(parseVlmLensVerdict("NOTHING_VISIBLE").kind).toBe("inconclusive");
	});

	it("reads an empty or rambling reply as inconclusive, never as approval", () => {
		expect(parseVlmLensVerdict("").kind).toBe("inconclusive");
		expect(parseVlmLensVerdict("Looks pretty good to me overall!").kind).toBe("inconclusive");
	});

	it("recognizes an explicit NO_DEFECTS", () => {
		expect(parseVlmLensVerdict("NO_DEFECTS").kind).toBe("no_defects");
	});

	it("caps defects so a chatty lens cannot flood the review", () => {
		const many = Array.from({ length: 12 }, (_, i) => `DEFECT: d${i} | SEEN: s${i}`).join("\n");
		expect(parseVlmLensVerdict(many).defects.length).toBeLessThanOrEqual(5);
	});
});
