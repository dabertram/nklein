import { describe, expect, it } from "vitest";
import { type ChatAgentModelResponse, type ChatToolCall, runChatAgentLoop } from "../../../src/chat/chat-agent-loop";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";

const start: ChatPromptMessage[] = [{ role: "user", content: "what's in README?" }];

// A simple fold: append a system note recording each tool result, so the next turn "sees" them.
const appendToolExchange = (
	messages: readonly ChatPromptMessage[],
	_response: ChatAgentModelResponse,
	results: readonly { callId: string; content: string }[],
): ChatPromptMessage[] => [
	...messages,
	...results.map((result) => ({ role: "system" as const, content: `tool ${result.callId}: ${result.content}` })),
];

describe("runChatAgentLoop", () => {
	it("executes tool calls then returns the model's final answer", async () => {
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "The README explains the project.", toolCalls: [] },
		];
		const executed: ChatToolCall[] = [];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => {
					executed.push(call);
					return { callId: call.id, content: "# Project" };
				},
				appendToolExchange,
			},
		);
		expect(executed.map((c) => c.name)).toEqual(["read_file"]);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.result.content).toBe("# Project");
		expect(result.finalText).toBe("The README explains the project.");
		expect(result.hitIterationLimit).toBe(false);
	});

	it("returns immediately when the first response has no tool calls", async () => {
		let calls = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => {
					calls++;
					return { text: "Direct answer.", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("should not execute tools");
				},
				appendToolExchange,
			},
		);
		expect(result.finalText).toBe("Direct answer.");
		expect(result.steps).toEqual([]);
		expect(calls).toBe(1);
	});

	it("forces a final answer (tools disabled) when it hits the iteration limit", async () => {
		const allowTools: boolean[] = [];
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 2 },
			{
				complete: async (_messages, allow) => {
					allowTools.push(allow);
					// Asks for a *distinct* tool each allowed turn (distinct args ⇒ not deduped), so it genuinely
					// exhausts the cap; the final forced turn (allow=false) concludes.
					return allow
						? {
								text: "",
								toolCalls: [{ id: `c${allowTools.length}`, name: "loop", arguments: { n: allowTools.length } }],
							}
						: { text: "Best effort answer.", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "ok" }),
				appendToolExchange,
			},
		);
		expect(allowTools).toEqual([true, true, false]);
		expect(result.steps).toHaveLength(2);
		expect(result.finalText).toBe("Best effort answer.");
		expect(result.hitIterationLimit).toBe(true);
	});

	it("de-duplicates a repeated identical tool call: runs it once, then forces an answer (todo §5.O)", async () => {
		// A weak model that re-requests the exact same read every allowed turn, then would answer if forced.
		const allowTools: boolean[] = [];
		const executed: ChatToolCall[] = [];
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 8 },
			{
				complete: async (_messages, allow) => {
					allowTools.push(allow);
					return allow
						? {
								text: "",
								toolCalls: [
									{ id: `c${allowTools.length}`, name: "read_file", arguments: { path: "README.md" } },
								],
							}
						: { text: "It documents the project.", toolCalls: [] };
				},
				executeTool: async (call) => {
					executed.push(call);
					return { callId: call.id, content: "# Project" };
				},
				appendToolExchange,
			},
		);
		// The tool ran exactly once despite being re-requested; the loop then forced a final answer early
		// (not via the iteration cap), well under maxIterations.
		expect(executed).toHaveLength(1);
		expect(result.steps).toHaveLength(1);
		expect(allowTools).toEqual([true, true, false]);
		expect(result.finalText).toBe("It documents the project.");
		expect(result.hitIterationLimit).toBe(false);
	});

	it("streams the final no-tool answer through onToken via a tools-disabled re-call (hybrid streaming §5.M G3a)", async () => {
		const allowTools: boolean[] = [];
		const tokens: string[] = [];
		const result = await runChatAgentLoop(
			{ messages: start, onToken: (delta) => tokens.push(delta) },
			{
				complete: async (_messages, allow, onToken) => {
					allowTools.push(allow);
					// Discovery call returns no tools; the loop then re-issues a tools-disabled streaming call.
					if (onToken) {
						onToken("Direct ");
						onToken("answer.");
					}
					return { text: "Direct answer.", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("should not execute tools");
				},
				appendToolExchange,
			},
		);
		expect(result.finalText).toBe("Direct answer.");
		expect(result.steps).toEqual([]);
		// One discovery call (allow=true) then one streamed final call (allow=false).
		expect(allowTools).toEqual([true, false]);
		expect(tokens.join("")).toBe("Direct answer.");
		expect(tokens.length).toBeGreaterThanOrEqual(2);
	});

	it("streams the forced final answer through onToken when it hits the iteration limit (§5.M G3a)", async () => {
		const tokens: string[] = [];
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 1, onToken: (delta) => tokens.push(delta) },
			{
				complete: async (_messages, allow, onToken) => {
					if (allow) {
						return { text: "", toolCalls: [{ id: "c1", name: "loop", arguments: {} }] };
					}
					onToken?.("Best ");
					onToken?.("effort.");
					return { text: "Best effort.", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "ok" }),
				appendToolExchange,
			},
		);
		expect(result.hitIterationLimit).toBe(true);
		expect(result.finalText).toBe("Best effort.");
		expect(tokens.join("")).toBe("Best effort.");
	});

	it("makes no extra model call for the no-tool answer when no onToken is given", async () => {
		let calls = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => {
					calls++;
					return { text: "Direct answer.", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("should not execute tools");
				},
				appendToolExchange,
			},
		);
		expect(result.finalText).toBe("Direct answer.");
		expect(calls).toBe(1);
	});

	it("still runs genuinely new calls that differ only in arguments", async () => {
		const executed: string[] = [];
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.md" } }] },
			{ text: "", toolCalls: [{ id: "c2", name: "read_file", arguments: { path: "b.md" } }] },
			{ text: "Done.", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => {
					executed.push(String(call.arguments.path));
					return { callId: call.id, content: "ok" };
				},
				appendToolExchange,
			},
		);
		expect(executed).toEqual(["a.md", "b.md"]);
		expect(result.steps).toHaveLength(2);
		expect(result.finalText).toBe("Done.");
		expect(result.hitIterationLimit).toBe(false);
	});
});
