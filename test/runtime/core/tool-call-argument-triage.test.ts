import { describe, expect, it } from "vitest";
import {
	assembleStreamedToolCalls,
	describeUnusableToolCall,
	type OfferedTool,
	type StreamedTurnEvent,
	triageStreamedToolCalls,
} from "../../../src/core/tool-call-argument-triage";

/**
 * P23.5 (2): a worker emitted three EMPTY write_file calls with the payload sitting in its prompt (clean stops).
 * The swarm ladder called each a success because "a tool call happened". Triage judges the ARGUMENTS the SDK would
 * dispatch, so an empty call to a tool with required fields is a malformed turn — the constrained rung's trigger.
 */
const writeFile: OfferedTool = {
	name: "write_file",
	description: "write",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "number" } },
		required: ["path", "content"],
	},
};
const listFiles: OfferedTool = { name: "list_files", description: "list", inputSchema: { type: "object" } };
const finish: StreamedTurnEvent = { type: "finish", reason: "tool-calls" };

describe("assembleStreamedToolCalls", () => {
	it("concatenates chunked argument text per call id and prefers a delivered object", () => {
		const calls = assembleStreamedToolCalls([
			{ type: "tool-call-delta", toolCallId: "a", toolName: "write_file", inputText: '{"path":' },
			{ type: "tool-call-delta", toolCallId: "b", toolName: "list_files", input: { dir: "." } },
			{ type: "tool-call-delta", toolCallId: "a", inputText: '"x.ts","content":"hi"}' },
			finish,
		]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({ key: "a", toolName: "write_file", inputText: '{"path":"x.ts","content":"hi"}' });
		expect(calls[0]?.eventIndexes).toEqual([0, 2]);
		expect(calls[1]).toMatchObject({ key: "b", toolName: "list_files", input: { dir: "." } });
	});

	it("restarts the text when a chunk opens a new JSON value — the SDK's own merge rule", () => {
		const calls = assembleStreamedToolCalls([
			{ type: "tool-call-delta", toolCallId: "a", toolName: "write_file", inputText: "garbage" },
			{ type: "tool-call-delta", toolCallId: "a", inputText: '{"path":"x","content":"y"}' },
		]);
		expect(calls[0]?.inputText).toBe('{"path":"x","content":"y"}');
	});

	it("keys id-less deltas by index the way the SDK does", () => {
		const calls = assembleStreamedToolCalls([
			{ type: "tool-call-delta", toolName: "list_files", inputText: "{}" },
			{ type: "tool-call-delta", toolName: "write_file", inputText: "{}" },
		]);
		expect(calls.map((call) => call.key)).toEqual(["tool_0", "tool_1"]);
	});
});

describe("triageStreamedToolCalls", () => {
	it("an EMPTY call to a tool with required fields is a malformed turn that names the fields to re-ask", () => {
		const triage = triageStreamedToolCalls(
			[{ type: "tool-call-delta", toolCallId: "w1", toolName: "write_file", inputText: "" }, finish],
			[writeFile, listFiles],
		);
		expect(triage.verdict).toBe("malformed");
		expect(triage.firstUnusable?.assessment.fieldsToReask).toEqual(["path", "content"]);
		expect(describeUnusableToolCall(triage.firstUnusable as NonNullable<typeof triage.firstUnusable>)).toBe(
			"write_file: re-ask 2 required field(s): path, content",
		);
		// Nothing was repaired — the events are handed back untouched.
		expect(triage.events).toEqual([
			{ type: "tool-call-delta", toolCallId: "w1", toolName: "write_file", inputText: "" },
			finish,
		]);
	});

	it("broken JSON on a clean stop is unusable, not silently `{}`", () => {
		const triage = triageStreamedToolCalls(
			[{ type: "tool-call-delta", toolCallId: "w1", toolName: "write_file", inputText: '{"path": "x.ts", "cont' }],
			[writeFile],
		);
		expect(triage.verdict).toBe("malformed");
		expect(triage.firstUnusable?.assessment.reason).toContain("not an object");
	});

	it("an empty call to a tool WITHOUT required fields is usable — there is nothing to miss", () => {
		const triage = triageStreamedToolCalls(
			[{ type: "tool-call-delta", toolCallId: "l1", toolName: "list_files", inputText: "" }, finish],
			[writeFile, listFiles],
		);
		expect(triage.verdict).toBe("usable");
		expect(triage.calls[0]?.dispatchArguments).toEqual({});
	});

	it("applies a lossless repair IN the event stream and collapses the call's chunks into one delta", () => {
		const events: StreamedTurnEvent[] = [
			{ type: "text-delta", text: "Writing." },
			{ type: "tool-call-delta", toolCallId: "w1", toolName: "write_file", inputText: '{"path":"x.ts",' },
			{ type: "tool-call-delta", toolCallId: "w1", inputText: '"content":"hi","mode":"420","extra":1}' },
			finish,
		];
		const triage = triageStreamedToolCalls(events, [writeFile]);
		expect(triage.verdict).toBe("repaired");
		expect(triage.events).toEqual([
			{ type: "text-delta", text: "Writing." },
			{
				type: "tool-call-delta",
				toolCallId: "w1",
				toolName: "write_file",
				input: { path: "x.ts", content: "hi", mode: 420 },
				inputText: '{"path":"x.ts","content":"hi","mode":420}',
			},
			finish,
		]);
		// The source list is never mutated.
		expect(events).toHaveLength(4);
	});

	it("a batch with good calls beside a bad one is mixed — the good calls ship, the bad one keeps its tool error", () => {
		const triage = triageStreamedToolCalls(
			[
				{ type: "tool-call-delta", toolCallId: "l1", toolName: "list_files", inputText: "{}" },
				{ type: "tool-call-delta", toolCallId: "w1", toolName: "write_file", inputText: "{}" },
				finish,
			],
			[writeFile, listFiles],
		);
		expect(triage.verdict).toBe("mixed");
		expect(triage.firstUnusable?.call.toolCallId).toBe("w1");
	});

	it("a call naming no offered tool is unusable", () => {
		const triage = triageStreamedToolCalls(
			[{ type: "tool-call-delta", toolCallId: "p1", toolName: "phantom", inputText: '{"a":1}' }],
			[writeFile],
		);
		expect(triage.verdict).toBe("malformed");
		expect(triage.firstUnusable?.assessment.reason).toContain("no offered tool matches");
	});

	it("a turn without tool calls has nothing to triage", () => {
		expect(triageStreamedToolCalls([{ type: "text-delta", text: "done" }], [writeFile]).verdict).toBe("no_calls");
	});
});
