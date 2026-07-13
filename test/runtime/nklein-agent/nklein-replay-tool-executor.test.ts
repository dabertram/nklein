import { describe, expect, it, vi } from "vitest";
import type { AgentLedgerEvent, AgentTransitionEvent } from "../../../src/core/agent-attempt-ledger";
import {
	decideToolReplayAction,
	type RecordedToolExecution,
	resolveToolReplayPolicy,
} from "../../../src/core/tool-replay-policy";
import { hashToolResultContent } from "../../../src/core/tool-result-record";
import { buildRecordedToolExecutions } from "../../../src/nklein-agent/nklein-ledger-tool-calls";
import { wrapToolsForReplay } from "../../../src/nklein-agent/nklein-replay-tool-executor";
import { computeNKleinToolInputFingerprint } from "../../../src/nklein-agent/nklein-tool-call-fingerprint";
import type { AgentTool } from "../../../src/nklein-agent/sdk-agent-types";

/**
 * F1.17 — replay policies end to end: policy resolution, the per-call decision, the transcript-sourced recording
 * builder (the same contract simulator fixtures supply), and the replay-aware executor's five behaviors with
 * persisted decisions.
 */

const ctx = undefined as never;

function recording(over: Partial<RecordedToolExecution> = {}): RecordedToolExecution {
	const content = over.content ?? "recorded output";
	return {
		toolName: "run_commands",
		inputFingerprint: "fp",
		occurrence: 0,
		content,
		resultHash: hashToolResultContent(content),
		isError: false,
		...over,
	};
}

describe("policy resolution + decision", () => {
	it("explicit config > per-tool default > reuse fail-safe; no record always executes live", () => {
		expect(resolveToolReplayPolicy("run_commands", null)).toBe("reuse");
		expect(resolveToolReplayPolicy("read_files", null)).toBe("reconfirm");
		expect(resolveToolReplayPolicy("totally_new_tool", null)).toBe("reuse");
		expect(resolveToolReplayPolicy("read_files", { read_files: "skip" })).toBe("skip");
		expect(decideToolReplayAction({ policy: "reuse", recorded: null })).toEqual({ action: "execute_first_time" });
	});
});

describe("buildRecordedToolExecutions (the shared transcript/fixture contract)", () => {
	it("indexes completed calls by occurrence and omits calls the run never completed", () => {
		const input = { command: "npm test" };
		const messages = [
			{ role: "assistant", content: [{ type: "tool_use", id: "u1", name: "run_commands", input }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok-1", is_error: false }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "u2", name: "run_commands", input }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "u2", content: "ok-2", is_error: true }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "u3", name: "run_commands", input }] }, // no result
		] as never;
		const executions = buildRecordedToolExecutions(messages);
		expect(executions).toHaveLength(2);
		expect(executions[0]).toMatchObject({ occurrence: 0, content: "ok-1", isError: false });
		expect(executions[1]).toMatchObject({ occurrence: 1, content: "ok-2", isError: true });
		expect(executions[0]?.inputFingerprint).toBe(computeNKleinToolInputFingerprint(input));
	});
});

describe("wrapToolsForReplay", () => {
	function makeTool(execute: AgentTool["execute"]): AgentTool {
		return { name: "run_commands", description: "run", inputSchema: { type: "object" }, execute };
	}
	const input = { command: "npm test" };
	const fp = computeNKleinToolInputFingerprint(input);

	it("reuse: returns the recorded payload without executing; an errored recording replays as a throw", async () => {
		const live = vi.fn(async () => "live");
		const events: AgentLedgerEvent[] = [];
		const [tool] = wrapToolsForReplay([makeTool(live)], {
			workflowId: "wf",
			taskId: "t-1",
			workspacePath: "/repo",
			recordings: [
				recording({ inputFingerprint: fp, content: "recorded output" }),
				recording({ inputFingerprint: fp, occurrence: 1, content: "boom", isError: true }),
			],
			appendEvent: async (event) => void events.push(event),
		});
		await expect(tool?.execute(input, ctx)).resolves.toBe("recorded output");
		await expect(tool?.execute(input, ctx)).rejects.toThrow("boom"); // occurrence 1 — the errored repeat
		expect(live).not.toHaveBeenCalled();
		// Third identical call has NO recording ⇒ first execution runs live.
		await expect(tool?.execute(input, ctx)).resolves.toBe("live");
		expect(live).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(events).toHaveLength(3));
		expect(events.map((event) => (event as AgentTransitionEvent).to)).toEqual([
			"replay_reuse",
			"replay_reuse",
			"replay_execute_first_time",
		]);
	});

	it("skip: returns the marker without executing", async () => {
		const live = vi.fn(async () => "live");
		const [tool] = wrapToolsForReplay([makeTool(live)], {
			workflowId: "wf",
			taskId: "t-1",
			workspacePath: "/repo",
			recordings: [recording({ inputFingerprint: fp })],
			policies: { run_commands: "skip" },
		});
		await expect(tool?.execute(input, ctx)).resolves.toContain("side effect not repeated");
		expect(live).not.toHaveBeenCalled();
	});

	it("simulate: the fixture answers; an absent fixture falls back to live execution", async () => {
		const live = vi.fn(async () => "live");
		const simulateResult = vi.fn(({ occurrence }: { occurrence: number }) =>
			occurrence === 0 ? "simulated" : undefined,
		);
		const [tool] = wrapToolsForReplay([makeTool(live)], {
			workflowId: "wf",
			taskId: "t-1",
			workspacePath: "/repo",
			recordings: [recording({ inputFingerprint: fp }), recording({ inputFingerprint: fp, occurrence: 1 })],
			policies: { run_commands: "simulate" },
			simulateResult,
		});
		await expect(tool?.execute(input, ctx)).resolves.toBe("simulated");
		await expect(tool?.execute(input, ctx)).resolves.toBe("live"); // fixture returned undefined
	});

	it("reconfirm: executes live and records whether the fresh result matched the recording", async () => {
		const events: AgentLedgerEvent[] = [];
		const [tool] = wrapToolsForReplay([{ ...makeTool(async () => "recorded output"), name: "read_files" }], {
			workflowId: "wf",
			taskId: "t-1",
			workspacePath: "/repo",
			recordings: [
				recording({ toolName: "read_files", inputFingerprint: fp, content: "recorded output" }),
				recording({ toolName: "read_files", inputFingerprint: fp, occurrence: 1, content: "DIFFERENT" }),
			],
			appendEvent: async (event) => void events.push(event),
		});
		await expect(tool?.execute(input, ctx)).resolves.toBe("recorded output");
		await expect(tool?.execute(input, ctx)).resolves.toBe("recorded output"); // live wins even on drift
		await vi.waitFor(() => expect(events).toHaveLength(2));
		const decisions = events.map((event) => (event as AgentTransitionEvent).controllerDecision);
		expect(decisions[0]).toBe("policy=reconfirm,matched=true");
		expect(decisions[1]).toBe("policy=reconfirm,matched=false"); // drift detected + recorded
	});
});
