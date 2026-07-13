import { describe, expect, it } from "vitest";
import type { RailEvidenceReport, RailLaneEvidence } from "../../../src/core/rail-evidence";
import {
	buildRailFindingRetentionEvent,
	classifyRailFindings,
	proposeRailBacklogPackages,
	RAIL_FINDING_DECISION,
	readRetainedRailFindingEvents,
} from "../../../src/core/rail-findings";

/**
 * F1.33 — rail evidence → typed findings (regression / flake / quality_gap / idea), ledger retention
 * (latest-per-finding-id wins), and propose-only deduplicated backlog packages.
 */

function lane(overrides: Partial<RailLaneEvidence> & { label: string }): RailLaneEvidence {
	return {
		workspaceId: `ws-${overrides.label}`,
		startedOk: true,
		startError: null,
		verdict: "delivered",
		cards: 3,
		decomposed: true,
		wsFrames: 10,
		sessionStates: {},
		toolCalls: {},
		totalToolCalls: 12,
		narrationLeaks: 0,
		hotRepeats: 0,
		...overrides,
	};
}

function report(at: string, lanes: RailLaneEvidence[]): RailEvidenceReport {
	return {
		schemaVersion: 1,
		at,
		model: "test-model",
		maxWaitMs: 60_000,
		concurrency: 1,
		projectCount: lanes.length,
		delivered: lanes.filter((entry) => entry.verdict === "delivered").length,
		anomalyProjects: lanes.filter((entry) => entry.narrationLeaks > 0 || entry.hotRepeats > 0).length,
		lanes,
	};
}

/** One report per run so the trend classifier sees a clean oldest→newest stream. */
function runSeries(project: string, verdicts: readonly RailLaneEvidence["verdict"][]): RailEvidenceReport[] {
	return verdicts.map((verdict, index) =>
		report(`2026-07-0${1 + index}T00:00:00.000Z`, [
			lane({ label: project, verdict, startedOk: verdict !== "failed_to_start" }),
		]),
	);
}

describe("classifyRailFindings", () => {
	it("flags a newly-broken scenario as a HIGH regression", () => {
		const reports = runSeries("checkout-flow", ["delivered", "delivered", "failed", "failed"]);
		const { findings } = classifyRailFindings(reports);
		expect(findings.map((finding) => finding.id)).toContain("regression:checkout-flow");
		const regression = findings.find((finding) => finding.kind === "regression");
		expect(regression?.severity).toBe("high");
		expect(regression?.evidence.newlyBroken).toBe(true);
	});

	it("flags mixed outcomes with a stable trend as a flake (not a regression)", () => {
		const reports = runSeries("search-index", [
			"delivered",
			"failed",
			"delivered",
			"failed",
			"delivered",
			"failed",
			"delivered",
			"failed",
		]);
		const { findings } = classifyRailFindings(reports);
		const kinds = findings.filter((finding) => finding.project === "search-index").map((finding) => finding.kind);
		expect(kinds).toContain("flake");
		expect(kinds).not.toContain("regression");
	});

	it("flags a delivering-but-anomalous scenario as a quality gap", () => {
		const reports = [
			report("2026-07-01T00:00:00.000Z", [lane({ label: "habit-score", narrationLeaks: 2 })]),
			report("2026-07-02T00:00:00.000Z", [lane({ label: "habit-score", hotRepeats: 1 })]),
		];
		const { findings } = classifyRailFindings(reports);
		const gap = findings.find((finding) => finding.kind === "quality_gap");
		expect(gap?.project).toBe("habit-score");
		expect(gap?.severity).toBe("medium"); // 2/2 anomaly runs
		expect(gap?.summary).toContain("narration leaks");
	});

	it("flags start-failure-dominated scenarios as an idea (harness work, not model capability)", () => {
		const reports = runSeries("broken-fixture", ["failed_to_start", "failed_to_start", "delivered"]);
		const { findings } = classifyRailFindings(reports);
		const idea = findings.find((finding) => finding.kind === "idea");
		expect(idea?.project).toBe("broken-fixture");
		expect(idea?.evidence.failedToStart).toBe(2);
	});

	it("a healthy scenario yields no findings, and ordering is severity-first", () => {
		const healthy = runSeries("green-path", ["delivered", "delivered", "delivered", "delivered"]);
		const broken = runSeries("checkout-flow", ["delivered", "delivered", "failed", "failed"]);
		const { findings } = classifyRailFindings([...healthy, ...broken]);
		expect(findings.some((finding) => finding.project === "green-path")).toBe(false);
		expect(findings[0]?.severity).toBe("high");
	});
});

describe("ledger retention", () => {
	it("retains findings as transition events and reads back the LATEST per finding id", () => {
		const reports = runSeries("checkout-flow", ["delivered", "delivered", "failed", "failed"]);
		const { findings } = classifyRailFindings(reports);
		const first = buildRailFindingRetentionEvent({
			workspacePathHash: "hash1234hash1234",
			finding: findings[0],
			recordedAt: 1_000,
		});
		const second = buildRailFindingRetentionEvent({
			workspacePathHash: "hash1234hash1234",
			finding: findings[0],
			recordedAt: 2_000,
		});
		expect(first.controllerDecision).toBe(RAIL_FINDING_DECISION);
		expect(first.to).toBe("rail_finding_regression");
		const retained = readRetainedRailFindingEvents([first, second]);
		expect(retained).toHaveLength(1);
		expect(retained[0].recordedAt).toBe(2_000);
	});
});

describe("proposeRailBacklogPackages", () => {
	it("bundles a project's findings into ONE proposal at the worst severity, ordered worst-first", () => {
		const reports = [
			...runSeries("checkout-flow", ["delivered", "delivered", "failed", "failed"]),
			report("2026-07-05T00:00:00.000Z", [lane({ label: "habit-score", narrationLeaks: 1 })]),
			report("2026-07-06T00:00:00.000Z", [lane({ label: "habit-score" })]),
			report("2026-07-07T00:00:00.000Z", [lane({ label: "habit-score" })]),
		];
		const { findings } = classifyRailFindings(reports);
		const proposals = proposeRailBacklogPackages(findings);
		expect(proposals[0].project).toBe("checkout-flow");
		expect(proposals[0].severity).toBe("high");
		expect(proposals[0].proposalId).toBe("rail:checkout-flow");
		const habit = proposals.find((proposal) => proposal.project === "habit-score");
		expect(habit?.findingIds).toEqual(["quality_gap:habit-score"]);
	});

	it("deduplicates against already-proposed ids (re-running never re-proposes known work)", () => {
		const reports = runSeries("checkout-flow", ["delivered", "delivered", "failed", "failed"]);
		const { findings } = classifyRailFindings(reports);
		const proposals = proposeRailBacklogPackages(findings, new Set(["rail:checkout-flow"]));
		expect(proposals).toEqual([]);
	});
});
