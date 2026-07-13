import { describe, expect, it } from "vitest";
import {
	type AgentLedgerEvent,
	agentLedgerEventSchema,
	buildAttemptEvent,
	buildSchedulerEvent,
	buildTransitionEvent,
	latestRunState,
	selectAttempts,
	selectAttemptsForModel,
	selectEventsForWorkflow,
	summarizeKnowledgeDebtOutcomes,
	summarizeKnowledgeOutcomeByModel,
	summarizeModelContextUsage,
	summarizeModelOutcomes,
	summarizeModelSpeed,
	summarizeRedecomposeRoundOutcomes,
	summarizeToolUsageByModel,
} from "../../../src/core/agent-attempt-ledger";

const base = { workflowId: "wf-1", taskId: "t-1", workspacePathHash: "ws-hash" };

let attemptSeq = 0;
function attemptWithTools(
	modelId: string,
	calls: ReadonlyArray<{ name: string; outcome: string | null }>,
): AgentLedgerEvent {
	attemptSeq += 1;
	return buildAttemptEvent({
		...base,
		attemptId: `a-${attemptSeq}`,
		modelId,
		outcome: "success",
		toolCalls: calls.map((call) => ({ name: call.name, fingerprint: null, outcome: call.outcome })),
	});
}

describe("buildAttemptEvent", () => {
	it("fills unspecified fields with nulls/empties and validates through the schema", () => {
		const event = buildAttemptEvent({
			...base,
			attemptId: "a-1",
			modelId: "lmstudio:qwen3-8b:default",
			outcome: "success",
			eventId: "e-1",
			recordedAt: 100,
		});
		expect(event.kind).toBe("attempt");
		expect(event.parentAttemptId).toBeNull();
		expect(event.toolSetOffered).toEqual([]);
		expect(event.simplificationLevel).toBe(0);
		expect(event.retriesBefore).toBe(0);
		expect(event.artifacts).toBeNull();
		// The builder output must be a valid ledger event.
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
	});

	it("carries through the rich attempt fields (and deep-copies arrays)", () => {
		const toolCalls = [{ name: "read_files", fingerprint: "fp-1", outcome: "ok" }];
		const event = buildAttemptEvent({
			...base,
			attemptId: "a-2",
			modelId: "m",
			outcome: "loop",
			retriesBefore: 2,
			simplificationLevel: 1,
			toolSetOffered: ["read_files", "write_file"],
			toolCalls,
			salvage: "looped→salvaged",
			artifacts: { resultBranch: "nklein/tasks/x", patchRef: null, evidenceBundle: null },
		});
		expect(event.retriesBefore).toBe(2);
		expect(event.toolCalls).toEqual(toolCalls);
		expect(event.toolCalls).not.toBe(toolCalls); // copied, not aliased
		expect(event.artifacts?.resultBranch).toBe("nklein/tasks/x");
	});

	it("generates a unique eventId + recordedAt when not supplied", () => {
		const a = buildAttemptEvent({ ...base, attemptId: "a", modelId: "m", outcome: "success" });
		const b = buildAttemptEvent({ ...base, attemptId: "a", modelId: "m", outcome: "success" });
		expect(a.eventId).not.toBe(b.eventId);
		expect(typeof a.recordedAt).toBe("number");
	});
});

describe("buildTransitionEvent / buildSchedulerEvent", () => {
	it("builds a valid transition event", () => {
		const event = buildTransitionEvent({ ...base, from: "plan", to: "execute_step", reason: "plan held" });
		expect(event.kind).toBe("transition");
		expect(event.to).toBe("execute_step");
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
	});

	it("builds a valid scheduler event", () => {
		const event = buildSchedulerEvent({ ...base, event: "lease_acquired", leaseId: "L1", workerId: "w1" });
		expect(event.kind).toBe("scheduler");
		expect(event.event).toBe("lease_acquired");
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
	});
});

describe("projections", () => {
	function makeStream(): AgentLedgerEvent[] {
		return [
			buildSchedulerEvent({ ...base, event: "queued", eventId: "s1", recordedAt: 1 }),
			buildTransitionEvent({ ...base, from: null, to: "plan", eventId: "t1", recordedAt: 2 }),
			buildAttemptEvent({
				...base,
				attemptId: "a1",
				modelId: "model-A",
				outcome: "success",
				eventId: "e1",
				recordedAt: 3,
			}),
			buildAttemptEvent({
				...base,
				attemptId: "a2",
				modelId: "model-A",
				outcome: "loop",
				eventId: "e2",
				recordedAt: 4,
			}),
			buildAttemptEvent({
				...base,
				attemptId: "a3",
				modelId: "model-B",
				outcome: "success",
				eventId: "e3",
				recordedAt: 5,
			}),
			buildTransitionEvent({ ...base, from: "plan", to: "execute_step", eventId: "t2", recordedAt: 6 }),
		];
	}

	it("selectAttempts / selectAttemptsForModel filter to attempt events", () => {
		const events = makeStream();
		expect(selectAttempts(events).map((event) => event.attemptId)).toEqual(["a1", "a2", "a3"]);
		expect(selectAttemptsForModel(events, "model-A").map((event) => event.attemptId)).toEqual(["a1", "a2"]);
	});

	it("selectEventsForWorkflow returns every event of a workflow", () => {
		const events = [
			...makeStream(),
			buildAttemptEvent({
				...base,
				workflowId: "wf-2",
				attemptId: "z",
				modelId: "m",
				outcome: "success",
				recordedAt: 9,
			}),
		];
		expect(selectEventsForWorkflow(events, "wf-1")).toHaveLength(6);
		expect(selectEventsForWorkflow(events, "wf-2")).toHaveLength(1);
	});

	it("latestRunState returns the most-recent transition's target (by recordedAt), null when none", () => {
		expect(latestRunState(makeStream(), "wf-1")).toBe("execute_step");
		// Out-of-order recordedAt still picks the latest.
		const reordered = [
			buildTransitionEvent({ ...base, to: "done", eventId: "late", recordedAt: 50 }),
			buildTransitionEvent({ ...base, to: "review", eventId: "early", recordedAt: 40 }),
		];
		expect(latestRunState(reordered, "wf-1")).toBe("done");
		expect(latestRunState([buildSchedulerEvent({ ...base, event: "queued" })], "wf-1")).toBeNull();
	});

	it("summarizeModelOutcomes rolls up per-model outcome counts + success rate (sorted by samples desc)", () => {
		const rollups = summarizeModelOutcomes(makeStream());
		// model-A has 2 samples (1 success, 1 loop); model-B has 1 (success). Sorted: A (2) before B (1).
		expect(rollups.map((rollup) => rollup.modelId)).toEqual(["model-A", "model-B"]);
		const modelA = rollups[0];
		expect(modelA.samples).toBe(2);
		expect(modelA.successes).toBe(1);
		expect(modelA.successRate).toBe(0.5);
		expect(modelA.byOutcome.success).toBe(1);
		expect(modelA.byOutcome.loop).toBe(1);
		expect(rollups[1]).toMatchObject({ modelId: "model-B", samples: 1, successRate: 1 });
	});

	it("summarizeModelOutcomes is empty for a stream with no attempts", () => {
		expect(summarizeModelOutcomes([buildTransitionEvent({ ...base, to: "plan" })])).toEqual([]);
	});
});

describe("summarizeToolUsageByModel", () => {
	it("rolls up per-(model, tool) calls with success rate over completed calls only", () => {
		const rollups = summarizeToolUsageByModel([
			attemptWithTools("m1", [
				{ name: "read_files", outcome: "success" },
				{ name: "read_files", outcome: "error" },
				{ name: "run_command", outcome: "success" },
			]),
			attemptWithTools("m1", [{ name: "read_files", outcome: "success" }]),
			attemptWithTools("m2", [{ name: "read_files", outcome: "error" }]),
		]);

		const m1Read = rollups.find((row) => row.modelId === "m1" && row.toolName === "read_files");
		expect(m1Read).toMatchObject({ calls: 3, successes: 2, errors: 1, incomplete: 0 });
		expect(m1Read?.successRate).toBeCloseTo(2 / 3);
		const m2Read = rollups.find((row) => row.modelId === "m2" && row.toolName === "read_files");
		expect(m2Read).toMatchObject({ calls: 1, successes: 0, errors: 1, successRate: 0 });
	});

	it("counts a null-outcome call as incomplete and excludes it from the success rate", () => {
		const [row] = summarizeToolUsageByModel([
			attemptWithTools("m1", [
				{ name: "run_command", outcome: "success" },
				{ name: "run_command", outcome: null },
			]),
		]);
		expect(row).toMatchObject({ calls: 2, successes: 1, errors: 0, incomplete: 1 });
		expect(row?.successRate).toBe(1); // 1 success / 1 completed
	});

	it("sorts by calls desc then model then tool, and ignores attempts with no tool calls", () => {
		const rollups = summarizeToolUsageByModel([
			attemptWithTools("m1", []),
			attemptWithTools("m1", [
				{ name: "b_tool", outcome: "success" },
				{ name: "b_tool", outcome: "success" },
				{ name: "a_tool", outcome: "success" },
			]),
		]);
		expect(rollups.map((row) => row.toolName)).toEqual(["b_tool", "a_tool"]);
	});
});

describe("summarizeModelSpeed", () => {
	const speedAttempt = (modelId: string, ttftMs: number | null, tokensPerSec: number | null): AgentLedgerEvent => {
		attemptSeq += 1;
		return buildAttemptEvent({
			...base,
			attemptId: `s-${attemptSeq}`,
			modelId,
			outcome: "success",
			ttftMs,
			tokensPerSec,
		});
	};

	it("rolls up per-model avg + median ttft and tok/s over attempts that carried a datum", () => {
		const events = [
			speedAttempt("fast", 100, 40),
			speedAttempt("fast", 300, 60), // median ttft = lower-of-two = 100; avg = 200; tok/s median 40, avg 50
			speedAttempt("slow", 1000, 5),
		];
		const rows = summarizeModelSpeed(events);
		expect(rows.map((r) => r.modelId)).toEqual(["fast", "slow"]); // samples desc, then modelId
		const fast = rows.find((r) => r.modelId === "fast");
		expect(fast?.samples).toBe(2);
		expect(fast?.avgTtftMs).toBe(200);
		expect(fast?.medianTtftMs).toBe(100);
		expect(fast?.avgTokensPerSec).toBe(50);
		expect(fast?.medianTokensPerSec).toBe(40);
	});

	it("reports null (not 0) for a model with no timing samples, and ignores attempts with neither datum", () => {
		const events = [speedAttempt("m", null, null), speedAttempt("m", null, 12)];
		const rows = summarizeModelSpeed(events);
		// Only the second attempt carried a datum (tok/s); ttft has no samples → null.
		expect(rows).toHaveLength(1);
		expect(rows[0]?.samples).toBe(1);
		expect(rows[0]?.avgTtftMs).toBeNull();
		expect(rows[0]?.medianTtftMs).toBeNull();
		expect(rows[0]?.avgTokensPerSec).toBe(12);
	});

	it("returns an empty list when no attempts carry timing", () => {
		expect(summarizeModelSpeed([speedAttempt("m", null, null)])).toEqual([]);
	});

	it("counts DISTINCT datum-carrying attempts when metric coverage is split (regression: not max of the two lists)", () => {
		// A1 carried ttft only, A2 carried tok/s only → 2 distinct sampled attempts. The old `max(ttft.length, tps.length)`
		// = max(1, 1) = 1 undercounted the denominator (the §5.AB sample-volume signal).
		const events = [speedAttempt("m", 100, null), speedAttempt("m", null, 50)];
		const rows = summarizeModelSpeed(events);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.samples).toBe(2);
		expect(rows[0]?.avgTtftMs).toBe(100);
		expect(rows[0]?.avgTokensPerSec).toBe(50);
	});
});

describe("summarizeModelContextUsage", () => {
	const ctxAttempt = (
		modelId: string,
		contextTokens: number | null,
		contextBudgetTarget: number | null,
	): AgentLedgerEvent => {
		attemptSeq += 1;
		return buildAttemptEvent({
			...base,
			attemptId: `c-${attemptSeq}`,
			modelId,
			outcome: "success",
			contextTokens,
			contextBudgetTarget,
		});
	};

	it("rolls up per-model avg + max prompt tokens and counts over-budget attempts", () => {
		const rows = summarizeModelContextUsage([
			ctxAttempt("m", 1000, 4000),
			ctxAttempt("m", 5000, 4000), // over budget
			ctxAttempt("m", 3000, null), // no budget target → not over
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.samples).toBe(3);
		expect(rows[0]?.avgContextTokens).toBe(3000);
		expect(rows[0]?.maxContextTokens).toBe(5000);
		expect(rows[0]?.overBudget).toBe(1);
	});

	it("ignores attempts with no prompt-token count", () => {
		expect(summarizeModelContextUsage([ctxAttempt("m", null, 4000)])).toEqual([]);
	});
});

describe("summarizeKnowledgeOutcomeByModel (F1.1)", () => {
	const knowledgeAttempt = (
		attemptId: string,
		outcome: "success" | "timeout",
		retrievalCallCount: number,
		role = "worker",
	) =>
		buildAttemptEvent({
			...base,
			role,
			attemptId,
			modelId: "model-K",
			outcome,
			knowledge: {
				retrievalCallCount,
				localizationCallCount: 0,
				knowledgeErrorCount: 0,
				categoriesUsed: retrievalCallCount > 0 ? ["code_index"] : [],
				knowledgeDebtPresent: null,
			},
		});

	it("correlates knowledge consultation with delivery outcome and computes the lift", () => {
		const rows = summarizeKnowledgeOutcomeByModel([
			knowledgeAttempt("k1", "success", 2),
			knowledgeAttempt("k2", "success", 1),
			knowledgeAttempt("k3", "timeout", 3),
			knowledgeAttempt("k4", "success", 0),
			knowledgeAttempt("k5", "timeout", 0),
			knowledgeAttempt("k6", "timeout", 0),
			// An event WITHOUT a knowledge summary (pre-F1.1 line) must not be counted as "no knowledge".
			buildAttemptEvent({ ...base, attemptId: "old", modelId: "model-K", outcome: "success" }),
		]);
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row).toMatchObject({
			modelId: "model-K",
			attemptsWithKnowledge: 3,
			successesWithKnowledge: 2,
			attemptsWithoutKnowledge: 3,
			successesWithoutKnowledge: 1,
		});
		// with: 2/3 ≈ 0.667; without: 1/3 ≈ 0.333 → lift ≈ +0.333
		expect(row?.knowledgeLift ?? 0).toBeCloseTo(1 / 3, 5);
	});

	it("leaves the lift null until BOTH sides have evidence, and splits rows by role", () => {
		const rows = summarizeKnowledgeOutcomeByModel([
			knowledgeAttempt("k1", "success", 1, "worker"),
			knowledgeAttempt("k2", "success", 1, "reviewer"),
		]);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.knowledgeLift === null)).toBe(true);
		expect(rows.map((row) => row.role).sort()).toEqual(["reviewer", "worker"]);
	});
});

describe("summarizeKnowledgeDebtOutcomes / summarizeRedecomposeRoundOutcomes (F1.1)", () => {
	const debtAttempt = (attemptId: string, outcome: "success" | "timeout", debt: boolean | null, taskId = "task-x") =>
		buildAttemptEvent({
			...base,
			taskId,
			workflowId: taskId,
			attemptId,
			modelId: "model-D",
			outcome,
			knowledge: {
				retrievalCallCount: 0,
				localizationCallCount: 0,
				knowledgeErrorCount: 0,
				categoriesUsed: [],
				knowledgeDebtPresent: debt,
			},
		});

	it("correlates declared knowledge debt with delivery outcome; unknown debt contributes to neither side", () => {
		const summary = summarizeKnowledgeDebtOutcomes([
			debtAttempt("d1", "success", true),
			debtAttempt("d2", "timeout", true),
			debtAttempt("d3", "success", false),
			debtAttempt("d4", "success", false),
			debtAttempt("d5", "success", null),
		]);
		expect(summary).toMatchObject({
			attemptsWithDebt: 2,
			successesWithDebt: 1,
			attemptsWithoutDebt: 2,
			successesWithoutDebt: 2,
		});
		expect(summary.debtLift ?? 0).toBeCloseTo(-0.5, 5);
	});

	it("buckets attempts by the re-decompose round their task id encodes", () => {
		const parseRound = (taskId: string | null | undefined) => (taskId ?? "").split("redecompose-").length - 1;
		const rows = summarizeRedecomposeRoundOutcomes(
			[
				debtAttempt("r1", "success", null, "task-a"),
				debtAttempt("r2", "timeout", null, "redecompose-task-a"),
				debtAttempt("r3", "success", null, "redecompose-task-a"),
				debtAttempt("r4", "timeout", null, "redecompose-redecompose-task-a"),
			],
			parseRound,
		);
		expect(rows).toEqual([
			{ round: 0, attempts: 1, successes: 1 },
			{ round: 1, attempts: 2, successes: 1 },
			{ round: 2, attempts: 1, successes: 0 },
		]);
	});
});
