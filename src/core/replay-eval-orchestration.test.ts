import { describe, expect, it, vi } from "vitest";
import { type AgentLedgerEvent, buildTransitionEvent } from "./agent-attempt-ledger";
import {
	buildReplayEvalOutcome,
	orchestrateReplayEvalAutoCapture,
	type ReplayEvalAutoCaptureDeps,
} from "./replay-eval-orchestration";

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

describe("orchestrateReplayEvalAutoCapture (F1.26b sequencing)", () => {
	const INPUT = {
		taskId: "task-1",
		resultBranch: "nklein/result/task-1",
		baselineTreePath: "/repo",
		workflowId: "self-improvement-replay",
		workspacePathHash: "hash-1",
		baselineLedgerRoot: "/tmp/baseline",
		replayLedgerRoot: "/tmp/replay",
	};

	it("runs the baseline suite BEFORE creating the worktree, compares the two isolated captures, and cleans up", async () => {
		const order: string[] = [];
		const cleanup = vi.fn(async () => {
			order.push("cleanup");
		});
		const deps: ReplayEvalAutoCaptureDeps = {
			runScenarioSuite: vi.fn(async ({ ledgerRootDir }) => {
				order.push(`run:${ledgerRootDir}`);
			}),
			createResultWorktree: vi.fn(async () => {
				order.push("worktree");
				return { path: "/tmp/worktree", cleanup };
			}),
			// Both captures identical → deterministic PASS.
			readCapturedLedger: vi.fn(async () => ledger(RUN)),
		};

		const outcome = await orchestrateReplayEvalAutoCapture(INPUT, deps);
		expect(outcome.evaluation.pass).toBe(true);
		// Baseline suite runs first, THEN the worktree is created, THEN the replay suite, THEN cleanup.
		expect(order).toEqual(["run:/tmp/baseline", "worktree", "run:/tmp/replay", "cleanup"]);
		// The replay suite ran against the worktree path, not the baseline tree.
		expect(deps.runScenarioSuite).toHaveBeenLastCalledWith({
			treePath: "/tmp/worktree",
			ledgerRootDir: "/tmp/replay",
		});
	});

	it("ALWAYS cleans up the worktree, even when the replay run throws", async () => {
		const cleanup = vi.fn(async () => {});
		let call = 0;
		const deps: ReplayEvalAutoCaptureDeps = {
			runScenarioSuite: vi.fn(async () => {
				call += 1;
				if (call === 2) {
					throw new Error("aimock run failed");
				}
			}),
			createResultWorktree: vi.fn(async () => ({ path: "/tmp/worktree", cleanup })),
			readCapturedLedger: vi.fn(async () => ledger(RUN)),
		};

		await expect(orchestrateReplayEvalAutoCapture(INPUT, deps)).rejects.toThrow("aimock run failed");
		expect(cleanup).toHaveBeenCalledTimes(1); // the finally still fired
	});
});
