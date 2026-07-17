import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import { computeCostPerResolve, paretoFrontierOf } from "../../../src/core/cost-per-resolve";

function attempt(
	modelId: string,
	flow: string,
	taskId: string,
	outcome: string,
	wallMs: number,
	tokens: number,
): AgentLedgerEvent {
	return {
		kind: "attempt",
		modelId,
		flow,
		taskId,
		outcome,
		startedAt: 1_000,
		completedAt: 1_000 + wallMs,
		contextTokens: tokens,
	} as unknown as AgentLedgerEvent;
}

describe("computeCostPerResolve", () => {
	it("amortizes ALL attempts' cost over resolved tasks per (model, role)", () => {
		const rows = computeCostPerResolve([
			attempt("m1", "worker", "t1", "success", 10_000, 5_000),
			attempt("m1", "worker", "t2", "other_failure", 30_000, 8_000), // wasted cost still amortized
			attempt("m1", "worker", "t3", "success", 20_000, 7_000),
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ modelId: "m1", role: "worker", attempts: 3, resolvedTasks: 2 });
		expect(rows[0]?.resolveRate).toBeCloseTo(2 / 3, 5);
		expect(rows[0]?.wallMsPerResolve).toBe(30_000); // 60s total / 2 resolves
		expect(rows[0]?.tokensPerResolve).toBe(10_000); // 20k / 2
	});

	it("splits the role dimension and null-costs zero-resolve rows", () => {
		const rows = computeCostPerResolve([
			attempt("m1", "worker", "t1", "success", 10_000, 1_000),
			attempt("m1", "reviewer", "t2", "other_failure", 5_000, 500),
		]);
		const reviewer = rows.find((r) => r.role === "reviewer");
		expect(reviewer?.wallMsPerResolve).toBeNull();
		expect(reviewer?.resolveRate).toBe(0);
	});

	it("ignores non-attempt events", () => {
		expect(computeCostPerResolve([{ kind: "transition" } as unknown as AgentLedgerEvent])).toEqual([]);
	});
});

describe("paretoFrontierOf", () => {
	it("keeps only non-dominated rows per role (accuracy up, cost down)", () => {
		const rows = computeCostPerResolve([
			attempt("fast", "worker", "t1", "success", 5_000, 1_000),
			attempt("slow", "worker", "t2", "success", 50_000, 9_000),
			attempt("slow", "worker", "t3", "other_failure", 50_000, 9_000),
		]);
		// "slow" has a lower resolve rate AND a higher cost-per-resolve than "fast" → dominated.
		expect(paretoFrontierOf(rows).map((r) => r.modelId)).toEqual(["fast"]);
	});

	it("keeps both when neither dominates and separates roles", () => {
		const rows = computeCostPerResolve([
			attempt("accurate", "worker", "t1", "success", 60_000, 1_000),
			attempt("fastLossy", "worker", "t2", "success", 5_000, 1_000),
			attempt("fastLossy", "worker", "t3", "other_failure", 5_000, 1_000),
			attempt("reviewerOnly", "reviewer", "t4", "success", 9_000, 1_000),
		]);
		const frontier = paretoFrontierOf(rows);
		// accurate: rate 1.0 @60s/resolve; fastLossy: rate 0.5 @20s/resolve — neither dominates the other.
		expect(
			frontier
				.filter((r) => r.role === "worker")
				.map((r) => r.modelId)
				.sort(),
		).toEqual(["accurate", "fastLossy"]);
		expect(frontier.some((r) => r.role === "reviewer")).toBe(true);
	});
});
