import { describe, expect, it } from "vitest";
import {
	aggregateRailEvidence,
	buildRailEvidenceAnalysisPrompt,
	type RailEvidenceReport,
	type RailLaneEvidence,
} from "../../../src/core/rail-evidence";

function lane(
	label: string,
	verdict: RailLaneEvidence["verdict"],
	extra: Partial<RailLaneEvidence> = {},
): RailLaneEvidence {
	return {
		label,
		workspaceId: `ws-${label}`,
		startedOk: verdict !== "failed_to_start",
		startError: null,
		verdict,
		cards: 0,
		decomposed: false,
		wsFrames: 0,
		sessionStates: {},
		toolCalls: {},
		totalToolCalls: 0,
		narrationLeaks: 0,
		hotRepeats: 0,
		...extra,
	};
}

function report(model: string, lanes: RailLaneEvidence[]): RailEvidenceReport {
	return {
		schemaVersion: 1,
		at: new Date().toISOString(),
		model,
		maxWaitMs: 1000,
		concurrency: lanes.length,
		projectCount: lanes.length,
		delivered: lanes.filter((l) => l.verdict === "delivered").length,
		anomalyProjects: lanes.filter((l) => l.narrationLeaks > 0 || l.hotRepeats > 0).length,
		lanes,
	};
}

describe("aggregateRailEvidence", () => {
	it("returns an empty rollup for no reports", () => {
		expect(aggregateRailEvidence([])).toEqual({ totalReports: 0, totalRuns: 0, models: [], byProject: [] });
	});

	it("rolls up per-project verdicts + delivery rate across runs", () => {
		const reports = [
			report("m1", [lane("alpha", "delivered"), lane("beta", "failed")]),
			report("m1", [lane("alpha", "delivered"), lane("beta", "delivered")]),
		];
		const agg = aggregateRailEvidence(reports);
		expect(agg.totalReports).toBe(2);
		expect(agg.totalRuns).toBe(4);
		const alpha = agg.byProject.find((p) => p.project === "alpha");
		const beta = agg.byProject.find((p) => p.project === "beta");
		expect(alpha?.runs).toBe(2);
		expect(alpha?.deliveryRate).toBe(1);
		expect(beta?.delivered).toBe(1);
		expect(beta?.failed).toBe(1);
		expect(beta?.deliveryRate).toBe(0.5);
	});

	it("sorts WORST-FIRST (lowest delivery rate leads, ties broken by more anomaly runs)", () => {
		const reports = [
			report("m", [
				lane("good", "delivered"),
				lane("bad", "failed"),
				lane("flaky", "delivered", { narrationLeaks: 3 }),
			]),
			report("m", [lane("flaky", "non_terminal", { hotRepeats: 2 })]),
		];
		const order = aggregateRailEvidence(reports).byProject.map((p) => p.project);
		// bad: 0/1 = 0.0 → first; flaky: 1/2 = 0.5 (2 anomaly runs); good: 1/1 = 1.0 → last
		expect(order).toEqual(["bad", "flaky", "good"]);
	});

	it("counts anomaly runs + totals, and collects distinct models", () => {
		const reports = [
			report("model-a", [lane("x", "delivered", { narrationLeaks: 2, hotRepeats: 1 })]),
			report("model-b", [lane("x", "delivered", { narrationLeaks: 0, hotRepeats: 0 })]),
		];
		const agg = aggregateRailEvidence(reports);
		expect(agg.models).toEqual(["model-a", "model-b"]);
		const x = agg.byProject.find((p) => p.project === "x");
		expect(x?.anomalyRuns).toBe(1);
		expect(x?.totalNarrationLeaks).toBe(2);
		expect(x?.totalHotRepeats).toBe(1);
	});
});

describe("buildRailEvidenceAnalysisPrompt", () => {
	it("includes each scenario's signals + the parse-and-recover instruction", () => {
		const aggregate = aggregateRailEvidence([
			report("qwen", [lane("alpha", "failed"), lane("beta", "delivered", { narrationLeaks: 2 })]),
		]);
		const { title, prompt } = buildRailEvidenceAnalysisPrompt(aggregate);
		expect(title).toMatch(/rail evidence/i);
		expect(prompt).toContain("alpha");
		expect(prompt).toContain("beta");
		expect(prompt).toContain("qwen");
		expect(prompt).toMatch(/PARSE-AND-RECOVER/i); // weak-model principle, not re-prompt
		expect(prompt).toContain("[ ]"); // proposes todo bullets
	});

	it("handles an empty harvest without crashing", () => {
		const { prompt } = buildRailEvidenceAnalysisPrompt(aggregateRailEvidence([]));
		expect(prompt).toContain("no runs harvested yet");
	});
});
