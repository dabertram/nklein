import { describe, expect, it } from "vitest";
import {
	buildNightlyFailureReport,
	type NightlyFailureInput,
	summarizeNightlyFailures,
} from "../../src/core/nightly-failure-report";
import type { PackResult } from "../../src/core/nightly-invariant-pack";

const VERDICT: PackResult = {
	packId: "core",
	checks: [],
	violated: [],
	indeterminate: [],
	passed: false,
	summary: "core: 1 violated",
};

function input(overrides: Partial<NightlyFailureInput> = {}): NightlyFailureInput {
	return {
		cellId: "smoke-ts-cli",
		seed: "4242",
		homePath: "/tmp/nightly/smoke-ts-cli",
		homeRetained: true,
		packResult: VERDICT,
		...overrides,
	};
}

describe("buildNightlyFailureReport", () => {
	it("is debuggable when cell, seed, home and a verdict are all present", () => {
		const report = buildNightlyFailureReport(input());
		expect(report.debuggable).toBe(true);
		expect(report.defects).toEqual([]);
		expect(report.text).toContain("/tmp/nightly/smoke-ts-cli");
	});

	it("FLAGS the contradiction: retained:true with no path", () => {
		// The worst case. An absent report sends someone to re-run; a false one sends them to nothing and they
		// conclude the bug is unreproducible rather than that the evidence was never saved.
		const report = buildNightlyFailureReport(input({ homeRetained: true, homePath: "   " }));
		expect(report.defects).toContain("retention_contradiction");
		expect(report.debuggable).toBe(false);
		expect(report.text).toContain("do not trust this");
	});

	it("does NOT silently downgrade a contradiction to 'not retained'", () => {
		// Quietly rewriting the claim would hide that the runner's retention logic is broken.
		const report = buildNightlyFailureReport(input({ homeRetained: true, homePath: null }));
		expect(report.defects).toContain("retention_contradiction");
		expect(report.defects).not.toContain("home_not_retained");
	});

	it("treats an honestly-unretained home as a defect but NOT as undebuggable", () => {
		// A seed plus a pack verdict is often enough. Demanding retained state for every failure would put the bar
		// out of reach and get the whole check ignored.
		const report = buildNightlyFailureReport(input({ homeRetained: false, homePath: null }));
		expect(report.defects).toContain("home_not_retained");
		expect(report.debuggable).toBe(true);
		expect(report.text).toContain("only this summary survives");
	});

	it("fails a report with no seed — the failure cannot be re-run", () => {
		const report = buildNightlyFailureReport(input({ seed: null }));
		expect(report.defects).toContain("missing_seed");
		expect(report.debuggable).toBe(false);
	});

	it("fails a report that names no failure evidence at all", () => {
		// Marked failed, but carries neither a verdict nor an error: it says something broke without saying what.
		const report = buildNightlyFailureReport(input({ packResult: null, error: null }));
		expect(report.defects).toContain("no_failure_evidence");
		expect(report.debuggable).toBe(false);
	});

	it("accepts a crash with an error and no pack verdict", () => {
		const report = buildNightlyFailureReport(input({ packResult: null, error: "ENOSPC writing worktree" }));
		expect(report.debuggable).toBe(true);
		expect(report.text).toContain("ENOSPC");
	});

	it("treats a whitespace-only error as no evidence", () => {
		const report = buildNightlyFailureReport(input({ packResult: null, error: "   " }));
		expect(report.defects).toContain("no_failure_evidence");
	});

	it("flags an unnamed cell rather than emitting a blank line", () => {
		const report = buildNightlyFailureReport(input({ cellId: "  " }));
		expect(report.defects).toContain("missing_cell_id");
		expect(report.text).toContain("cannot be located");
	});
});

describe("summarizeNightlyFailures", () => {
	it("separates undebuggable failures and says why that matters more", () => {
		const summary = summarizeNightlyFailures([
			buildNightlyFailureReport(input()),
			buildNightlyFailureReport(input({ cellId: "broken", seed: null })),
		]);
		expect(summary.undebuggable).toHaveLength(1);
		expect(summary.text).toContain("cost a morning every run");
	});

	it("says so plainly when everything is investigable", () => {
		const summary = summarizeNightlyFailures([buildNightlyFailureReport(input())]);
		expect(summary.text).toContain("all are debuggable");
	});

	it("handles a clean run", () => {
		expect(summarizeNightlyFailures([]).text).toContain("No failing cells");
	});
});
