import { describe, expect, it } from "vitest";
import { buildAttemptEvent, buildSchedulerEvent } from "../../../src/core/agent-attempt-ledger";
import { buildModelBehaviorProfilesFromLedger } from "../../../src/core/agent-ledger-projections";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

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
