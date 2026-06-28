import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { buildModelCapabilityAdvice } from "../../../src/core/agent-ledger-projections";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";

let seq = 0;
function attempt(modelId: string, role: string, outcome: ModelOutcomeKind): AgentLedgerEvent {
	seq += 1;
	return buildAttemptEvent({
		workflowId: `wf-${seq}`,
		taskId: `t-${seq}`,
		workspacePathHash: "hash",
		role,
		attemptId: `a-${seq}`,
		modelId,
		outcome,
		recordedAt: seq,
	});
}

/** n attempts of one outcome for a (model, role). */
function attempts(modelId: string, role: string, outcome: ModelOutcomeKind, n: number): AgentLedgerEvent[] {
	return Array.from({ length: n }, () => attempt(modelId, role, outcome));
}

describe("buildModelCapabilityAdvice", () => {
	it("recommends a high-success model and flags a capability-floor model with its dominant failure", () => {
		const events = [
			...attempts("strong", "worker", "success", 9),
			...attempts("strong", "worker", "other_failure", 1), // 90% → recommended
			...attempts("weak", "worker", "no_tool_call", 8),
			...attempts("weak", "worker", "success", 2), // 20% → not_recommended, mostly no_tool_call
		];
		const advice = buildModelCapabilityAdvice(events);
		const strong = advice.perRole.find((a) => a.modelId === "strong");
		const weak = advice.perRole.find((a) => a.modelId === "weak");
		expect(strong).toMatchObject({ verdict: "recommended", samples: 10 });
		expect(weak).toMatchObject({ verdict: "not_recommended", topFailureMode: "no_tool_call" });
		expect(advice.notes.join("\n")).toContain("worker:");
		expect(advice.notes.join("\n")).toContain("recommended: strong");
		expect(advice.notes.join("\n")).toContain("avoid: weak");
		expect(advice.notes.join("\n")).toContain("mostly no_tool_call");
	});

	it("does NOT judge prematurely — too few samples is insufficient_data, not a floor", () => {
		const events = attempts("newcomer", "architect", "other_failure", 2); // below minSamples (3)
		const advice = buildModelCapabilityAdvice(events);
		expect(advice.perRole[0]).toMatchObject({
			modelId: "newcomer",
			verdict: "insufficient_data",
			topFailureMode: null,
		});
		expect(advice.notes.join("\n")).toContain("architect: insufficient data to advise yet");
	});

	it("classifies a middling model as usable (between the avoid and recommend rates)", () => {
		const events = [...attempts("mid", "reviewer", "success", 6), ...attempts("mid", "reviewer", "timeout", 4)]; // 60%
		const advice = buildModelCapabilityAdvice(events);
		expect(advice.perRole[0]).toMatchObject({ modelId: "mid", verdict: "usable", topFailureMode: null });
	});

	it("respects custom thresholds", () => {
		const events = [...attempts("m", "worker", "success", 7), ...attempts("m", "worker", "timeout", 3)]; // 70%
		expect(buildModelCapabilityAdvice(events, { recommendRate: 0.7 }).perRole[0]?.verdict).toBe("recommended");
		expect(buildModelCapabilityAdvice(events, { avoidRate: 0.75 }).perRole[0]?.verdict).toBe("not_recommended");
	});
});
