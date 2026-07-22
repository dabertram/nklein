import { describe, expect, it } from "vitest";
import type { AiderPolyglotManifest } from "../../../src/core/aider-polyglot-benchmark";
import {
	parseAiderCampaignConfig,
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
});
