import { describe, expect, it } from "vitest";
import {
	auditRequirementCoverage,
	type RequirementSpec,
	sweepRequirementCoverage,
} from "../../src/core/requirement-coverage-audit";

// Modelled on the real F4.8 finding: two re-anchor cores split one requirement, and the core carrying the
// acceptance criteria has no importers.
const F4_8: RequirementSpec = {
	id: "F4.8",
	elements: [
		{ element: "objective", providedBy: { module: "context-reanchor.ts", symbol: "buildContextReanchor" } },
		{ element: "current_focus", providedBy: { module: "context-reanchor.ts", symbol: "buildContextReanchor" } },
		{ element: "constraints", providedBy: null },
		{
			element: "acceptance_criteria",
			providedBy: { module: "instruction-reanchor.ts", symbol: "buildReanchorReminder" },
		},
	],
};

const ORPHANS = new Set(["instruction-reanchor.ts::buildReanchorReminder"]);

describe("auditRequirementCoverage", () => {
	it("passes only when every element reaches a live consumer", () => {
		const coverage = auditRequirementCoverage(
			{ id: "X", elements: [{ element: "a", providedBy: { module: "m.ts", symbol: "f" } }] },
			new Set(),
		);
		expect(coverage.passed).toBe(true);
	});

	it("classifies an element whose provider has no consumer as BUILT_BUT_UNWIRED", () => {
		const coverage = auditRequirementCoverage(F4_8, ORPHANS);
		expect(coverage.builtButUnwired).toEqual(["acceptance_criteria"]);
		expect(coverage.summary).toContain("fix = a wire");
	});

	it("keeps NO_PROVIDER_RECORDED separate from built-but-unwired — different work, different person", () => {
		const coverage = auditRequirementCoverage(F4_8, ORPHANS);
		expect(coverage.noProviderRecorded).toEqual(["constraints"]);
		expect(coverage.builtButUnwired).not.toContain("constraints");
	});

	it("never claims an unmapped element is UNBUILT — the map is hand-maintained", () => {
		// Absence from a hand-maintained map is absence of evidence. Reporting it as "not built" would send someone
		// to write a core that may already exist, which is the most expensive way to be wrong here.
		const coverage = auditRequirementCoverage(F4_8, ORPHANS);
		const constraints = coverage.findings.find((f) => f.element === "constraints");
		expect(constraints?.detail).toContain("absence of EVIDENCE");
		expect(constraints?.detail).not.toContain("is unbuilt.");
	});

	it("marks the wired half of a split requirement as satisfied", () => {
		const coverage = auditRequirementCoverage(F4_8, ORPHANS);
		expect(coverage.satisfied).toEqual(["objective", "current_focus"]);
		expect(coverage.passed).toBe(false);
	});

	it("recomputes when the orphan set changes — wiring is not a hand-maintained flag", () => {
		// The whole point of deriving wired-ness from the orphan set: connect the core and the audit passes without
		// anyone remembering to flip a boolean. A declared `wired: true` would rot into a false pass on deletion.
		const coverage = auditRequirementCoverage(
			{ id: "F4.8", elements: F4_8.elements.filter((e) => e.providedBy !== null) },
			new Set(),
		);
		expect(coverage.passed).toBe(true);
	});
});

describe("sweepRequirementCoverage", () => {
	it("fails an EMPTY requirement spec rather than passing it trivially", () => {
		// Same hazard N5's resolvePack refuses: asserting nothing while looking green.
		const sweep = sweepRequirementCoverage([{ id: "empty", elements: [] }], new Set());
		expect(sweep.failing).toHaveLength(1);
		expect(sweep.coverages[0]?.summary).toContain("asserts nothing while appearing to pass");
	});

	it("names the reason this level of checking exists", () => {
		const sweep = sweepRequirementCoverage([F4_8], ORPHANS);
		expect(sweep.summary).toContain("fully green test suite");
	});

	it("passes a clean sweep", () => {
		const sweep = sweepRequirementCoverage(
			[{ id: "ok", elements: [{ element: "a", providedBy: { module: "m.ts", symbol: "f" } }] }],
			new Set(),
		);
		expect(sweep.failing).toHaveLength(0);
		expect(sweep.summary).toContain("fully reach production");
	});
});
