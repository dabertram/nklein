import { describe, expect, it } from "vitest";
import { buildAttemptEvent, buildSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	buildModelBehaviorProfilesFromLedger,
	buildModelFitnessFromLedger,
	summarizeLedgerForDisplay,
} from "../../../src/core/agent-ledger-projections";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { computeModelFitness } from "../../../src/core/model-fitness";

const base = { workflowId: "wf", taskId: "t", workspacePathHash: "ws" };

function attempt(modelId: string, outcome: ModelOutcomeKind, recordedAt: number, retriesBefore = 0) {
	return buildAttemptEvent({
		...base,
		attemptId: `${modelId}-${recordedAt}`,
		modelId,
		outcome,
		retriesBefore,
		recordedAt,
	});
}

describe("buildModelBehaviorProfilesFromLedger", () => {
	it("returns no profiles for a ledger with no attempts", () => {
		expect(buildModelBehaviorProfilesFromLedger([])).toEqual([]);
		expect(buildModelBehaviorProfilesFromLedger([buildSchedulerEvent({ ...base, event: "queued" })])).toEqual([]);
	});

	it("derives one profile per model from its attempts (samples, successes, failure modes)", () => {
		const events = [
			attempt("model-A", "success", 1),
			attempt("model-A", "timeout", 2),
			attempt("model-A", "success", 3),
			attempt("model-B", "no_tool_call", 4),
		];
		const profiles = buildModelBehaviorProfilesFromLedger(events);
		// model-A has 3 samples, model-B has 1 → sorted A before B.
		expect(profiles.map((p) => p.modelId)).toEqual(["model-A", "model-B"]);
		const a = profiles[0];
		expect(a.samples).toBe(3);
		expect(a.successes).toBe(2);
		expect(a.failureModes.timeout).toBe(1);
		expect(a.successRate).toBeGreaterThan(0);
		expect(a.successRate).toBeLessThanOrEqual(1);
		const b = profiles[1];
		expect(b.samples).toBe(1);
		expect(b.failureModes.no_tool_call).toBe(1);
		expect(b.successRate).toBe(0);
	});

	it("folds attempts in chronological order regardless of input order", () => {
		const out = buildModelBehaviorProfilesFromLedger([
			attempt("m", "success", 30),
			attempt("m", "timeout", 10),
			attempt("m", "success", 20),
		]);
		expect(out).toHaveLength(1);
		expect(out[0].samples).toBe(3);
		expect(out[0].successes).toBe(2);
		// updatedAt reflects the LAST (chronologically) attempt's time.
		expect(out[0].updatedAt).toBe(30);
	});

	it("carries retries into the avgRetries learning signal", () => {
		const out = buildModelBehaviorProfilesFromLedger([attempt("m", "success", 1, 0), attempt("m", "success", 2, 4)]);
		expect(out[0].avgRetries).toBeGreaterThan(0);
	});
});

describe("summarizeLedgerForDisplay", () => {
	it("rolls the ledger into totals + the two model projections", () => {
		const summary = summarizeLedgerForDisplay([
			buildSchedulerEvent({ ...base, event: "queued" }),
			attempt("model-A", "success", 1),
			attempt("model-A", "timeout", 2),
			attempt("model-B", "success", 3),
		]);
		expect(summary.totalEvents).toBe(4);
		expect(summary.totalAttempts).toBe(3);
		expect(summary.outcomes.map((o) => o.modelId)).toEqual(["model-A", "model-B"]);
		expect(summary.profiles.map((p) => p.modelId)).toEqual(["model-A", "model-B"]);
	});

	it("is all-zero/empty for a ledger with no attempts", () => {
		expect(summarizeLedgerForDisplay([])).toEqual({ totalEvents: 0, totalAttempts: 0, outcomes: [], profiles: [] });
	});
});

describe("buildModelFitnessFromLedger", () => {
	function ridAttempt(modelId: string, role: string, outcome: ModelOutcomeKind, latencyMs: number) {
		return buildAttemptEvent({
			...base,
			attemptId: `${modelId}-${role}-${outcome}-${latencyMs}`,
			modelId,
			role,
			outcome,
			startedAt: 0,
			completedAt: latencyMs,
		});
	}

	it("derives one coarse fitness record per (model, role) with success-rate quality + real latency", () => {
		const records = buildModelFitnessFromLedger([
			ridAttempt("m", "worker", "success", 2000),
			ridAttempt("m", "worker", "timeout", 4000),
			ridAttempt("m", "reviewer", "success", 1000),
		]);
		// (m,worker) has 2 samples, (m,reviewer) 1 → sorted by samples.
		expect(records.map((r) => `${r.modelId}/${r.role}`)).toEqual(["m/worker", "m/reviewer"]);
		const worker = records[0];
		expect(worker.samples).toBe(2);
		expect(worker.qualityScore).toBe(0.5); // 1 of 2 success
		expect(worker.reliability).toBe(0.5);
		expect(worker.avgLatencyMs).toBe(3000); // mean of 2000 + 4000
		// The records feed computeModelFitness (a finite, higher-is-better score).
		expect(Number.isFinite(computeModelFitness(worker))).toBe(true);
		expect(records[1].qualityScore).toBe(1); // reviewer: 1 of 1 success
	});

	it("is empty for a ledger with no attempts", () => {
		expect(buildModelFitnessFromLedger([])).toEqual([]);
	});
});
