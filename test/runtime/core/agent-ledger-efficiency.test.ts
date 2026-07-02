import { describe, expect, it } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { renderSwarmEfficiencyReport, summarizeSwarmEfficiency } from "../../../src/core/agent-ledger-efficiency";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

let seq = 0;
function attempt(input: {
	taskId: string;
	modelId: string;
	outcome: ModelOutcomeKind;
	wallMs?: number;
	contextTokens?: number;
	retriesBefore?: number;
}) {
	seq += 1;
	const startedAt = 1_000_000 + seq * 10_000;
	return buildAttemptEvent({
		workflowId: `wf-${input.taskId}`,
		taskId: input.taskId,
		workspacePathHash: "hash",
		eventId: `evt-${seq}`,
		recordedAt: startedAt,
		attemptId: `att-${seq}`,
		modelId: input.modelId,
		outcome: input.outcome,
		startedAt,
		completedAt: startedAt + (input.wallMs ?? 1_000),
		contextTokens: input.contextTokens ?? 100,
		retriesBefore: input.retriesBefore ?? 0,
	});
}

describe("summarizeSwarmEfficiency (W1.4 — the waste scoreboard)", () => {
	it("rolls attempts up per model: successes, waste, delivered tasks, retry burden", () => {
		const events = [
			attempt({ taskId: "a", modelId: "coder", outcome: "success", wallMs: 5_000 }),
			attempt({ taskId: "b", modelId: "coder", outcome: "timeout", wallMs: 60_000 }),
			attempt({ taskId: "b", modelId: "coder", outcome: "success", wallMs: 8_000, retriesBefore: 1 }),
			attempt({ taskId: "c", modelId: "big", outcome: "success" }),
		];
		const summary = summarizeSwarmEfficiency(events);
		const coder = summary.models.find((row) => row.modelId === "coder");
		expect(coder).toMatchObject({
			attempts: 3,
			successes: 2,
			wastedAttempts: 1,
			deliveredTasks: 2,
			retriedAttempts: 1,
			wastedWallMs: 60_000,
		});
		expect(summary.totals.deliveredTasks).toBe(3);
		expect(summary.totals.wasteRatio).toBeCloseTo(1 / 4);
	});

	it("counts consecutive aborted pairs on the same task+model as re-truncation (the W1.1 smell)", () => {
		const events = [
			attempt({ taskId: "t", modelId: "reasoner", outcome: "aborted" }),
			attempt({ taskId: "t", modelId: "reasoner", outcome: "aborted" }),
			attempt({ taskId: "t", modelId: "reasoner", outcome: "aborted" }),
			// a different task's single abort is NOT a pair
			attempt({ taskId: "u", modelId: "reasoner", outcome: "aborted" }),
		];
		const summary = summarizeSwarmEfficiency(events);
		expect(summary.models[0]?.reTruncationPairs).toBe(2); // 3 consecutive = 2 pairs
		expect(summary.totals.reTruncationPairs).toBe(2);
	});

	it("ignores non-attempt events and handles an empty ledger", () => {
		expect(summarizeSwarmEfficiency([]).totals).toMatchObject({ attempts: 0, wasteRatio: 0 });
	});

	it("renders a fixed-width report with totals", () => {
		const report = renderSwarmEfficiencyReport(
			summarizeSwarmEfficiency([attempt({ taskId: "a", modelId: "coder", outcome: "success" })]),
		);
		expect(report).toContain("Swarm efficiency scoreboard");
		expect(report).toContain("coder");
		expect(report).toContain("TOTAL: 1 attempts · 1 delivered tasks");
	});
});
