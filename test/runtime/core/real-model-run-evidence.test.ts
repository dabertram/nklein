import {
	extractRealModelRuntimeSignals,
	extractRealModelToolEvidence,
	isCardTransitionLedgerEvent,
	summarizeRealModelToolEvidence,
} from "../../../src/core/real-model-run-evidence";

describe("real-model run evidence", () => {
	it("preserves successful, failed, pending, and orphaned tool results with their exact bodies", () => {
		const executions = extractRealModelToolEvidence({
			sessionId: "session-1",
			agent: "lead",
			messages: [
				{
					id: "assistant-1",
					ts: 10,
					modelInfo: { id: "model-a" },
					content: [
						{ type: "tool_use", id: "use-ok", name: "read_files", input: { files: ["a.ts"] } },
						{ type: "tool_use", id: "use-error", name: "decompose_project", input: { tasks: [] } },
						{ type: "tool_use", id: "use-pending", name: "submit_plan", input: {} },
					],
				},
				{
					id: "result-1",
					ts: 20,
					content: [
						{ type: "tool_result", tool_use_id: "use-ok", content: { files: ["a.ts"] } },
						{
							type: "tool_result",
							tool_use_id: "use-error",
							is_error: true,
							content: { error: "dependency-coherence validation failed" },
						},
						{ type: "tool_result", tool_use_id: "missing-use", name: "unknown", content: "orphan" },
					],
				},
			],
		});

		expect(executions).toHaveLength(4);
		expect(executions[0]).toMatchObject({
			toolName: "read_files",
			status: "completed",
			isError: false,
			result: { files: ["a.ts"] },
		});
		expect(executions[1]).toMatchObject({
			toolName: "decompose_project",
			status: "completed",
			isError: true,
			result: { error: "dependency-coherence validation failed" },
		});
		expect(executions[2]).toMatchObject({ status: "pending", isError: null, result: null });
		expect(executions[3]).toMatchObject({ status: "orphan_result", isError: false, result: "orphan" });
		expect(summarizeRealModelToolEvidence([executions])).toEqual({
			sessions: 1,
			toolUses: 3,
			completedResults: 2,
			successfulResults: 1,
			errorResults: 1,
			pendingToolUses: 1,
			orphanResults: 1,
		});
	});

	it("extracts the runtime failures that explain a stalled run", () => {
		const signals = extractRealModelRuntimeSignals(
			[
				"ordinary log line",
				"Task graph failed dependency-coherence validation: bad edge",
				"plan-critique is waiting for capacity at its 1 concurrent-session cap",
				"context_floor_unmet",
				"name is already in use by container abc",
				"FATAL runtime exited",
			].join("\n"),
		);
		expect(signals.map((signal) => signal.kind)).toEqual([
			"dependency_coherence_rejection",
			"model_capacity_wait",
			"context_floor_refusal",
			"sandbox_conflict",
			"runtime_failure",
		]);
	});

	it("recognizes transition ledger events only", () => {
		expect(isCardTransitionLedgerEvent({ kind: "transition", from: "planning", to: "running" })).toBe(true);
		expect(isCardTransitionLedgerEvent({ kind: "attempt" })).toBe(false);
		expect(isCardTransitionLedgerEvent(null)).toBe(false);
	});
});
