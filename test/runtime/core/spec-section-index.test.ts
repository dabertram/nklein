import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSpecSectionIndex, planSpecRetrieval } from "../../../src/core/spec-section-index";

/**
 * P23.7 — guards for the progressive-disclosure index.
 *
 * The last test runs against the REAL 25k-word fixture rather than a toy document, because the failure modes that
 * matter here only appear at scale: fenced code blocks containing `#`, repeated heading names across sections,
 * and deep nesting. A parser that handles a synthetic three-heading document proves nothing about this one.
 */

const SPEC_PATH = "dev-test-projects/36_dark_factory_dschinn_universal_agent/specification.md";

describe("buildSpecSectionIndex", () => {
	it("captures heading ancestry, not just the heading", () => {
		const index = buildSpecSectionIndex("# Top\nintro\n## Child\nbody\n### Grandchild\ndeep\n");
		expect(index.sections.map((section) => section.path)).toEqual([
			["Top"],
			["Top", "Child"],
			["Top", "Child", "Grandchild"],
		]);
	});

	it("does NOT invent sections from `#` inside fenced code", () => {
		// This document is full of shell snippets and markdown examples. Without fence tracking the index fills
		// with sections named after comments, and every word count downstream is wrong.
		const index = buildSpecSectionIndex("# Real\n```bash\n# not a heading\necho hi\n```\nbody\n");
		expect(index.sections.map((section) => section.heading)).toEqual(["Real"]);
	});

	it("separates a section's OWN words from its subtree total", () => {
		// "What does reading this section cost me?" is the subtree, not the paragraph — that is the number a
		// retrieval budget has to reason with.
		const index = buildSpecSectionIndex("# Top\none two three\n## Child\nfour five\n");
		const top = index.sections.find((section) => section.heading === "Top");
		expect(top?.ownWords).toBe(3);
		expect(top?.totalWords).toBe(5);
	});

	it("gives colliding heading names DISTINCT stable ids", () => {
		// Two "Overview" sections under different parents are different sections. A path-only id collides; a
		// content-only hash is identical. The pairing is what makes an id safe to cite in a plan.
		const index = buildSpecSectionIndex("# A\n## Overview\nx\n# B\n## Overview\ny\n");
		const overviews = index.sections.filter((section) => section.heading === "Overview");
		expect(overviews).toHaveLength(2);
		expect(overviews[0]?.id).not.toBe(overviews[1]?.id);
	});

	it("keeps an id stable when unrelated text changes", () => {
		// The property that makes an id worth citing: fixing a typo three sections away must not renumber the
		// document.
		const before = buildSpecSectionIndex("# A\n## Target\nx\n## Other\noriginal\n");
		const after = buildSpecSectionIndex("# A\n## Target\nx\n## Other\nEDITED ENTIRELY\n");
		const id = (index: ReturnType<typeof buildSpecSectionIndex>) =>
			index.sections.find((section) => section.heading === "Target")?.id;
		expect(id(before)).toBe(id(after));
	});

	it("handles a document with no headings without inventing one", () => {
		const index = buildSpecSectionIndex("just prose, no structure at all\n");
		expect(index.sections).toEqual([]);
	});
});

describe("planSpecRetrieval", () => {
	it("fits what it can and DEFERS the rest by id", () => {
		const index = buildSpecSectionIndex("# A\none two three four five\n# B\nsix seven\n");
		const plan = planSpecRetrieval(index, 4);
		expect(plan.included.map((section) => section.heading)).toEqual(["B"]);
		expect(plan.deferred.map((section) => section.heading)).toEqual(["A"]);
		expect(plan.summary).toContain("DEFERRED");
	});

	it("DEFERS an over-budget section rather than truncating it", () => {
		// Half a requirement is worse than a pointer to the whole one, because the half reads as complete.
		const index = buildSpecSectionIndex(`# Huge\n${"word ".repeat(500)}`);
		const plan = planSpecRetrieval(index, 10);
		expect(plan.included).toEqual([]);
		expect(plan.deferred).toHaveLength(1);
	});

	it("says so plainly when everything fits", () => {
		const index = buildSpecSectionIndex("# A\nshort\n");
		expect(planSpecRetrieval(index, 1000).summary).toContain("all 1 section(s) fit");
	});
});

describe("against the REAL 25k-word specification", () => {
	it("indexes it, and confirms it cannot be read whole at !Klein's context floor", () => {
		// The measurement P23.7 rests on. The spec instructs "read the entire specification before planning";
		// this shows what that instruction actually costs.
		const index = buildSpecSectionIndex(readFileSync(SPEC_PATH, "utf8"));
		expect(index.sections.length).toBeGreaterThan(50);
		expect(index.sections.reduce((sum, section) => sum + section.ownWords, 0)).toBeGreaterThan(20_000);

		// ~4k words is a generous slice of a 32k-token budget once system instructions, repo evidence, reasoning
		// and the plan output are accounted for. Most of the document does not fit, which is the point.
		const plan = planSpecRetrieval(index, 4_000);
		expect(plan.deferred.length).toBeGreaterThan(plan.included.length);
	});

	it("shows the historical v3/v4 rationale is the heaviest content — P23.7's claim, measured", () => {
		// P23.7 asserts the v2/v3/v4 rationale should move OUT of the active execution spec. That was a judgement;
		// this makes it a measurement, and the measurement agrees.
		const index = buildSpecSectionIndex(readFileSync(SPEC_PATH, "utf8"));
		const heaviest = [...index.sections].sort((left, right) => right.ownWords - left.ownWords).slice(0, 5);
		const historical = heaviest.filter((section) => /\bv[234]\b/iu.test(section.path.join(" ")));
		expect(
			historical.length,
			`the five heaviest sections should be dominated by historical rationale; got: ${heaviest.map((s) => s.heading).join(" | ")}`,
		).toBeGreaterThanOrEqual(3);
	});
});
