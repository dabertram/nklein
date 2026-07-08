import { describe, expect, it } from "vitest";
import { extractFocusChainTouchDeltaFromSdkEvent } from "../../../src/nklein-agent/nklein-focus-chain-touch-delta";

function agentEvent(event: Record<string, unknown>): unknown {
	return {
		type: "agent_event",
		payload: {
			sessionId: "session-1",
			event,
		},
	};
}

describe("extractFocusChainTouchDeltaFromSdkEvent", () => {
	it("extracts normalized repo-relative file paths from successful content_end tool results", () => {
		const delta = extractFocusChainTouchDeltaFromSdkEvent(
			"task-1",
			agentEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "write_file",
				toolCallId: "tool-1",
				output: { ok: true },
			}),
			{
				lookupToolInput: () => ({ path: "/workspaces/task-1/src/a.ts" }),
			},
		);

		expect(delta).toEqual({ files: ["src/a.ts"] });
	});

	it("drops failed tool results", () => {
		const delta = extractFocusChainTouchDeltaFromSdkEvent(
			"task-1",
			agentEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "write_file",
				toolCallId: "tool-1",
				error: "blocked",
				output: { ok: false },
			}),
			{
				lookupToolInput: () => ({ path: "src/a.ts" }),
			},
		);

		expect(delta).toEqual({});
	});

	it("extracts apply_patch target paths", () => {
		const delta = extractFocusChainTouchDeltaFromSdkEvent(
			"task-1",
			agentEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "apply_patch",
				toolCallId: "tool-1",
				output: { success: true },
			}),
			{
				lookupToolInput: () => ({
					input: ["*** Begin Patch", "*** Update File: ./src/a.ts", "@@", "-old", "+new", "*** End Patch"].join(
						"\n",
					),
				}),
			},
		);

		expect(delta).toEqual({ files: ["src/a.ts"] });
	});

	it("extracts decompose_project card ids from successful outputs", () => {
		const delta = extractFocusChainTouchDeltaFromSdkEvent(
			"planning-card",
			agentEvent({
				type: "content_end",
				contentType: "tool",
				toolName: "decompose_project",
				toolCallId: "tool-1",
				output: {
					ok: true,
					taskIdByPlanTaskId: { storage: "card-1", ui: "card-2" },
					rootTaskIds: ["card-1"],
					createdTasks: [{ id: "card-3" }, { id: "card-2" }],
				},
			}),
		);

		expect(delta).toEqual({ cardIds: ["card-1", "card-2", "card-3"] });
	});

	it("extracts paths from tool-finished events before the session adapter clears stored inputs", () => {
		const delta = extractFocusChainTouchDeltaFromSdkEvent(
			"task-1",
			agentEvent({
				type: "tool-finished",
				toolCall: {
					type: "tool-call",
					toolCallId: "tool-1",
					toolName: "read_files",
					input: { files: [{ path: "fallback.ts" }] },
				},
				message: {
					id: "msg-tool-1",
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "tool-1",
							toolName: "read_files",
							output: [{ success: true }],
						},
					],
				},
			}),
			{
				lookupToolInput: () => ({ files: [{ file_path: "./workspaces/task-1/src/from-stored-input.ts" }] }),
			},
		);

		expect(delta).toEqual({ files: ["src/from-stored-input.ts"] });
	});
});
