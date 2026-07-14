import { describe, expect, it } from "vitest";
import type { ChatAgentModelResponse } from "../../../src/chat/chat-agent-loop";
import { runChatAgentConversation, runChatAgentTurn } from "../../../src/chat/chat-agent-turn";
import { appendChatToolExchange } from "../../../src/chat/chat-local-llm-adapter";
import type { ChatSession } from "../../../src/chat/chat-session-store";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";

function session(): ChatSession {
	return {
		schemaVersion: 1,
		id: "s1",
		title: "t",
		scope: "project_sandboxed",
		role: "planner_architect",
		goal: null,
		riskAcknowledged: false,
		browserEnabled: false,
		sandboxWritablePaths: [],
		feedbackMuted: false,
		feedbackVerbosity: "normal",
		feedbackQuiet: false,
		ownedWorkspaceId: null,
		focus: null,
		outstandingAsks: [],
		selectedSkillIds: [],
		totalTokensUsed: 0,
		taintLabels: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("runChatAgentTurn", () => {
	it("drives the agent loop (tool call → execute → final answer) and persists the turn", async () => {
		const appended: Array<{ role: string; content: string }> = [];
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "The README documents the project.", toolCalls: [] },
		];
		let turn = 0;
		const executed: string[] = [];

		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "what's in the readme?", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) => {
					appended.push({ role: input.role, content: input.content });
					return {
						schemaVersion: 1,
						id: `m${appended.length}`,
						role: input.role,
						content: input.content,
						createdAt: 0,
					};
				},
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => {
					executed.push(call.name);
					return { callId: call.id, content: "# Project" };
				},
				appendToolExchange: appendChatToolExchange,
			},
		);

		expect(executed).toEqual(["read_file"]);
		expect(result.steps).toHaveLength(1);
		expect(result.assistantMessage.content).toBe("The README documents the project.");
		expect(appended.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect((appended[1] as { content: string }).content).toBe("The README documents the project.");
		expect(result.hitIterationLimit).toBe(false);
	});

	it("re-anchors the focus chain into the turn when readFocusChain provides one (todo §5.M G4)", async () => {
		let seenMessages: Array<{ role: string; content: string }> = [];
		await runChatAgentTurn(
			{ session: session(), userMessage: "go", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				readFocusChain: async () => ({ steps: [{ text: "step one", status: "in_progress" }], updatedAt: 1 }),
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async (messages) => {
					seenMessages = messages as Array<{ role: string; content: string }>;
					return { text: "ok", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		const note = seenMessages.find((message) => message.role === "system" && message.content.includes("focus chain"));
		expect(note).toBeTruthy();
		expect(note?.content).toContain("step one");
		expect(note?.content).toContain("[~]");
	});

	it("nudges to draft a focus chain when enabled + no chain + a multi-tool turn (§5.M/§5.N)", async () => {
		let seenMessages: Array<{ role: string; content: string }> = [];
		await runChatAgentTurn(
			{ session: session(), userMessage: "do a multi-step thing", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				// no readFocusChain ⇒ no chain; enabled + tools offered ⇒ nudge.
				focusChainNudgeEnabled: true,
				offeredToolNames: ["a", "b"],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async (messages) => {
					seenMessages = messages as Array<{ role: string; content: string }>;
					return { text: "ok", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(
			seenMessages.find((message) => message.role === "system" && message.content.includes("draft your plan")),
		).toBeTruthy();
	});

	it("does NOT nudge when the flag is off (byte-identical default)", async () => {
		let seenMessages: Array<{ role: string; content: string }> = [];
		await runChatAgentTurn(
			{ session: session(), userMessage: "do a thing", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				focusChainNudgeEnabled: false,
				offeredToolNames: ["a", "b"],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async (messages) => {
					seenMessages = messages as Array<{ role: string; content: string }>;
					return { text: "ok", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(
			seenMessages.find((message) => message.role === "system" && message.content.includes("draft your plan")),
		).toBeUndefined();
	});

	it("persists a direct answer when the model uses no tools", async () => {
		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "hi", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => ({ text: "hello there", toolCalls: [] }),
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(result.steps).toEqual([]);
		expect(result.assistantMessage.content).toBe("hello there");
	});

	it("streams the final no-tool reply through onToken while persisting the full text (hybrid streaming §5.M G3a)", async () => {
		const reply = "streamed turn reply";
		const tokens: string[] = [];
		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "say hi", tokenBudget: 1000, onToken: (delta) => tokens.push(delta) },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async (_messages, _allowTools, onToken) => {
					if (onToken) {
						onToken(reply.slice(0, 9));
						onToken(reply.slice(9));
					}
					return { text: reply, toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(tokens.join("")).toBe(reply);
		expect(tokens.length).toBeGreaterThanOrEqual(2);
		expect(result.assistantMessage.content).toBe(reply);
	});

	it("cleans a narrated tool call from the final reply, confirming the action instead (§5.O)", async () => {
		// Weak model: first turn calls the tool, then narrates another call as its final text (gemma-4-e2b live).
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "greet.js", content: "x" } }] },
			{ text: "<|tool_call>call:write_file\nfile_name: greet.js", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "create greet.js", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "wrote 1 byte" }),
				appendToolExchange: appendChatToolExchange,
			},
		);
		// The raw `<|tool_call>…` markup never reaches the user; a brief confirmation replaces the all-narration reply.
		expect(result.assistantMessage.content).not.toContain("tool_call");
		expect(result.assistantMessage.content).toBe("Done. (used: write_file)");
	});

	it("never leaks raw narrated markup when the whole reply is markup and NO tools ran (§5.O)", async () => {
		// Weak model narrates a malformed tool call as its ENTIRE final answer — nothing real ran and nothing
		// parseable to recover. cleaned === "" and steps === []; the fallback must be neutral, NOT the raw markup.
		const result = await runChatAgentTurn(
			{ session: session(), userMessage: "do it", tokenBudget: 1000 },
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => ({ text: "<|tool_call>invalid json", toolCalls: [] }),
				executeTool: async () => {
					throw new Error("no tools expected");
				},
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(result.steps).toEqual([]);
		expect(result.assistantMessage.content).not.toContain("tool_call");
		expect(result.assistantMessage.content).toBe("I wasn't able to produce a response.");
	});
});

describe("runChatAgentConversation", () => {
	it("runs a tool-using turn per line, surfaces tools used, and stops at /exit", async () => {
		const lines = ["read the readme", "", "/exit", "never reached"];
		let cursor = 0;
		const output: string[] = [];
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "README.md" } }] },
			{ text: "It documents the project.", toolCalls: [] },
		];
		let turn = 0;

		const taken = await runChatAgentConversation(
			{ session: session(), tokenBudget: 1000 },
			{
				readLine: async () => lines[cursor++] ?? null,
				write: (text) => output.push(text),
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) =>
					({ schemaVersion: 1, id: "m", role: input.role, content: input.content, createdAt: 0 }) as ChatMessage,
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "# Project" }),
				appendToolExchange: appendChatToolExchange,
			},
		);

		expect(taken).toBe(1);
		expect(output).toEqual(["  (used: read_file)\n", "It documents the project.\n"]);
	});
});

describe("acceptance evidence-gate (§5.AA: Acceptance check line supplies the real completion oracle)", () => {
	it("rejects a premature prose 'done' until the acceptance command has run green", async () => {
		const turns: ChatAgentModelResponse[] = [
			// Model claims done without ever running the acceptance check → the gate must nudge onward.
			{ text: "All done, everything works!", toolCalls: [] },
			// Nudged: it actually runs the check…
			{ text: "", toolCalls: [{ id: "c1", name: "run_command", arguments: { command: "npm test" } }] },
			// …then the final answer is accepted (gate satisfied by the green run).
			{ text: "Tests pass — task complete.", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentTurn(
			{
				session: session(),
				userMessage: "Implement the widget.\nAcceptance check: npm test",
				tokenBudget: 1000,
			},
			{
				readTranscript: async () => [],
				readMemories: async () => [],
				appendMessage: async (_sessionId, input) => ({
					schemaVersion: 1,
					id: "m1",
					role: input.role,
					content: input.content,
					createdAt: 0,
				}),
				summarize: async () => "",
				estimateTokens: (text) => text.length,
				model: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "Command exited with code 0.\nstdout:\nok" }),
				appendToolExchange: appendChatToolExchange,
			},
		);
		expect(result.steps.map((step) => step.toolCall.name)).toEqual(["run_command"]);
		expect(result.assistantMessage.content).toBe("Tests pass — task complete.");
	});
});
