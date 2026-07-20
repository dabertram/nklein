import { describe, expect, it } from "vitest";
import { buildContextReanchor } from "../../src/core/context-reanchor";
import {
	assessReanchorCoverage,
	auditReanchorPaths,
	OBSERVED_REANCHOR_PATHS,
	REQUIRED_REANCHOR_ELEMENTS,
} from "../../src/core/reanchor-coverage";

describe("assessReanchorCoverage", () => {
	const full = {
		objective: "Ship the export command",
		currentFocus: "writing the CSV serializer",
		constraints: ["no new dependencies"],
		acceptanceCriteria: ["round-trips a 10k-row fixture"],
	};

	it("passes when all four elements are carried and the block is small", () => {
		const result = assessReanchorCoverage({ source: full, blockChars: 300, surroundingContextChars: 40_000 });
		expect(result.passed).toBe(true);
		expect(result.covered).toEqual(REQUIRED_REANCHOR_ELEMENTS);
	});

	it("fails when acceptance criteria are absent, naming the element", () => {
		const result = assessReanchorCoverage({
			source: { ...full, acceptanceCriteria: [] },
			blockChars: 300,
			surroundingContextChars: 40_000,
		});
		expect(result.passed).toBe(false);
		expect(result.missing).toContain("acceptance_criteria");
		expect(result.summary).toContain("never injected");
	});

	it("treats whitespace-only values as NOT carried", () => {
		// A blank objective renders as an empty line — present in the block, absent as information.
		const result = assessReanchorCoverage({
			source: { ...full, objective: "   " },
			blockChars: 300,
			surroundingContextChars: 40_000,
		});
		expect(result.missing).toContain("objective");
	});

	it("treats a list of blanks as NOT carried", () => {
		const result = assessReanchorCoverage({
			source: { ...full, constraints: ["", "  "] },
			blockChars: 300,
			surroundingContextChars: 40_000,
		});
		expect(result.missing).toContain("constraints");
	});

	it("FAILS a re-anchor that achieves coverage by duplicating the context", () => {
		// The cheap way to pass a retention check is to re-inject everything. F4.8 forbids exactly that.
		const result = assessReanchorCoverage({ source: full, blockChars: 12_000, surroundingContextChars: 40_000 });
		expect(result.missing).toEqual([]);
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("duplication, not a reminder");
	});

	it("does not trade coverage against size — small but incomplete still fails", () => {
		const result = assessReanchorCoverage({
			source: { objective: "ship it" },
			blockChars: 40,
			surroundingContextChars: 40_000,
		});
		expect(result.withinBudget).toBe(true);
		expect(result.passed).toBe(false);
	});

	it("does not divide by zero on an empty surrounding context", () => {
		const result = assessReanchorCoverage({ source: full, blockChars: 100, surroundingContextChars: 0 });
		expect(Number.isFinite(result.contextShare)).toBe(true);
	});

	it("is NOT fooled by a rendered block that merely mentions the words", () => {
		// The live core renders a goal that talks about acceptance criteria. String-matching the output would
		// report acceptance_criteria as covered; assessing the structured source correctly does not.
		const block = buildContextReanchor({
			goal: "Satisfy the acceptance criteria and constraints listed in the card",
			currentStep: "step 2",
		});
		expect(block).toContain("acceptance criteria");
		const result = assessReanchorCoverage({
			source: { objective: "Satisfy the acceptance criteria...", currentFocus: "step 2" },
			blockChars: block.length,
			surroundingContextChars: 40_000,
		});
		expect(result.missing).toContain("acceptance_criteria");
		expect(result.missing).toContain("constraints");
	});
});

describe("auditReanchorPaths", () => {
	it("reports the CURRENT live state: F4.8 is not satisfied today", () => {
		const audit = auditReanchorPaths(OBSERVED_REANCHOR_PATHS);
		expect(audit.passed).toBe(false);
		expect(audit.liveElements).toEqual(["objective", "current_focus"]);
		expect(audit.missingFromLive).toContain("acceptance_criteria");
	});

	it("distinguishes ALREADY BUILT BUT UNWIRED from never built — different fixes", () => {
		// acceptance_criteria exists in instruction-reanchor.ts (F12.21) with zero importers; constraints exist
		// nowhere. Merging these would send someone to rebuild a core that already exists.
		const audit = auditReanchorPaths(OBSERVED_REANCHOR_PATHS);
		expect(audit.availableButUnwired).toEqual(["acceptance_criteria"]);
		expect(audit.missingFromLive).toContain("constraints");
		expect(audit.availableButUnwired).not.toContain("constraints");
		expect(audit.summary).toContain("the fix is a wire, not a new core");
	});

	it("passes once every element reaches a live prompt", () => {
		const audit = auditReanchorPaths([
			{ module: "everything.ts", wired: true, provides: REQUIRED_REANCHOR_ELEMENTS },
		]);
		expect(audit.passed).toBe(true);
	});

	it("the observed path table is non-empty — an empty table would pass while asserting nothing", () => {
		expect(OBSERVED_REANCHOR_PATHS.length).toBeGreaterThan(0);
	});
});
