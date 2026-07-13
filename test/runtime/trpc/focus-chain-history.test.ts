import { describe, expect, it } from "vitest";
import { buildTransitionEvent } from "../../../src/core/agent-attempt-ledger";
import { hashWorkspacePathForLedger } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { appendAgentLedgerEvent } from "../../../src/state/agent-attempt-ledger-store";
import { handleGetFocusChainHistory } from "../../../src/trpc/runtime-api/focus-chain-history";

/**
 * F1.6 — the audit-history read projects ONLY the F1.5 focus-step ledger transitions (reason `focus_step: <text>`,
 * from/to `focus:<status>`) for the requested task, chronological, ignoring plain lifecycle transitions and other
 * tasks. The setup-file HOME isolation gives each test file its own ledger root, so writes here are hermetic.
 */

const WORKSPACE_PATH = "/tmp/focus-history-workspace";
const HASH = hashWorkspacePathForLedger(WORKSPACE_PATH);

function focusTransition(input: { taskId: string; step: string; from: string | null; to: string; recordedAt: number }) {
	return buildTransitionEvent({
		workflowId: "wf-1",
		taskId: input.taskId,
		workspacePathHash: HASH,
		from: input.from === null ? null : `focus:${input.from}`,
		to: `focus:${input.to}`,
		reason: `focus_step: ${input.step}`,
		recordedAt: input.recordedAt,
	});
}

describe("handleGetFocusChainHistory (F1.6 audit history)", () => {
	it("returns only the task's focus-step transitions, chronological, with focus: prefixes stripped", async () => {
		// Out-of-order append + noise: a lifecycle transition, another task's focus step.
		await appendAgentLedgerEvent(
			focusTransition({ taskId: "task-a", step: "Wire the API", from: "in_progress", to: "done", recordedAt: 300 }),
		);
		await appendAgentLedgerEvent(
			buildTransitionEvent({
				workflowId: "wf-1",
				taskId: "task-a",
				workspacePathHash: HASH,
				from: "queued",
				to: "running",
				reason: "scheduler start",
				recordedAt: 150,
			}),
		);
		await appendAgentLedgerEvent(
			focusTransition({ taskId: "task-b", step: "Other card", from: null, to: "in_progress", recordedAt: 200 }),
		);
		await appendAgentLedgerEvent(
			focusTransition({ taskId: "task-a", step: "Wire the API", from: null, to: "in_progress", recordedAt: 100 }),
		);

		const response = await handleGetFocusChainHistory(
			{ workspaceId: "ws-1", workspacePath: WORKSPACE_PATH },
			{ taskId: "task-a" },
		);
		expect(response.transitions).toEqual([
			{ stepText: "Wire the API", from: null, to: "in_progress", recordedAt: 100 },
			{ stepText: "Wire the API", from: "in_progress", to: "done", recordedAt: 300 },
		]);
	});

	it("returns an empty history without a workspace scope or without any ledger", async () => {
		expect(await handleGetFocusChainHistory(null, { taskId: "task-a" })).toEqual({ transitions: [] });
		expect(
			await handleGetFocusChainHistory(
				{ workspaceId: "ws-x", workspacePath: "/tmp/never-written-workspace" },
				{ taskId: "task-a" },
			),
		).toEqual({ transitions: [] });
	});
});
