import { describe, expect, it } from "vitest";
import {
	formatRailFindingsReport,
	proposeRailBacklogPackages,
	type RailFinding,
	type RailFindingsReport,
} from "./rail-findings";

function finding(overrides: Partial<RailFinding> & Pick<RailFinding, "kind" | "project" | "severity">): RailFinding {
	return {
		id: `${overrides.kind}:${overrides.project}`,
		summary: overrides.summary ?? `${overrides.kind} in ${overrides.project}`,
		evidence: {
			runs: 4,
			deliveryRate: 0.5,
			delta: null,
			newlyBroken: false,
			anomalyRuns: 0,
			failedToStart: 0,
			...overrides.evidence,
		},
		...overrides,
	};
}

/** The formatter only reads `report.findings`; trend/aggregate are irrelevant to the output. */
function reportOf(findings: RailFinding[]): RailFindingsReport {
	return { findings, trend: {} as RailFindingsReport["trend"], aggregate: {} as RailFindingsReport["aggregate"] };
}

describe("formatRailFindingsReport (F1.33b CLI mount)", () => {
	it("a clean rail prints the explicit no-findings line", () => {
		const text = formatRailFindingsReport(reportOf([]), []);
		expect(text).toContain("Rail findings — none");
	});

	it("lists findings most-severe-first with evidence, then the propose-only backlog packages", () => {
		const findings = [
			finding({
				kind: "regression",
				project: "audio_vst",
				severity: "high",
				evidence: { newlyBroken: true } as never,
			}),
			finding({ kind: "flake", project: "deep_chain", severity: "medium" }),
		];
		const proposals = proposeRailBacklogPackages(findings);
		const text = formatRailFindingsReport(reportOf(findings), proposals);

		expect(text).toContain("Rail findings — 2");
		expect(text).toContain("[high] regression");
		expect(text).toContain("audio_vst");
		expect(text).toContain("newly-broken");
		expect(text).toContain("[medium] flake");
		// Propose-only backlog packages appear, one per project, and never claim to write todo.md.
		expect(text).toContain("Proposed backlog packages");
		expect(text).toContain("propose-only — nothing writes todo.md");
		expect(text).toContain("Rail: investigate audio_vst");
	});
});
