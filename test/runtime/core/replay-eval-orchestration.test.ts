import { describe, expect, it, vi } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	buildReplayEvalOutcome,
	orchestrateReplayEvalAutoCapture,
	type ReplayEvalAutoCaptureDeps,
} from "../../../src/core/replay-eval-orchestration";

const ids = {
	taskId: "t1",
	resultBranch: "result/t1",
	baselineTreePath: "/base",
	workflowId: "wf1",
	workspacePathHash: "hash",
	baselineLedgerRoot: "/ledger/base",
	replayLedgerRoot: "/ledger/replay",
};

describe("buildReplayEvalOutcome (F1.26b)", () => {
	it("returns both an evaluation and the retention event to feed the gate", () => {
		const outcome = buildReplayEvalOutcome({
			captured: [] as AgentLedgerEvent[],
			replayed: [] as AgentLedgerEvent[],
			workflowId: "wf",
			taskId: "t",
			workspacePathHash: "h",
		});
		expect(outcome.evaluation).toBeDefined();
		expect(outcome.retentionEvent).toBeDefined();
		expect(outcome.retentionEvent.kind).toBe("transition");
	});
});

describe("orchestrateReplayEvalAutoCapture (F1.26b)", () => {
	function deps(overrides: Partial<ReplayEvalAutoCaptureDeps> = {}) {
		const calls: string[] = [];
		const cleanup = vi.fn(async () => {
			calls.push("cleanup");
		});
		const base: ReplayEvalAutoCaptureDeps = {
			runScenarioSuite: vi.fn(async ({ ledgerRootDir }) => {
				calls.push(`suite:${ledgerRootDir}`);
			}),
			createResultWorktree: vi.fn(async () => {
				calls.push("worktree");
				return { path: "/wt", cleanup };
			}),
			readCapturedLedger: vi.fn(async () => [] as AgentLedgerEvent[]),
			...overrides,
		};
		return { deps: base, calls, cleanup };
	}

	it("captures the baseline BEFORE the worktree exists, then compares, then cleans up", async () => {
		const { deps: d, calls, cleanup } = deps();
		const outcome = await orchestrateReplayEvalAutoCapture(ids, d);
		expect(calls).toEqual(["suite:/ledger/base", "worktree", "suite:/ledger/replay", "cleanup"]);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(outcome.retentionEvent).toBeDefined();
	});

	it("ALWAYS cleans up the worktree even when the replay run throws", async () => {
		const cleanup = vi.fn(async () => {});
		let suiteCall = 0;
		const { deps: d } = deps({
			runScenarioSuite: vi.fn(async () => {
				suiteCall += 1;
				if (suiteCall === 2) {
					throw new Error("replay suite failed");
				}
			}),
			createResultWorktree: vi.fn(async () => ({ path: "/wt", cleanup })),
		});
		await expect(orchestrateReplayEvalAutoCapture(ids, d)).rejects.toThrow("replay suite failed");
		expect(cleanup).toHaveBeenCalledTimes(1); // finally ran despite the failure
	});
});
