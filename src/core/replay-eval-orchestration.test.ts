import { describe, expect, it } from "vitest";
import { type AgentLedgerEvent, buildTransitionEvent } from "./agent-attempt-ledger";
import { buildReplayEvalOutcome } from "./replay-eval-orchestration";

function ledger(steps: ReadonlyArray<{ from: string; to: string }>): AgentLedgerEvent[] {
	return steps.map((step) =>
		buildTransitionEvent({
			workflowId: "wf-1",
			taskId: "task-1",
			workspacePathHash: "hash-1",
			from: step.from,
			to: step.to,
			reason: "step",
			controllerDecision: "d",
		}),
	);
}

const RUN = [
	{ from: "idle", to: "planning" },
	{ from: "planning", to: "implementing" },
	{ from: "implementing", to: "review" },
];

describe("buildReplayEvalOutcome (F1.26b)", () => {
	it("identical captured/replayed ledgers → PASS + a replay_eval_pass retention event", () => {
		const outcome = buildReplayEvalOutcome({
			captured: ledger(RUN),
			replayed: ledger(RUN),
			workflowId: "wf-1",
			taskId: "task-1",
			workspacePathHash: "hash-1",
			recordedAt: 1000,
		});
		expect(outcome.evaluation.pass).toBe(true);
		expect(outcome.retentionEvent.to).toBe("replay_eval_pass");
		expect(outcome.retentionEvent.taskId).toBe("task-1");
		expect(outcome.retentionEvent.controllerDecision).toBe("replay_eval");
	});

	it("a divergent replay → FAIL + a replay_eval_fail retention event with the divergence summarized", () => {
		const outcome = buildReplayEvalOutcome({
			captured: ledger(RUN),
			replayed: ledger([...RUN.slice(0, 2), { from: "implementing", to: "failed" }]),
			workflowId: "wf-1",
			taskId: "task-1",
			workspacePathHash: "hash-1",
		});
		expect(outcome.evaluation.pass).toBe(false);
		expect(outcome.retentionEvent.to).toBe("replay_eval_fail");
		expect(outcome.retentionEvent.reason).toBe(outcome.evaluation.summary);
	});
});
