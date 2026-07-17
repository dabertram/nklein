import { describe, expect, it } from "vitest";
import { lintSpecForDecompose } from "../../../src/core/spec-lint";

describe("lintSpecForDecompose (F12.9)", () => {
	it("passes a tight spec with an acceptance command and measurable criteria", () => {
		const spec = [
			"Add a rate limiter to the ingest endpoint.",
			"Success: p95 latency stays under 200ms at 100 req/s.",
			"Acceptance: npm test -- rate-limiter passes.",
		].join("\n");
		expect(lintSpecForDecompose(spec)).toEqual([]);
	});

	it("flags a missing acceptance check first, with a ready-to-ask question", () => {
		const findings = lintSpecForDecompose("Make the dashboard load.");
		expect(findings[0]?.kind).toBe("missing_acceptance");
		expect(findings[0]?.question).toContain("proves this is done");
	});

	it("flags vague quality words without a measurable bound, but not with one", () => {
		const vague = lintSpecForDecompose("The search must be fast.\nAcceptance: npm test");
		expect(vague.some((finding) => finding.kind === "unmeasurable_criterion")).toBe(true);
		const bounded = lintSpecForDecompose("The search must be fast: under 100ms p95.\nAcceptance: npm test");
		expect(bounded.some((finding) => finding.kind === "unmeasurable_criterion")).toBe(false);
	});

	it("catches naive must/must-not contradictions over the same action", () => {
		const findings = lintSpecForDecompose(
			[
				"The worker must write logs to disk.",
				"The worker must not write logs to disk.",
				"Acceptance: npm test",
			].join("\n"),
		);
		const contradiction = findings.find((finding) => finding.kind === "contradiction");
		expect(contradiction?.question).toContain("requires and forbids");
	});

	it("flags undefined acronyms but not defined or well-known ones", () => {
		const findings = lintSpecForDecompose(
			"Sync with the QRS every hour. The API returns JSON. TTL (time to live) is 60s.\nAcceptance: npm test",
		);
		const undefinedTerms = findings.filter((finding) => finding.kind === "undefined_term");
		expect(undefinedTerms.map((finding) => finding.detail)).toEqual(['"QRS" is used but never defined in the spec.']);
	});
});
