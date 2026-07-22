import { describe, expect, it } from "vitest";
import {
	assertCandidateCalibration,
	buildLeakageSafeBenchmarkTask,
	buildSwebenchPrediction,
	calibrateGoldAttempts,
	evaluateResolvedSetRegression,
	normalizeSwebenchDifficulty,
	parseOfficialSwebenchRunReport,
	parseSwebenchDataset,
	planOfficialSwebenchEvaluation,
	planOfficialSwebenchLiveEvaluation,
	selectSwebenchInstances,
	serializeSwebenchLivePredictions,
	serializeSwebenchPredictions,
} from "../../../src/core/swebench-benchmark";

const row = {
	instance_id: "owner__repo-1",
	repo: "owner/repo",
	base_commit: "0123456789abcdef",
	problem_statement: "Fix the frobnicator without changing public behavior.",
	patch: "diff --git a/src/frob.py b/src/frob.py\n+THE GOLD ANSWER IS PRIVATE",
	test_patch: "diff --git a/tests/test_frob.py b/tests/test_frob.py\n+assert fixed",
	hints_text: "The answer is in src/frob.py line 4.",
	FAIL_TO_PASS: '["tests/test_frob.py::test_fix"]',
	PASS_TO_PASS: ["tests/test_frob.py::test_existing"],
	difficulty: "<15 min fix",
	created_at: "2026-06-01T00:00:00Z",
};

describe("SWE-bench compatibility adapter", () => {
	it("parses JSON/JSONL with the official schema and rejects duplicate ids", () => {
		const parsed = parseSwebenchDataset(`${JSON.stringify(row)}\n`, "swebench_live");
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({
			instanceId: row.instance_id,
			difficulty: "under_15m",
			source: "swebench_live",
			failToPass: ["tests/test_frob.py::test_fix"],
		});
		expect(() => parseSwebenchDataset(JSON.stringify([row, row]))).toThrow(/Duplicate/);
	});

	it("builds a prompt object that structurally cannot expose gold, hints, tests or oracle ids", () => {
		const instance = parseSwebenchDataset(JSON.stringify([row]))[0];
		const task = buildLeakageSafeBenchmarkTask(instance);
		expect(task.prompt).toBe(row.problem_statement);
		expect(JSON.stringify(task)).not.toContain("GOLD ANSWER");
		expect(JSON.stringify(task)).not.toContain("assert fixed");
		expect(JSON.stringify(task)).not.toContain("test_existing");
		expect(Object.keys(task)).not.toContain("hintsText");
	});

	it("quarantines a source row whose public problem literally contains a withheld answer", () => {
		const duplicated = { ...row, problem_statement: row.hints_text };
		const instance = parseSwebenchDataset(JSON.stringify([duplicated]))[0];
		expect(() => buildLeakageSafeBenchmarkTask(instance)).toThrow(/duplicates withheld hints/);
	});

	it("selects deterministically by difficulty, fresh window and pinned ids", () => {
		const later = { ...row, instance_id: "owner__repo-2", difficulty: "1–4hr", created_at: "2026-07-01" };
		const instances = parseSwebenchDataset(JSON.stringify([later, row]), "swebench_live");
		expect(selectSwebenchInstances(instances, { freshAfter: "2026-06-15", difficulties: ["1h_to_4h"] })).toHaveLength(
			1,
		);
		expect(() => selectSwebenchInstances(instances, { instanceIds: ["missing"] })).toThrow(/unavailable/);
		expect(normalizeSwebenchDifficulty("15min–1hr")).toBe("15m_to_1h");
	});

	it("serializes delivered diffs in the official prediction schema", () => {
		const prediction = buildSwebenchPrediction({
			instanceId: row.instance_id,
			modelNameOrPath: "nklein/qwen",
			modelPatch: "diff --git a/a b/a\n-old\n+new",
		});
		expect(JSON.parse(serializeSwebenchPredictions([prediction]).trim())).toEqual(prediction);
		expect(() => serializeSwebenchPredictions([prediction, prediction])).toThrow(/Duplicate prediction/);
		expect(JSON.parse(serializeSwebenchLivePredictions([prediction]))).toEqual({
			[row.instance_id]: { model_patch: prediction.model_patch, model_name_or_path: "nklein/qwen" },
		});
		expect(
			buildSwebenchPrediction({ instanceId: row.instance_id, modelNameOrPath: "nklein/no-op", modelPatch: "" }),
		).toMatchObject({ model_patch: "" });
	});

	it("plans the distinct pinned Live evaluator and labels its x86-only image boundary", () => {
		const plan = planOfficialSwebenchLiveEvaluation({
			pythonPath: "/bench/bin/python",
			harnessPath: "/bench/live",
			datasetPath: "/private/live.jsonl",
			predictionsPath: "gold",
			instanceIds: [row.instance_id],
			reportDir: "/reports/live-1",
			hostArchitecture: "arm64",
			dockerArchitecture: "aarch64",
		});
		expect(plan.harness).toBe("swebench_live");
		expect(plan.cwd).toBe("/bench/live");
		expect(plan.args).toContain("evaluation.evaluation");
		expect(plan.args).toContain("/private/live.jsonl");
		expect(plan.nativeArchitecture).toBe(false);
		expect(plan.warnings[0]).toMatch(/x86_64.*QEMU/);
		expect(
			planOfficialSwebenchLiveEvaluation({
				...{
					pythonPath: "/bench/bin/python",
					harnessPath: "/bench/live",
					datasetPath: "/private/live.jsonl",
					predictionsPath: "gold" as const,
					instanceIds: [row.instance_id],
					reportDir: "/reports/live-1",
				},
				hostArchitecture: "x64",
				dockerArchitecture: "x86_64",
			}).nativeArchitecture,
		).toBe(true);
	});

	it("plans the pinned official grader and forces native local builds on Apple Silicon", () => {
		const plan = planOfficialSwebenchEvaluation({
			pythonPath: "/bench/bin/python",
			datasetName: "SWE-bench/SWE-bench_Live",
			split: "lite",
			predictionsPath: "/run/preds.jsonl",
			runId: "nklein-20260722",
			instanceIds: [row.instance_id],
			reportDir: "/run/reports",
			hostArchitecture: "arm64",
			dockerArchitecture: "aarch64",
		});
		expect(plan.command).toBe("/bench/bin/python");
		expect(plan.args).toContain("swebench.harness.run_evaluation");
		expect(plan.args).toContain("lite");
		expect(plan.args.slice(-2)).toEqual(["--namespace", ""]);
		expect(plan.nativeArchitecture).toBe(true);
		expect(plan.warnings).toEqual([]);
	});

	it("labels QEMU-tainted plans and refuses resource-destabilizing worker counts", () => {
		const base = {
			pythonPath: "python",
			datasetName: "dataset",
			predictionsPath: "gold" as const,
			runId: "gold-1",
			instanceIds: [row.instance_id],
			reportDir: "reports",
			hostArchitecture: "arm64",
			dockerArchitecture: "x86_64",
		};
		expect(planOfficialSwebenchEvaluation(base).warnings[0]).toMatch(/QEMU/);
		expect(() => planOfficialSwebenchEvaluation({ ...base, maxWorkers: 12 })).toThrow(/between 1 and 4/);
	});

	it("quarantines gold failures, flip-flops, errors and under-repeated instances", () => {
		const calibration = calibrateGoldAttempts(
			["stable", "flip", "error", "missing"],
			[
				{ instanceId: "stable", repeat: 1, status: "resolved" },
				{ instanceId: "stable", repeat: 2, status: "resolved" },
				{ instanceId: "flip", repeat: 1, status: "resolved" },
				{ instanceId: "flip", repeat: 2, status: "unresolved" },
				{ instanceId: "error", repeat: 1, status: "resolved" },
				{ instanceId: "error", repeat: 2, status: "error" },
			],
		);
		expect(calibration.stableInstanceIds).toEqual(["stable"]);
		expect(Object.keys(calibration.quarantined).sort()).toEqual(["error", "flip", "missing"]);
		expect(() => calibrateGoldAttempts(["bad"], [{ instanceId: "bad", repeat: 0, status: "resolved" }])).toThrow(
			/invalid repeat/,
		);
	});

	it("makes gold calibration mandatory for every candidate instance", () => {
		expect(() => assertCandidateCalibration(["a"], { stableInstanceIds: ["a"] })).not.toThrow();
		expect(() => assertCandidateCalibration(["a", "b"], { stableInstanceIds: ["a"] })).toThrow(/uncalibrated.*b/);
	});

	it("maps official schema-v2 reports without hand-rolling test-log parsing", () => {
		expect(
			parseOfficialSwebenchRunReport({
				schema_version: 2,
				submitted_ids: ["a", "b", "c", "d"],
				resolved_ids: ["a"],
				unresolved_ids: ["b"],
				error_ids: ["c"],
				incomplete_ids: [],
				empty_patch_ids: [],
			}),
		).toEqual({ a: "resolved", b: "unresolved", c: "error", d: "error" });
		expect(
			parseOfficialSwebenchRunReport({
				schema_version: 2,
				submitted_ids: ["empty"],
				empty_patch_ids: ["empty"],
			}),
		).toEqual({ empty: "unresolved" });
		expect(
			parseOfficialSwebenchRunReport({
				submitted_ids: ["pass", "fail", "empty", "broken"],
				success_ids: ["pass"],
				failure_ids: ["fail"],
				empty_patch_ids: ["empty"],
				error_ids: ["broken"],
				incomplete_ids: [],
			}),
		).toEqual({ pass: "resolved", fail: "unresolved", empty: "unresolved", broken: "error" });
		expect(() =>
			parseOfficialSwebenchRunReport({
				schema_version: 2,
				resolved_ids: ["a"],
				unresolved_ids: ["a"],
			}),
		).toThrow(/more than once/);
	});

	it("fails only resolved-to-unresolved deltas and keeps infrastructure absence inconclusive", () => {
		expect(
			evaluateResolvedSetRegression({
				baseline: { a: "resolved", b: "resolved", c: "unresolved", flaky: "resolved" },
				current: { a: "resolved", b: "unresolved", c: "resolved" },
				quarantinedInstanceIds: ["flaky"],
			}),
		).toEqual({ verdict: "regression", regressedInstanceIds: ["b"], inconclusiveInstanceIds: [] });
		expect(evaluateResolvedSetRegression({ baseline: { a: "resolved" }, current: {} }).verdict).toBe("inconclusive");
		expect(() =>
			evaluateResolvedSetRegression({
				baseline: { a: "resolved" },
				current: { a: "forged" as "resolved" },
			}),
		).toThrow(/current status.*invalid/);
	});
});
