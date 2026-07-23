import { describe, expect, it } from "vitest";
import { buildFreshBenchmarkTrack } from "../../../src/core/fresh-benchmark-track";
import { parseSwebenchDataset } from "../../../src/core/swebench-benchmark";

function instance(
	id: string,
	createdAt: string | null,
	source: "swebench_legacy" | "swebench_live" | "swe_rebench" = "swebench_live",
) {
	return parseSwebenchDataset(
		JSON.stringify([
			{
				instance_id: id,
				repo: "owner/repo",
				base_commit: "0123456789abcdef",
				problem_statement: "Repair the behavior.",
				FAIL_TO_PASS: [],
				PASS_TO_PASS: [],
				created_at: createdAt,
			},
		]),
		source,
	)[0];
}

describe("fresh benchmark track", () => {
	it("uses the latest model cutoff and excludes pre-cutoff, undated, and leaked tasks", () => {
		const result = buildFreshBenchmarkTrack({
			instances: [
				instance("fresh", "2026-06-01", "swe_rebench"),
				instance("leaked", "2026-07-01"),
				instance("old", "2025-01-01"),
				instance("undated", null),
			],
			freshAfter: "2025-01-01",
			modelCutoffs: { small: "2025-06-01", frontier: "2026-01-01" },
			leakageHits: [{ instanceId: "leaked", kind: "path_recall", evidence: "Model named the private path." }],
		});

		expect(result.cutoff).toBe("2026-01-01T00:00:00.000Z");
		expect(result.instanceIds).toEqual(["fresh"]);
		expect(result.sources).toEqual(["swe_rebench"]);
		expect(result.exclusions.map(({ instanceId, reason }) => [instanceId, reason])).toEqual([
			["leaked", "leakage_hit"],
			["old", "pre_cutoff"],
			["undated", "missing_created_at"],
		]);
	});

	it("refuses stale benchmark sources and ungrounded leakage records", () => {
		expect(() =>
			buildFreshBenchmarkTrack({
				instances: [instance("legacy", "2026-06-01", "swebench_legacy")],
				freshAfter: "2026-01-01",
			}),
		).toThrow(/cannot claim source swebench_legacy/);
		const fresh = instance("fresh", "2026-06-01");
		expect(() =>
			buildFreshBenchmarkTrack({
				instances: [fresh],
				freshAfter: "2026-01-01",
				leakageHits: [{ instanceId: "missing", kind: "known_memorization", evidence: "Observed." }],
			}),
		).toThrow(/unknown instance/);
	});

	it("requires a cutoff and applies a deterministic cap", () => {
		const instances = [instance("b", "2026-02-01"), instance("a", "2026-02-01")];
		expect(() => buildFreshBenchmarkTrack({ instances })).toThrow(/requires/);
		const result = buildFreshBenchmarkTrack({ instances, freshAfter: "2026-01-01", limit: 1 });
		expect(result.instanceIds).toEqual(["a"]);
		expect(result.exclusions).toContainEqual({
			instanceId: "b",
			reason: "selection_limit",
			detail: "Outside deterministic selection limit (not scored).",
		});
	});
});
