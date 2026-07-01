import { describe, expect, it } from "vitest";
import {
	type ClassifyRailDeliveryTrendInput,
	classifyRailDeliveryTrend,
	type DeliveryTrendDirection,
} from "../../../src/core/rail-delivery-trend";
import type { RailEvidenceReport, RailLaneEvidence } from "../../../src/core/rail-evidence";

/** Build a lane with just the fields this trend core reads (verdict/label); the rest match the sibling shape. */
function lane(label: string, verdict: RailLaneEvidence["verdict"]): RailLaneEvidence {
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
	};
}

/** One report at ISO time `at` carrying one lane per (label, verdict) pair. */
function report(at: string, lanes: RailLaneEvidence[], model = "qwen/qwen3-8b"): RailEvidenceReport {
	return {
		schemaVersion: 1,
		at,
		model,
		maxWaitMs: 1000,
		concurrency: lanes.length,
		projectCount: lanes.length,
		delivered: lanes.filter((l) => l.verdict === "delivered").length,
		anomalyProjects: 0,
		lanes,
	};
}

/** Convenience: a single-lane report for `label` at day `d` (2026-07-0d) with `delivered` or `failed`. */
function run(label: string, day: number, delivered: boolean): RailEvidenceReport {
	const at = `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`;
	return report(at, [lane(label, delivered ? "delivered" : "failed")]);
}

function directionOf(input: ClassifyRailDeliveryTrendInput, project: string): DeliveryTrendDirection {
	const trend = classifyRailDeliveryTrend(input).byProject.find((t) => t.project === project);
	if (trend === undefined) {
		throw new Error(`no trend for ${project}`);
	}
	return trend.direction;
}

describe("classifyRailDeliveryTrend", () => {
	it("flags a scenario that used to deliver but recently stopped as regressing + newlyBroken", () => {
		// baseline (days 1-2) delivered, recent (days 3-4) failed → drop of 1.0, and recent rate is exactly 0.
		const reports = [run("alpha", 1, true), run("alpha", 2, true), run("alpha", 3, false), run("alpha", 4, false)];
		const out = classifyRailDeliveryTrend({ reports });
		const alpha = out.byProject[0];
		expect(alpha.project).toBe("alpha");
		expect(alpha.direction).toBe("regressing");
		expect(alpha.newlyBroken).toBe(true);
		expect(alpha.baselineDeliveryRate).toBe(1);
		expect(alpha.recentDeliveryRate).toBe(0);
		expect(alpha.delta).toBe(-1);
		expect(out.regressingProjects).toEqual(["alpha"]);
		expect(out.newlyBrokenProjects).toEqual(["alpha"]);
		expect(alpha.summary).toContain("NEWLY BROKEN");
	});

	it("classifies a recovering scenario as improving (baseline mostly failed, recent all deliver)", () => {
		const reports = [run("beta", 1, false), run("beta", 2, false), run("beta", 3, true), run("beta", 4, true)];
		const beta = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(beta.direction).toBe("improving");
		expect(beta.newlyBroken).toBe(false);
		expect(beta.delta).toBe(1);
		expect(beta.summary).toContain("improving");
	});

	it("classifies steady delivery as stable (delta within epsilon)", () => {
		const reports = [run("gamma", 1, true), run("gamma", 2, true), run("gamma", 3, true), run("gamma", 4, true)];
		const gamma = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(gamma.direction).toBe("stable");
		expect(gamma.delta).toBe(0);
		expect(gamma.baselineDeliveryRate).toBe(1);
		expect(gamma.recentDeliveryRate).toBe(1);
	});

	it("returns insufficient_data when a scenario has fewer than 2*minWindowRuns runs", () => {
		// minWindowRuns default 2 → need 4 runs; give 3.
		const reports = [run("delta", 1, true), run("delta", 2, false), run("delta", 3, true)];
		const delta = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(delta.direction).toBe("insufficient_data");
		expect(delta.totalRuns).toBe(3);
		expect(delta.baselineRuns).toBe(0);
		expect(delta.recentRuns).toBe(0);
		expect(delta.delta).toBe(0);
	});

	it("respects a custom minWindowRuns of 1 (2 runs suffice to judge a trend)", () => {
		const reports = [run("eps", 1, true), run("eps", 2, false)];
		const eps = classifyRailDeliveryTrend({ reports, minWindowRuns: 1 }).byProject[0];
		expect(eps.direction).toBe("regressing");
		expect(eps.baselineRuns).toBe(1);
		expect(eps.recentRuns).toBe(1);
		expect(eps.newlyBroken).toBe(true);
	});

	it("orders runs by `at` regardless of report input order (chronology, not arrival order)", () => {
		// Feed the runs newest-first; the split must still put days 1-2 in baseline and 3-4 in recent.
		const reports = [run("zeta", 4, false), run("zeta", 3, false), run("zeta", 2, true), run("zeta", 1, true)];
		const zeta = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(zeta.direction).toBe("regressing");
		expect(zeta.baselineDeliveryRate).toBe(1);
		expect(zeta.recentDeliveryRate).toBe(0);
		expect(zeta.firstRunAt).toBe("2026-07-01T00:00:00.000Z");
		expect(zeta.lastRunAt).toBe("2026-07-04T00:00:00.000Z");
	});

	it("treats non-delivered verdicts (failed_to_start / non_terminal / failed) uniformly as non-deliveries", () => {
		const reports = [
			report("2026-07-01T00:00:00.000Z", [lane("mix", "delivered")]),
			report("2026-07-02T00:00:00.000Z", [lane("mix", "delivered")]),
			report("2026-07-03T00:00:00.000Z", [lane("mix", "failed_to_start")]),
			report("2026-07-04T00:00:00.000Z", [lane("mix", "non_terminal")]),
		];
		const mix = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(mix.direction).toBe("regressing");
		expect(mix.recentDeliveryRate).toBe(0);
		expect(mix.newlyBroken).toBe(true);
	});

	it("gates regressing vs stable on regressEpsilon (a small drop below the threshold stays stable)", () => {
		// baseline 4 runs all delivered (1.0); recent 2 runs: one delivered → 0.5. delta = -0.5.
		const base = [run("th", 1, true), run("th", 2, true), run("th", 3, true), run("th", 4, true)];
		const recent = [run("th", 5, true), run("th", 6, false)];
		const reports = [...base, ...recent];
		// Default epsilon 0.2 → -0.5 <= -0.2 → regressing.
		expect(directionOf({ reports }, "th")).toBe("regressing");
		// Raise regressEpsilon above the drop → stable.
		expect(directionOf({ reports, regressEpsilon: 0.6 }, "th")).toBe("stable");
	});

	it("newlyBroken requires a POSITIVE baseline — an always-failing scenario is regressing but not newly broken", () => {
		const reports = [run("nb", 1, false), run("nb", 2, false), run("nb", 3, false), run("nb", 4, false)];
		const nb = classifyRailDeliveryTrend({ reports }).byProject[0];
		// baseline 0.0, recent 0.0, delta 0 → not regressing (no drop) and never newlyBroken.
		expect(nb.direction).toBe("stable");
		expect(nb.newlyBroken).toBe(false);
		expect(nb.baselineDeliveryRate).toBe(0);
	});

	it("clamps out-of-range / non-finite tuning knobs to safe defaults", () => {
		const reports = [run("cl", 1, true), run("cl", 2, true), run("cl", 3, false), run("cl", 4, false)];
		// minWindowRuns 0 → clamped to 1 (so 2-per-window not required; 4 runs → windows of 1 each after clamp? No —
		// clamp is to 1, so need 2 total; here regressing holds). Negative epsilons → clamped to 0 (any drop regresses).
		const out = classifyRailDeliveryTrend({
			reports,
			minWindowRuns: 0,
			regressEpsilon: -5,
			improveEpsilon: Number.NaN,
		});
		expect(out.byProject[0].direction).toBe("regressing");
	});

	it("handles multiple scenarios and sorts most-concerning-first (newlyBroken → regressing-by-drop → stable → improving)", () => {
		const reports = [
			// steady: stable
			run("steady", 1, true),
			run("steady", 2, true),
			run("steady", 3, true),
			run("steady", 4, true),
			// recovering: improving
			run("recover", 1, false),
			run("recover", 2, false),
			run("recover", 3, true),
			run("recover", 4, true),
			// newly broken: regressing + newlyBroken (should lead)
			run("broke", 1, true),
			run("broke", 2, true),
			run("broke", 3, false),
			run("broke", 4, false),
			// partial slide: regressing but not newlyBroken (recent still delivers once)
			run("slide", 1, true),
			run("slide", 2, true),
			run("slide", 3, true),
			run("slide", 4, true),
			run("slide", 5, false),
			run("slide", 6, true),
		];
		const out = classifyRailDeliveryTrend({ reports });
		const order = out.byProject.map((t) => t.project);
		// newlyBroken first, then the other regressor, then stable, then improving.
		expect(order[0]).toBe("broke");
		expect(order[1]).toBe("slide");
		expect(order.indexOf("steady")).toBeLessThan(order.indexOf("recover"));
		expect(out.newlyBrokenProjects).toEqual(["broke"]);
		expect(out.regressingProjects).toEqual(["broke", "slide"]);
	});

	it("orders two regressors by the larger delivery DROP first", () => {
		const reports = [
			// small drop: 1.0 -> 0.5 (delta -0.5)
			run("small", 1, true),
			run("small", 2, true),
			run("small", 3, true),
			run("small", 4, false),
			// big drop: 1.0 -> 0.0 (delta -1.0) — should sort before small
			run("big", 1, true),
			run("big", 2, true),
			run("big", 3, false),
			run("big", 4, false),
		];
		const order = classifyRailDeliveryTrend({ reports }).byProject.map((t) => t.project);
		expect(order).toEqual(["big", "small"]);
	});

	it("degrades gracefully on unparseable timestamps — undated runs sort AFTER dated ones, no throw", () => {
		const reports = [
			run("mixdate", 1, true),
			run("mixdate", 2, true),
			report("not-a-date", [lane("mixdate", "failed")]),
			report("also bogus", [lane("mixdate", "failed")]),
		];
		const md = classifyRailDeliveryTrend({ reports }).byProject[0];
		// Dated deliveries (days 1-2) become baseline; the two undated failures sort last → recent → regressing.
		expect(md.direction).toBe("regressing");
		expect(md.baselineDeliveryRate).toBe(1);
		expect(md.recentDeliveryRate).toBe(0);
		// firstRunAt/lastRunAt only ever reference PARSEABLE runs.
		expect(md.firstRunAt).toBe("2026-07-01T00:00:00.000Z");
		expect(md.lastRunAt).toBe("2026-07-02T00:00:00.000Z");
	});

	it("reports null firstRunAt/lastRunAt when a scenario has no parseable timestamps at all", () => {
		// Every `at` here is genuinely unparseable by Date.parse (verified NaN — unlike e.g. "bad-1", which V8 reads as a year).
		const reports = [
			report("not a date", [lane("undated", "delivered")]),
			report("still not", [lane("undated", "delivered")]),
			report("nope nope", [lane("undated", "failed")]),
			report("also bogus", [lane("undated", "failed")]),
		];
		const undated = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(undated.firstRunAt).toBeNull();
		expect(undated.lastRunAt).toBeNull();
		// Ordering falls back to input sequence → days-of-input give baseline=deliver, recent=fail → regressing.
		expect(undated.direction).toBe("regressing");
	});

	it("handles empty input", () => {
		const out = classifyRailDeliveryTrend({ reports: [] });
		expect(out.totalReports).toBe(0);
		expect(out.totalRuns).toBe(0);
		expect(out.byProject).toEqual([]);
		expect(out.regressingProjects).toEqual([]);
		expect(out.newlyBrokenProjects).toEqual([]);
	});

	it("counts totalRuns as one per lane occurrence across all reports", () => {
		const reports = [
			report("2026-07-01T00:00:00.000Z", [lane("a", "delivered"), lane("b", "failed")]),
			report("2026-07-02T00:00:00.000Z", [lane("a", "delivered")]),
		];
		const out = classifyRailDeliveryTrend({ reports });
		expect(out.totalRuns).toBe(3);
		expect(out.totalReports).toBe(2);
	});

	it("is DETERMINISTIC — same inputs yield deeply-equal output across repeated calls", () => {
		const reports = [
			run("p1", 1, true),
			run("p1", 2, false),
			run("p1", 3, false),
			run("p1", 4, true),
			run("p2", 1, false),
			run("p2", 2, false),
			run("p2", 3, true),
			run("p2", 4, true),
		];
		const a = classifyRailDeliveryTrend({ reports });
		const b = classifyRailDeliveryTrend({ reports });
		expect(a).toEqual(b);
	});

	it("does NOT MUTATE the injected reports/lanes array", () => {
		const reports = [run("m", 4, false), run("m", 3, false), run("m", 1, true), run("m", 2, true)];
		const snapshot = JSON.parse(JSON.stringify(reports));
		const orderBefore = reports.map((r) => r.at);
		classifyRailDeliveryTrend({ reports });
		expect(reports.map((r) => r.at)).toEqual(orderBefore);
		expect(JSON.parse(JSON.stringify(reports))).toEqual(snapshot);
	});

	it("splits baseline/recent correctly when the recent window is a strict suffix (5 runs, minWindowRuns 2)", () => {
		// 5 runs → recent = last 2, baseline = first 3.
		const reports = [
			run("s5", 1, true),
			run("s5", 2, true),
			run("s5", 3, true),
			run("s5", 4, false),
			run("s5", 5, false),
		];
		const s5 = classifyRailDeliveryTrend({ reports }).byProject[0];
		expect(s5.baselineRuns).toBe(3);
		expect(s5.recentRuns).toBe(2);
		expect(s5.baselineDeliveryRate).toBe(1);
		expect(s5.recentDeliveryRate).toBe(0);
		expect(s5.direction).toBe("regressing");
	});
});
