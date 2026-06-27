import { describe, expect, it } from "vitest";
import type { TaskAttemptRow, TaskEscalationReport } from "../../../src/core/agent-attempt-ledger";
import { buildStuckTaskAnalysisRequest, MAX_RENDERED_ANALYSIS_ATTEMPTS } from "../../../src/core/stuck-task-analysis";

function row(rung: number, overrides: Partial<TaskAttemptRow> = {}): TaskAttemptRow {
	return {
		rung,
		modelId: "model-a",
		approach: "endpoint:e1",
		outcome: "other_failure",
		qualityScore: null,
		qualityOk: null,
		salvage: null,
		recordedAt: rung,
		...overrides,
	};
}

function report(overrides: Partial<TaskEscalationReport> = {}): TaskEscalationReport {
	return {
		taskId: "task-1",
		totalAttempts: 0,
		modelsTried: [],
		finalOutcome: null,
		attempts: [],
		...overrides,
	};
}

describe("buildStuckTaskAnalysisRequest", () => {
	it("titles the request with the task id", () => {
		expect(buildStuckTaskAnalysisRequest(report()).title).toBe("Analyze stuck task task-1");
	});

	it("produces a usable prompt even with no attempt history", () => {
		const { prompt } = buildStuckTaskAnalysisRequest(report());
		expect(prompt).toContain("no attempt history was recorded");
		expect(prompt).toContain("Do NOT write the final patch");
	});

	it("summarizes what was tried and asks for a remediation plan, not a patch", () => {
		const { prompt } = buildStuckTaskAnalysisRequest(
			report({
				totalAttempts: 2,
				modelsTried: ["model-a", "model-b"],
				finalOutcome: "loop",
				attempts: [
					row(1, { approach: "endpoint:e1", outcome: "other_failure" }),
					row(2, { modelId: "model-b", approach: "prompt:p2", outcome: "loop", salvage: null }),
				],
			}),
		);
		expect(prompt).toContain('HARD-STUCK on task "task-1"');
		expect(prompt).toContain("2 attempt(s) across 2 model(s) [model-a, model-b]");
		expect(prompt).toContain("final outcome: loop");
		expect(prompt).toContain("rung 1: model-a · endpoint:e1 → other_failure");
		expect(prompt).toContain("rung 2: model-b · prompt:p2 → loop");
		expect(prompt).toContain("REMEDIATION PLAN");
		expect(prompt).toContain("Root-cause read");
		expect(prompt).toContain("Do NOT write the final patch");
	});

	it("caps the rendered chain on long histories and notes how many were omitted", () => {
		const total = MAX_RENDERED_ANALYSIS_ATTEMPTS + 9;
		const attempts = Array.from({ length: total }, (_, index) => row(index + 1));
		const { prompt } = buildStuckTaskAnalysisRequest(
			report({ totalAttempts: total, modelsTried: ["model-a"], finalOutcome: "other_failure", attempts }),
		);
		expect(prompt).toContain(`most recent ${MAX_RENDERED_ANALYSIS_ATTEMPTS} of ${total}`);
		// The earliest rungs are dropped; the most recent are kept.
		expect(prompt).not.toContain("rung 1:");
		expect(prompt).toContain(`rung ${total}:`);
		const renderedRungs = prompt.split("\n").filter((line) => line.trimStart().startsWith("- rung "));
		expect(renderedRungs).toHaveLength(MAX_RENDERED_ANALYSIS_ATTEMPTS);
	});

	it("includes a quality score when present", () => {
		const { prompt } = buildStuckTaskAnalysisRequest(
			report({
				totalAttempts: 1,
				modelsTried: ["model-a"],
				finalOutcome: "other_failure",
				attempts: [row(1, { qualityScore: 0.42 })],
			}),
		);
		expect(prompt).toContain("q=0.42");
	});
});
