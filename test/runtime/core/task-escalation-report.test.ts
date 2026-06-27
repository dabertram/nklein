import { describe, expect, it } from "vitest";
import {
	type AgentAttemptEvent,
	type BuildAttemptEventInput,
	buildAttemptEvent,
	buildTaskEscalationReport,
} from "../../../src/core/agent-attempt-ledger";

function attempt(taskId: string, over: Partial<BuildAttemptEventInput>): AgentAttemptEvent {
	return buildAttemptEvent({
		workflowId: "wf",
		taskId,
		workspacePathHash: "hash",
		attemptId: over.attemptId ?? "a",
		modelId: over.modelId ?? "m1",
		outcome: over.outcome ?? "other_failure",
		...over,
	});
}

describe("buildTaskEscalationReport", () => {
	it("builds the chronological attempt chain with approach labels + a rollup", () => {
		const events = [
			attempt("t1", { attemptId: "a1", modelId: "m1", outcome: "no_tool_call", retriesBefore: 0, recordedAt: 100 }),
			attempt("t1", {
				attemptId: "a2",
				modelId: "m1",
				outcome: "malformed",
				retriesBefore: 1,
				recordedAt: 200,
				promptStrategy: "constrained_schema",
			}),
			attempt("t1", {
				attemptId: "a3",
				modelId: "m2",
				outcome: "success",
				retriesBefore: 2,
				recordedAt: 300,
				endpointStrategy: "native",
				simplificationLevel: 2,
				qualityScore: 0.9,
			}),
			attempt("other-task", { attemptId: "b1", modelId: "m1", outcome: "success", recordedAt: 150 }),
		];
		const report = buildTaskEscalationReport(events, "t1");
		expect(report.totalAttempts).toBe(3); // the other-task attempt is excluded
		expect(report.modelsTried).toEqual(["m1", "m2"]); // distinct, first-seen order
		expect(report.finalOutcome).toBe("success");
		expect(report.attempts.map((row) => row.rung)).toEqual([0, 1, 2]);
		expect(report.attempts[0]?.approach).toBe("default");
		expect(report.attempts[1]?.approach).toBe("prompt:constrained_schema");
		expect(report.attempts[2]?.approach).toBe("endpoint:native simplify:2");
		expect(report.attempts[2]?.qualityScore).toBe(0.9);
	});

	it("returns an empty report for a task with no attempts", () => {
		expect(buildTaskEscalationReport([], "nope")).toEqual({
			taskId: "nope",
			totalAttempts: 0,
			modelsTried: [],
			finalOutcome: null,
			attempts: [],
		});
	});

	it("sorts by recordedAt even when events arrive out of order", () => {
		const events = [
			attempt("t1", { attemptId: "a2", recordedAt: 200, retriesBefore: 1 }),
			attempt("t1", { attemptId: "a1", recordedAt: 100, retriesBefore: 0 }),
		];
		expect(buildTaskEscalationReport(events, "t1").attempts.map((row) => row.rung)).toEqual([0, 1]);
	});
});
