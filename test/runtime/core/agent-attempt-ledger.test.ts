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
	summarizeModelOutcomes,
} from "../../../src/core/agent-attempt-ledger";

const base = { workflowId: "wf-1", taskId: "t-1", workspacePathHash: "ws-hash" };

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
