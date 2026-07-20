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
	it("reports the CURRENT live state: NOTHING reaches a live prompt today", () => {
		// ⚠️ Corrected 2026-07-20. This previously asserted `["objective", "current_focus"]` were live, which was
		// WRONG: the injection site is guarded by NKLEIN_GOAL_REANCHOR and is DEFAULT OFF, so in the shipped
		// configuration no re-anchor block reaches any prompt at all. F4.8 is not partly met, it is entirely unmet.
		const audit = auditReanchorPaths(OBSERVED_REANCHOR_PATHS);
		expect(audit.passed).toBe(false);
		expect(audit.liveElements).toEqual([]);
		expect(audit.missingFromLive).toEqual([...REQUIRED_REANCHOR_ELEMENTS]);
	});

	it("does NOT count an env-gated, default-OFF path as live — the trap this nearly fell into", () => {
		// The block was extended to carry all four elements the same day. Had the path stayed marked `wired: true`,
		// the gate would have flipped to COMPLETE while nothing whatsoever ran by default — an audit reporting a
		// requirement satisfied by code that does not execute. "Imported" and "reaches a live prompt" are different
		// claims; tracing the import chain only ever proves the weaker one.
		const contextReanchor = OBSERVED_REANCHOR_PATHS.find((path) => path.module === "context-reanchor.ts");
		expect(contextReanchor?.provides).toEqual([...REQUIRED_REANCHOR_ELEMENTS]);
		expect(contextReanchor?.wired).toBe(false);
	});

	it("distinguishes ALREADY BUILT BUT UNWIRED from never built — different fixes", () => {
		// Every element is now built somewhere and none is live, so all four are "available but unwired": the fix
		// is flipping a default, not writing a core. Merging these categories would send someone to rebuild code
		// that already exists.
		const audit = auditReanchorPaths(OBSERVED_REANCHOR_PATHS);
		expect(audit.availableButUnwired).toEqual([...REQUIRED_REANCHOR_ELEMENTS]);
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
