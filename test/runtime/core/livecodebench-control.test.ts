import { describe, expect, it } from "vitest";
import {
	assertLocalModelBaseUrl,
	buildLiveCodeBenchControlReport,
	PINNED_LIVECODEBENCH_COMMIT,
	planLiveCodeBenchControl,
} from "../../../src/core/livecodebench-control";

const hash = "a".repeat(64);

describe("LiveCodeBench capability control", () => {
	it("plans an offline official evaluation over a pinned post-cutoff window", () => {
		const plan = planLiveCodeBenchControl({
			pythonPath: "/bench/.venv/bin/python",
			harnessPath: "/bench/LiveCodeBench",
			runnerPath: "/repo/scripts/run-livecodebench-control.py",
			apiBaseUrl: "http://m5max.local:1234/v1",
			model: "qwen/qwen3.6-35b-a3b",
			modelCutoff: "2024-12-31",
			startDate: "2025-04-01",
			endDate: "2025-04-30",
			outputPath: "/evidence/m5max.json",
		});

		expect(plan).toMatchObject({
			harnessCommit: PINNED_LIVECODEBENCH_COMMIT,
			release: "release_v6",
			cutoffStatus: "post_cutoff",
			generation: { env: { HF_DATASETS_OFFLINE: "1", HF_HUB_OFFLINE: "1" } },
			evaluation: {
				metricsPath: "/evidence/m5max_codegeneration_output_eval.json",
				evalAllPath: "/evidence/m5max_codegeneration_output_eval_all.json",
			},
		});
		expect(plan.evaluation.args).toContain("lcb_runner.runner.custom_evaluator");
	});

	it("labels pre-cutoff windows as matched controls and rejects public endpoints", () => {
		const plan = planLiveCodeBenchControl({
			pythonPath: "/python",
			harnessPath: "/harness",
			runnerPath: "/runner.py",
			apiBaseUrl: "http://192.168.1.10:1234/v1",
			model: "local/model",
			modelCutoff: "2025-06-01",
			startDate: "2025-04-01",
			endDate: "2025-04-30",
			outputPath: "/evidence/control.json",
		});
		expect(plan.cutoffStatus).toBe("pre_or_at_cutoff");
		expect(plan.claim).toMatch(/Contamination-limited/);
		expect(() => assertLocalModelBaseUrl("https://api.openai.com/v1")).toThrow(/private LAN/);
	});

	it("normalizes official n=1 output only when aggregate and per-problem evidence agree", () => {
		const report = buildLiveCodeBenchControlReport({
			metrics: [{ "pass@1": 0.5 }],
			evalAll: [
				{ question_id: "a", graded_list: [true] },
				{ question_id: "b", graded_list: [false] },
			],
			model: "local/model",
			modelCutoff: "2024-12-31",
			startDate: "2025-04-01",
			endDate: "2025-04-30",
			generationSha256: hash,
			metricsSha256: hash,
			evalAllSha256: hash,
		});
		expect(report).toMatchObject({ totalProblems: 2, resolvedProblems: 1, passAt1: 0.5 });

		expect(() =>
			buildLiveCodeBenchControlReport({
				metrics: [{ "pass@1": 1 }],
				evalAll: [{ question_id: "a", graded_list: [false] }],
				model: "local/model",
				modelCutoff: "2024-12-31",
				startDate: "2025-04-01",
				endDate: "2025-04-30",
				generationSha256: hash,
				metricsSha256: hash,
				evalAllSha256: hash,
			}),
		).toThrow(/metrics mismatch/);
	});
});
