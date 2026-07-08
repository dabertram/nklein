import { describe, expect, it } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import { planTerminalRedriveEscalation } from "../../../src/core/terminal-redrive-escalation";

function attempt(taskId: string, modelId: string, outcome: "success" | "other_failure" | "loop", at: number) {
	return buildAttemptEvent({
		workflowId: taskId,
		taskId,
		workspacePathHash: "h",
		attemptId: `${taskId}-${at}`,
		parentAttemptId: null,
		modelId,
		endpoint: null,
		outcome,
		recordedAt: at,
		toolCalls: [],
		// A hard-stuck episode needs distinct approaches — vary the prompt strategy per attempt.
		promptStrategy: `strategy-${at}`,
		...(outcome === "loop" ? { salvage: null } : {}),
	});
}

describe("planTerminalRedriveEscalation (§5.AG Layer-1: hard-stuck dead card → best untried loaded model)", () => {
	it("switches to the best untried loaded model when the ledger shows a hard-stuck episode", () => {
		const events = [
			attempt("t1", "lmstudio:alpha:v1", "other_failure", 1),
			attempt("t1", "lmstudio:alpha:v1", "loop", 2),
			attempt("t1", "lmstudio:alpha:v1", "other_failure", 3),
		];
		const action = planTerminalRedriveEscalation({
			events,
			taskId: "t1",
			availableModelIds: ["lmstudio:alpha:v1", "lmstudio:beta:v1", "lmstudio:gamma:v1"],
		});
		expect(action).toEqual({ kind: "retry_other_model", modelId: "lmstudio:beta:v1" });
	});

	it("continues (no switch) while the episode is still transient — few failures or a recent success", () => {
		const fresh = planTerminalRedriveEscalation({
			events: [attempt("t1", "lmstudio:alpha:v1", "other_failure", 1)],
			taskId: "t1",
			availableModelIds: ["lmstudio:alpha:v1", "lmstudio:beta:v1"],
		});
		expect(fresh.kind).toBe("continue");
		const recovered = planTerminalRedriveEscalation({
			events: [
				attempt("t1", "lmstudio:alpha:v1", "other_failure", 1),
				attempt("t1", "lmstudio:alpha:v1", "success", 2),
			],
			taskId: "t1",
			availableModelIds: ["lmstudio:alpha:v1", "lmstudio:beta:v1"],
		});
		expect(recovered.kind).toBe("continue");
	});

	it("escalates to the user when hard-stuck and every loaded model has been tried", () => {
		const events = [
			attempt("t1", "lmstudio:alpha:v1", "other_failure", 1),
			attempt("t1", "lmstudio:beta:v1", "loop", 2),
			attempt("t1", "lmstudio:alpha:v1", "other_failure", 3),
		];
		const action = planTerminalRedriveEscalation({
			events,
			taskId: "t1",
			availableModelIds: ["lmstudio:alpha:v1", "lmstudio:beta:v1"],
		});
		expect(action).toEqual({ kind: "escalate_to_user" });
	});
});

describe("key-format leniency (ledger keys are provider:model:endpoint; loaded ids are plain)", () => {
	it("matches a tried registry key against a plain loaded id and switches to the genuinely untried model", () => {
		const events = [
			attempt("t1", "lmstudio:alpha:http://127.0.0.1:1234/v1", "other_failure", 1),
			attempt("t1", "lmstudio:alpha:http://127.0.0.1:1234/v1", "loop", 2),
			attempt("t1", "lmstudio:alpha:http://127.0.0.1:1234/v1", "other_failure", 3),
		];
		const action = planTerminalRedriveEscalation({
			events,
			taskId: "t1",
			availableModelIds: ["alpha", "beta"],
		});
		expect(action).toEqual({ kind: "retry_other_model", modelId: "beta" });
	});
});
