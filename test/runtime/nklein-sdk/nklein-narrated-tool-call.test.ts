import type { AgentMessage, AgentMessagePart } from "@nklein/shared";
import { describe, expect, it } from "vitest";

import { parseNarratedToolCalls, recoverNarratedToolCalls } from "../../../src/nklein-sdk/nklein-narrated-tool-call";

function message(...content: AgentMessagePart[]): AgentMessage {
	return { id: "m1", role: "assistant", content, createdAt: 0 };
}

describe("parseNarratedToolCalls", () => {
	it("parses the exact <tool_call> block a 35B model emitted in its reasoning channel (evidence bundle)", () => {
		const text = `<tool_call>
{"name": "list_files", "arguments": {"path": "/workspace", "recursive": false, "maxDepth": 1, "includeHidden": true}}
</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{
				toolName: "list_files",
				input: { path: "/workspace", recursive: false, maxDepth: 1, includeHidden: true },
			},
		]);
	});

	it("parses a read_large_file continuation call (the other observed stall)", () => {
		const text = `Some reasoning prose.\n<tool_call>\n{"name": "read_large_file", "arguments": {"path": "/spec.md", "cursor": "read:789:2"}}\n</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "read_large_file", input: { path: "/spec.md", cursor: "read:789:2" } },
		]);
	});

	it("recovers multiple narrated calls", () => {
		const text = `<tool_call>{"name": "read_files", "arguments": {"path": "a.ts"}}</tool_call>
<tool_call>{"name": "read_files", "arguments": {"path": "b.ts"}}</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([
			{ toolName: "read_files", input: { path: "a.ts" } },
			{ toolName: "read_files", input: { path: "b.ts" } },
		]);
	});

	it("tolerates the pipe-delimited <|tool_call|> and <function_call> variants", () => {
		expect(parseNarratedToolCalls(`<|tool_call|>{"name":"x","arguments":{"a":1}}<|/tool_call|>`)).toEqual([
			{ toolName: "x", input: { a: 1 } },
		]);
		expect(parseNarratedToolCalls(`<function_call>{"name":"y","arguments":{}}</function_call>`)).toEqual([
			{ toolName: "y", input: {} },
		]);
	});

	it("recovers a truncated block with no closing tag (balanced-brace extraction closes it)", () => {
		expect(parseNarratedToolCalls(`<tool_call>\n{"name": "list_files", "arguments": {"path": "/workspace"`)).toEqual([
			{ toolName: "list_files", input: { path: "/workspace" } },
		]);
	});

	it("unwraps double-encoded (string) arguments", () => {
		const text = `<tool_call>{"name":"read_files","arguments":"{\\"path\\":\\"a.ts\\"}"}</tool_call>`;
		expect(parseNarratedToolCalls(text)).toEqual([{ toolName: "read_files", input: { path: "a.ts" } }]);
	});

	it("accepts input/parameters/tool aliases and repairs sloppy JSON (trailing comma)", () => {
		expect(parseNarratedToolCalls(`<tool_call>{"name":"a","input":{"x":1}}</tool_call>`)).toEqual([
			{ toolName: "a", input: { x: 1 } },
		]);
		expect(parseNarratedToolCalls(`<tool_call>{"tool":"b","parameters":{"y":2,}}</tool_call>`)).toEqual([
			{ toolName: "b", input: { y: 2 } },
		]);
	});

	it("ignores blocks with no tool name and text without a wrapper", () => {
		expect(parseNarratedToolCalls(`<tool_call>{"arguments":{"path":"a"}}</tool_call>`)).toEqual([]);
		expect(parseNarratedToolCalls(`I would list the files in /workspace and then read them.`)).toEqual([]);
		expect(parseNarratedToolCalls(`{"name":"list_files","arguments":{}}`)).toEqual([]); // bare JSON, no wrapper
	});
});

describe("recoverNarratedToolCalls", () => {
	it("appends a recovered tool-call part when the call is narrated in the reasoning channel", () => {
		const msg = message({
			type: "reasoning",
			text: `<tool_call>\n{"name": "list_files", "arguments": {"path": "/workspace"}}\n</tool_call>`,
		});
		const recovered = recoverNarratedToolCalls(msg);
		expect(recovered).toHaveLength(1);
		expect(recovered[0]).toMatchObject({
			type: "tool-call",
			toolName: "list_files",
			input: { path: "/workspace" },
			metadata: { recoveredFromNarratedToolCall: true },
		});
		expect(recovered[0].toolCallId).toBeTruthy();
		// Mutated in place so the agent loop (which filters message.content for tool-call parts) dispatches it.
		expect(msg.content.filter((part) => part.type === "tool-call")).toHaveLength(1);
	});

	it("recovers from the text channel too", () => {
		const msg = message({
			type: "text",
			text: `<tool_call>{"name":"read_files","arguments":{"path":"a.ts"}}</tool_call>`,
		});
		expect(recoverNarratedToolCalls(msg)).toHaveLength(1);
	});

	it("is a no-op when a real tool call is already present (no double-execution)", () => {
		const msg = message(
			{ type: "text", text: `<tool_call>{"name":"list_files","arguments":{}}</tool_call>` },
			{ type: "tool-call", toolCallId: "real", toolName: "list_files", input: {} },
		);
		expect(recoverNarratedToolCalls(msg)).toEqual([]);
		expect(msg.content.filter((part) => part.type === "tool-call")).toHaveLength(1);
	});

	it("is a no-op when nothing is narrated", () => {
		const msg = message({ type: "text", text: "All done — the files look correct." });
		expect(recoverNarratedToolCalls(msg)).toEqual([]);
		expect(msg.content).toHaveLength(1);
	});
});
