import { describe, expect, it } from "vitest";
import type { AiderPolyglotManifest } from "../../../src/core/aider-polyglot-benchmark";
import {
	assertAiderCampaignCodeIdentity,
	assertAiderCampaignHarnessCommit,
	buildAiderRegressionSnapshot,
	evaluateAiderRegressionGate,
	parseAiderCampaignConfig,
	parseAiderCampaignHarnessBaseline,
	parseAiderRegressionSnapshot,
	planAiderCampaign,
	summarizeAiderCampaign,
} from "../../../src/core/aider-polyglot-campaign";

const manifest: AiderPolyglotManifest = {
	schemaVersion: 1,
	corpusCommit: "a".repeat(40),
	tasks: Array.from({ length: 24 }, (_, index) => ({
		schemaVersion: 1 as const,
		source: "aider_polyglot" as const,
		instanceId: `aider-python-task-${index}`,
		corpusCommit: "a".repeat(40),
		language: "python" as const,
		exercise: `task-${index}`,
		prompt: `Solve task ${index}.`,
		solutionFiles: ["answer.py"],
	})),
};

function rawConfig(declaredMdePoints = 30) {
	return {
		schemaVersion: 1,
		campaignId: "daily-2026-07-22",
		repeats: 2,
		declaredMdePoints,
		assignments: manifest.tasks.map((task, index) => ({
			instanceId: task.instanceId,
			modelId: index < 8 ? "model-a" : index < 16 ? "model-b" : "model-c",
			modelNameOrPath: "fixed-fleet",
		})),
	};
}

describe("Aider paired campaign", () => {
	it("pins a full clean harness commit and rejects cross-commit resume", () => {
		const runtimeBuildIdentity = {
			schemaVersion: 1 as const,
			gitCommit: "a".repeat(40),
			gitDirty: false,
			capturedAt: "2026-07-23T00:00:00.000Z",
		};
		const baseline = parseAiderCampaignHarnessBaseline({
			schemaVersion: 1,
			runnerGitCommit: "a".repeat(40),
			runtimeBuildIdentity,
			runner: "scripts/run-aider-campaign.mts",
			createdAt: "2026-07-23T00:00:00.000Z",
		});
		expect(() => assertAiderCampaignHarnessCommit(baseline, "a".repeat(40), runtimeBuildIdentity)).not.toThrow();
		expect(() =>
			assertAiderCampaignCodeIdentity("a".repeat(40), { ...runtimeBuildIdentity, gitDirty: true }),
		).toThrow(/dirty worktree/);
		expect(() => assertAiderCampaignCodeIdentity("b".repeat(40), runtimeBuildIdentity)).toThrow(
			/differs from runner commit/,
		);
		expect(() =>
			assertAiderCampaignHarnessCommit(baseline, "a".repeat(40), {
				...runtimeBuildIdentity,
				capturedAt: "2026-07-23T01:00:00.000Z",
			}),
		).toThrow(/Runtime process identity changed/);
	});

	it("pre-registers a powered fixed assignment and alternates pair order", () => {
		const config = parseAiderCampaignConfig(rawConfig(), manifest);
		const attempts = planAiderCampaign(config);
		expect(attempts).toHaveLength(96);
		expect(attempts.slice(0, 4).map((attempt) => attempt.arm)).toEqual(["plan", "no_plan", "no_plan", "plan"]);
		expect(attempts[0]?.modelId).toBe(attempts[1]?.modelId);
		expect(attempts[48]?.arm).toBe("no_plan");
	});

	it("rejects an underpowered promise before candidate execution", () => {
		expect(() => parseAiderCampaignConfig(rawConfig(10), manifest)).toThrow(/UNDERPOWERED BY CONSTRUCTION/);
	});

	it("excludes infrastructure-tainted pairs and delegates the no-flip decision", () => {
		const config = parseAiderCampaignConfig(rawConfig(), manifest);
		const attempts = planAiderCampaign(config);
		const results = attempts.slice(0, 4).map((attempt, index) => ({
			...attempt,
			status: index === 2 ? ("error" as const) : index === 1 ? ("resolved" as const) : ("unresolved" as const),
			workflowOutcome: "completed",
			patchBytes: 10,
			durationMs: 100,
		}));
		const summary = summarizeAiderCampaign(config, results);
		expect(summary.pairedOutcomes).toBe(1);
		expect(summary.infrastructureErrors).toBe(1);
		expect(summary.decision.flip).toBe(false);
		expect(summary.decision.mcnemar.better).toBe(1);
	});

	it("quarantines mixed repeats and keeps missing or errored repeats infrastructure-inconclusive", () => {
		const config = parseAiderCampaignConfig(rawConfig(), manifest);
		const results = planAiderCampaign(config).map((attempt) => ({
			...attempt,
			status:
				attempt.instanceId === "aider-python-task-0" && attempt.arm === "plan" && attempt.repeat === 2
					? ("unresolved" as const)
					: attempt.instanceId === "aider-python-task-1" && attempt.arm === "plan"
						? ("error" as const)
						: ("resolved" as const),
			workflowOutcome: "completed",
			patchBytes: 10,
			durationMs: 100,
		}));
		const snapshot = parseAiderRegressionSnapshot(buildAiderRegressionSnapshot(config, results, "plan"));
		expect(snapshot.rows[0]?.status).toBe("quarantined");
		expect(snapshot.rows[1]?.status).toBe("infrastructure");
		expect(snapshot.rows[2]?.status).toBe("resolved");
		const forged = {
			...snapshot,
			rows: snapshot.rows.map((row, index) =>
				index === 2
					? {
							...row,
							attempts: [
								{ repeat: 1, status: "resolved" as const },
								{ repeat: 1, status: "resolved" as const },
							],
						}
					: row,
			),
		};
		expect(() => parseAiderRegressionSnapshot(forged)).toThrow(/does not match its repeat evidence/);
	});

	it("fails only stable resolved-to-unresolved regressions and leaves infrastructure absence inconclusive", () => {
		const config = parseAiderCampaignConfig(rawConfig(), manifest);
		const attempts = planAiderCampaign(config);
		const result = (statusFor: (attempt: (typeof attempts)[number]) => "resolved" | "unresolved" | "error") =>
			attempts.map((attempt) => ({
				...attempt,
				status: statusFor(attempt),
				workflowOutcome: "completed",
				patchBytes: 10,
				durationMs: 100,
			}));
		const baseline = buildAiderRegressionSnapshot(
			config,
			result(() => "resolved"),
			"plan",
		);
		const regressed = buildAiderRegressionSnapshot(
			config,
			result((attempt) =>
				attempt.instanceId === "aider-python-task-0" && attempt.arm === "plan" ? "unresolved" : "resolved",
			),
			"plan",
		);
		expect(evaluateAiderRegressionGate(baseline, regressed)).toMatchObject({
			outcome: "fail",
			regressions: ["aider-python-task-0"],
		});

		const unavailable = buildAiderRegressionSnapshot(
			config,
			result((attempt) =>
				attempt.instanceId === "aider-python-task-1" && attempt.arm === "plan" ? "error" : "resolved",
			),
			"plan",
		);
		expect(evaluateAiderRegressionGate(baseline, unavailable)).toMatchObject({
			outcome: "inconclusive",
			regressions: [],
			inconclusive: ["aider-python-task-1"],
		});
		expect(() => evaluateAiderRegressionGate(baseline, { ...unavailable, repeats: 3 })).toThrow(/same repeat count/);
	});
});
