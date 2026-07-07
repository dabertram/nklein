import { describe, expect, it } from "vitest";
import { buildAttemptEvent, buildSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	blendCapabilityWithLedgerEvidence,
	buildAttemptRetryNoteFromLedger,
	buildFailingModelList,
	buildModelBehaviorProfilesFromLedger,
	buildModelFitnessFromLedger,
	rankModelsByLedgerFitness,
	rankModelsByLedgerFitnessWithVerdict,
	summarizeLedgerForDisplay,
	summarizeModelOutcomesByFlow,
	summarizeModelOutcomesByRole,
} from "../../../src/core/agent-ledger-projections";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { computeModelFitness } from "../../../src/core/model-fitness";
import type { RuntimeRunOutcome } from "../../../src/core/runtime-model-verdict";
import type { SelfObservationEventRecord } from "../../../src/telemetry/self-observation-sink";

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
		expect(summarizeLedgerForDisplay([])).toEqual({
			totalEvents: 0,
			totalAttempts: 0,
			outcomes: [],
			byRole: [],
			byFlow: [],
			profiles: [],
			toolUsage: [],
			speed: [],
			contextUsage: [],
		});
	});
});

describe("summarizeModelOutcomesByRole", () => {
	function roleAttempt(modelId: string, role: string, outcome: ModelOutcomeKind) {
		return buildAttemptEvent({ ...base, attemptId: `${modelId}-${role}-${outcome}`, modelId, role, outcome });
	}

	it("rolls outcomes up per (model, role) — the §5.Z matrix as a query", () => {
		const rows = summarizeModelOutcomesByRole([
			roleAttempt("m", "worker", "success"),
			roleAttempt("m", "worker", "timeout"),
			roleAttempt("m", "reviewer", "success"),
			roleAttempt("m2", "architect", "success"),
		]);
		// (m,worker) has 2 samples → first; then the 1-sample rows by modelId/role.
		expect(rows[0]).toMatchObject({ modelId: "m", role: "worker", samples: 2, successRate: 0.5 });
		expect(rows.map((r) => `${r.modelId}/${r.role}`)).toEqual(["m/worker", "m/reviewer", "m2/architect"]);
		expect(rows.find((r) => r.role === "reviewer")?.byOutcome.success).toBe(1);
	});

	it("defaults a role-less attempt to worker, and is empty for no attempts", () => {
		expect(
			summarizeModelOutcomesByRole([
				buildAttemptEvent({ ...base, attemptId: "x", modelId: "m", outcome: "success" }),
			])[0].role,
		).toBe("worker");
		expect(summarizeModelOutcomesByRole([])).toEqual([]);
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

describe("buildAttemptRetryNoteFromLedger", () => {
	it("is empty when there are no prior failed attempts", () => {
		expect(buildAttemptRetryNoteFromLedger([])).toBe("");
		// A successful attempt is not 'tried-and-failed' → nothing to warn the next attempt about.
		expect(buildAttemptRetryNoteFromLedger([attempt("model-A", "success", 1)])).toBe("");
	});

	it("renders a do-not-repeat note from the workflow's failed attempts, in order, deriving the rung from levers", () => {
		const events = [
			buildAttemptEvent({ ...base, attemptId: "a1", modelId: "model-A", outcome: "no_tool_call", recordedAt: 1 }),
			buildAttemptEvent({
				...base,
				attemptId: "a2",
				modelId: "model-A",
				outcome: "no_tool_call",
				recordedAt: 2,
				simplificationLevel: 1, // → reduced_tool_set rung
			}),
			buildAttemptEvent({
				...base,
				attemptId: "a3",
				modelId: "model-A",
				outcome: "malformed",
				recordedAt: 3,
				promptStrategy: "constrained-schema", // → constrained_schema rung
				toolCalls: [{ name: "create_card", fingerprint: null, outcome: null }],
			}),
			attempt("model-A", "success", 4), // excluded (success)
		];
		const note = buildAttemptRetryNoteFromLedger(events);
		expect(note).toContain("do NOT repeat");
		expect(note).toContain("1. tried same_model_retry → no_tool_call");
		expect(note).toContain("2. tried reduced_tool_set → no_tool_call");
		expect(note).toContain("3. tried constrained_schema → malformed");
		expect(note).toContain("tools=create_card");
		expect(note).not.toContain("success");
	});

	it("filters to a given workflowId", () => {
		const events = [
			buildAttemptEvent({
				...base,
				workflowId: "wf-1",
				attemptId: "x",
				modelId: "m",
				outcome: "timeout",
				recordedAt: 1,
			}),
			buildAttemptEvent({
				...base,
				workflowId: "wf-2",
				attemptId: "y",
				modelId: "m",
				outcome: "loop",
				recordedAt: 2,
			}),
		];
		expect(buildAttemptRetryNoteFromLedger(events, { workflowId: "wf-1" })).toContain("timeout");
		expect(buildAttemptRetryNoteFromLedger(events, { workflowId: "wf-1" })).not.toContain("loop");
	});
});

describe("buildFailingModelList", () => {
	function roleAttempts(modelId: string, role: string, outcome: ModelOutcomeKind, n: number) {
		return Array.from({ length: n }, (_, i) =>
			buildAttemptEvent({ ...base, attemptId: `${modelId}-${role}-${outcome}-${i}`, modelId, role, outcome }),
		);
	}

	it("lists only below-bar (not_recommended) pairings, worst-first, with the failure mode", () => {
		const events = [
			// model-A worker: 5/5 success → recommended (excluded)
			...roleAttempts("model-A", "worker", "success", 5),
			// model-B worker: 0/5 success (all timeouts) → not_recommended, included
			...roleAttempts("model-B", "worker", "timeout", 5),
			// model-C worker: 1 attempt → insufficient_data (excluded, not a floor)
			...roleAttempts("model-C", "worker", "no_tool_call", 1),
		];
		const failing = buildFailingModelList(events);
		expect(failing.map((f) => f.modelId)).toEqual(["model-B"]);
		expect(failing[0]).toMatchObject({ role: "worker", verdict: "not_recommended", topFailureMode: "timeout" });
	});

	it("is empty when nothing is below the bar", () => {
		expect(buildFailingModelList([])).toEqual([]);
	});
});

describe("summarizeModelOutcomesByFlow", () => {
	const flowAttempt = (modelId: string, flow: string | null, outcome: ModelOutcomeKind) =>
		buildAttemptEvent({
			...base,
			attemptId: `${modelId}-${flow}-${outcome}-${Math.random()}`,
			modelId,
			flow,
			outcome,
		});

	it("rolls up per-(model, flow); a null flow is treated as 'board'", () => {
		const rows = summarizeModelOutcomesByFlow([
			flowAttempt("m", null, "success"), // board
			flowAttempt("m", "board", "loop"), // board
			flowAttempt("m", "chat", "success"),
		]);
		const board = rows.find((r) => r.flow === "board");
		const chat = rows.find((r) => r.flow === "chat");
		expect(board?.samples).toBe(2);
		expect(board?.successRate).toBe(0.5);
		expect(chat?.samples).toBe(1);
		expect(chat?.successRate).toBe(1);
	});

	it("is empty for a stream with no attempts", () => {
		expect(summarizeModelOutcomesByFlow([])).toEqual([]);
	});

	it("keeps distinct (model, flow) pairs apart even when a space-joined key would collide", () => {
		// modelIds routinely contain spaces (LM Studio display names, e.g. "Qwen 3 8B"). A space key separator
		// let ("model A","board") collide with ("model","A board") into one merged row; the null-byte separator
		// (matching the sibling rollups) keeps them distinct.
		const rows = summarizeModelOutcomesByFlow([
			flowAttempt("model A", "board", "success"),
			flowAttempt("model", "A board", "loop"),
		]);
		expect(rows).toHaveLength(2);
		const rowA = rows.find((r) => r.modelId === "model A" && r.flow === "board");
		const rowB = rows.find((r) => r.modelId === "model" && r.flow === "A board");
		expect(rowA?.samples).toBe(1);
		expect(rowA?.successRate).toBe(1);
		expect(rowB?.samples).toBe(1);
		expect(rowB?.successRate).toBe(0);
	});
});

describe("rankModelsByLedgerFitness", () => {
	const fitAttempt = (modelId: string, role: string, outcome: ModelOutcomeKind, latencyMs: number) =>
		buildAttemptEvent({
			...base,
			attemptId: `${modelId}-${role}-${outcome}-${latencyMs}-${Math.random()}`,
			modelId,
			role,
			outcome,
			startedAt: 0,
			completedAt: latencyMs,
		});

	it("ranks higher-success / faster models first, attaching the fitness score", () => {
		const ranked = rankModelsByLedgerFitness([
			// good: 2/2 success, fast
			fitAttempt("good", "worker", "success", 500),
			fitAttempt("good", "worker", "success", 700),
			// bad: 0/2 success, slow
			fitAttempt("bad", "worker", "timeout", 5000),
			fitAttempt("bad", "worker", "other_failure", 6000),
		]);
		expect(ranked[0]?.modelId).toBe("good");
		expect(ranked[1]?.modelId).toBe("bad");
		expect(ranked[0]?.fitnessScore).toBeGreaterThan(ranked[1]?.fitnessScore ?? 1);
	});

	it("filters by role and is empty for no attempts", () => {
		const events = [fitAttempt("m", "worker", "success", 500), fitAttempt("m", "reviewer", "success", 500)];
		expect(rankModelsByLedgerFitness(events, { role: "reviewer" }).map((r) => r.role)).toEqual(["reviewer"]);
		expect(rankModelsByLedgerFitness([])).toEqual([]);
	});
});

describe("rankModelsByLedgerFitnessWithVerdict", () => {
	const fitAttempt = (modelId: string, role: string, outcome: ModelOutcomeKind, latencyMs: number) =>
		buildAttemptEvent({
			...base,
			attemptId: `${modelId}-${role}-${outcome}-${latencyMs}-${Math.random()}`,
			modelId,
			role,
			outcome,
			startedAt: 0,
			completedAt: latencyMs,
		});

	const stall = (modelId: string, runId: string): SelfObservationEventRecord => ({
		schemaVersion: 1,
		signal: "model_stalled",
		severity: "warning",
		message: "empty turn",
		modelId,
		runId,
		createdAt: 0,
	});

	// "chronic" wins on RAW fitness (perfect + fast) but stalls on 2/3 runs ⇒ TOOL_UNSUITABLE; "steady" is a hair
	// behind on raw fitness but never stalls. The runtime-verdict penalty must sink chronic below steady.
	const events = [
		fitAttempt("chronic", "worker", "success", 400),
		fitAttempt("chronic", "worker", "success", 400),
		fitAttempt("chronic", "worker", "success", 400),
		fitAttempt("steady", "worker", "success", 900),
		fitAttempt("steady", "worker", "success", 900),
		fitAttempt("steady", "worker", "other_failure", 900),
	];
	const verdictRuns: RuntimeRunOutcome[] = [
		{ runId: "c1", modelId: "chronic" },
		{ runId: "c2", modelId: "chronic" },
		{ runId: "c3", modelId: "chronic" },
	];
	const selfObservationEvents = [stall("chronic", "c1"), stall("chronic", "c2")]; // 2/3 stalls ⇒ ≥0.5 ⇒ UNSUITABLE

	it("with NO verdict evidence, is byte-identical to the base ranking", () => {
		const base = rankModelsByLedgerFitness(events);
		const withVerdict = rankModelsByLedgerFitnessWithVerdict(events, {
			selfObservationEvents: [],
			verdictRuns: [],
		});
		expect(withVerdict).toEqual(base);
	});

	it("sinks a TOOL_UNSUITABLE model below a steadier one it out-ranks on raw fitness", () => {
		const raw = rankModelsByLedgerFitness(events);
		expect(raw[0]?.modelId).toBe("chronic"); // raw fitness puts the staller first

		const penalized = rankModelsByLedgerFitnessWithVerdict(events, { selfObservationEvents, verdictRuns });
		expect(penalized[0]?.modelId).toBe("steady"); // the ×0.1 UNSUITABLE penalty flips the order
		const chronicRow = penalized.find((r) => r.modelId === "chronic");
		const steadyRow = penalized.find((r) => r.modelId === "steady");
		// chronic's score is scaled to 10% of its raw value; steady is untouched.
		expect(chronicRow?.fitnessScore).toBeCloseTo((raw.find((r) => r.modelId === "chronic")?.fitnessScore ?? 0) * 0.1);
		expect(steadyRow?.fitnessScore).toBe(raw.find((r) => r.modelId === "steady")?.fitnessScore);
	});

	it("leaves models with too little evidence (<3 runs) unpenalized", () => {
		// Only 1 run of verdict evidence ⇒ UNKNOWN ⇒ multiplier 1 ⇒ same order as raw.
		const penalized = rankModelsByLedgerFitnessWithVerdict(events, {
			selfObservationEvents: [stall("chronic", "c1")],
			verdictRuns: [{ runId: "c1", modelId: "chronic" }],
		});
		expect(penalized[0]?.modelId).toBe("chronic");
	});
});

describe("blendCapabilityWithLedgerEvidence", () => {
	it("returns the base capability unchanged below the evidence threshold (new / under-observed model)", () => {
		// 2 samples < default minSamples 3 ⇒ no shift, even with a terrible success rate.
		expect(blendCapabilityWithLedgerEvidence(80, 0, 2)).toBe(80);
		// null success rate (no ledger row for this model) ⇒ unchanged.
		expect(blendCapabilityWithLedgerEvidence(80, null, 50)).toBe(80);
	});

	it("nudges capability toward the observed success rate, weighted by evidence", () => {
		// base 80, observed 50% success (=50), 10 samples ⇒ weight 0.5, raw shift (50-80)*0.5 = -15 ⇒ 65.
		expect(blendCapabilityWithLedgerEvidence(80, 0.5, 10)).toBe(65);
		// strong real-world success lifts a modest registry prior: base 60, observed 80, 10 samples ⇒ weight 0.5,
		// shift (80-60)*0.5 = +10 ⇒ 70.
		expect(blendCapabilityWithLedgerEvidence(60, 0.8, 10)).toBe(70);
	});

	it("clamps the shift to ±maxShift and the result to 0..100", () => {
		// huge negative pull capped at -30: 90 - 30 = 60.
		expect(blendCapabilityWithLedgerEvidence(90, 0, 100)).toBe(60);
		// custom maxShift narrows the pull.
		expect(blendCapabilityWithLedgerEvidence(90, 0, 100, { maxShift: 10 })).toBe(80);
		// result never leaves 0..100.
		expect(blendCapabilityWithLedgerEvidence(5, 0, 100)).toBe(0);
	});
});
