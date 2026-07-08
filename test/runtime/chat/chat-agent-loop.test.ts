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

	it("folds steering updates into the final no-tool model call before streaming", async () => {
		const seen: ChatPromptMessage[][] = [];
		let polls = 0;
		let closedBeforeFinal = false;
		let closed = false;
		const result = await runChatAgentLoop(
			{
				messages: start,
				onToken: () => undefined,
				pollSteeringMessages: async () => {
					polls += 1;
					return polls === 2 ? [{ id: "steer-1", content: "Answer in bullets.", createdAt: 1_000 }] : [];
				},
				closeSteering: () => {
					closed = true;
				},
			},
			{
				complete: async (messages, allow) => {
					seen.push([...messages]);
					if (!allow) {
						closedBeforeFinal = closed;
					}
					return { text: allow ? "premature direct answer" : "Steered answer.", toolCalls: [] };
				},
				executeTool: async () => {
					throw new Error("should not execute tools");
				},
				appendToolExchange,
			},
		);
		expect(result.finalText).toBe("Steered answer.");
		expect(closedBeforeFinal).toBe(true);
		expect(seen).toHaveLength(2);
		expect(seen[1]?.map((message) => message.content).join("\n")).toContain("Answer in bullets.");
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

	it("§5.AA controller gate: rejects a premature 'done' until the completion assessor's evidence is satisfied", async () => {
		// Turn 1: the model 'declares done' with no tool call (the §5.Z e2e premature-done failure).
		// Turn 2: nudged to continue, it finally calls the tool. Turn 3: now genuinely done.
		const turns: ChatAgentModelResponse[] = [
			{ text: "All steps complete!", toolCalls: [] },
			{ text: "", toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }] },
			{ text: "Done for real.", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "created" }),
				appendToolExchange,
				// Evidence-based completion: only complete once create_card has actually executed.
				assessCompletion: (steps) => steps.some((step) => step.toolCall.name === "create_card"),
			},
		);
		// The premature 'done' (turn 1) was rejected; the card got created; the run completed on turn 3.
		expect(result.steps.map((s) => s.toolCall.name)).toEqual(["create_card"]);
		expect(result.finalText).toBe("Done for real.");
		expect(result.hitIterationLimit).toBe(false);
	});

	it("§5.AA controller gate: an absent assessor preserves today's behavior (first no-call turn is final)", async () => {
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => ({ text: "Answer.", toolCalls: [] }),
				executeTool: async (call) => ({ callId: call.id, content: "" }),
				appendToolExchange,
			},
		);
		expect(result.finalText).toBe("Answer.");
		expect(result.steps).toHaveLength(0);
	});
	it("§5.AA gate: an all-repeats turn while INCOMPLETE nudges to continue (not force-final)", async () => {
		// Turn 1: call read_file (real). Turn 2: re-call read_file (repeat → dedup, executedNew=0) while incomplete →
		// the gate nudges instead of force-finalizing. Turn 3: finally call create_card → complete.
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "a", name: "read_file", arguments: { path: "x" } }] },
			{ text: "", toolCalls: [{ id: "b", name: "read_file", arguments: { path: "x" } }] }, // repeat
			{ text: "", toolCalls: [{ id: "c", name: "create_card", arguments: { title: "X" } }] },
			{ text: "All set.", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start },
			{
				complete: async () => turns[turn++] ?? { text: "", toolCalls: [] },
				executeTool: async (call) => ({ callId: call.id, content: "ok" }),
				appendToolExchange,
				assessCompletion: (steps) => steps.some((s) => s.toolCall.name === "create_card"),
			},
		);
		// The repeat didn't force-final; create_card eventually ran → complete.
		expect(result.steps.map((s) => s.toolCall.name)).toEqual(["read_file", "create_card"]);
		expect(result.finalText).toBe("All set.");
	});

	it("§5.AB force-advance: a model STUCK re-emitting a done tool is forced to the NEXT undone step", async () => {
		// The §5.AB loop-spin bug: the model returns a REAL structured call every turn but it's always the same,
		// already-executed read_file (deduped → executedNew=0). Before the fix the loop only nudged and spun to the cap;
		// now the stuck-branch calls complete() with forceToolCall=true, and the fake honors it by emitting the next
		// undone tool — proving the loop reaches the adapter's forcing rung on the repeated-call path.
		const forceFlags: (boolean | undefined)[] = [];
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 8 },
			{
				complete: async (_messages, allow, _onToken, _used, forceToolCall) => {
					forceFlags.push(forceToolCall);
					if (!allow) {
						return { text: "All four steps done.", toolCalls: [] };
					}
					// A forced discovery turn advances to run_command; every UN-forced discovery turn re-emits read_file.
					return forceToolCall
						? { text: "", toolCalls: [{ id: "rc", name: "run_command", arguments: { command: "cat FACT.txt" } }] }
						: { text: "", toolCalls: [{ id: "rf", name: "read_file", arguments: { path: "FACT.txt" } }] };
				},
				executeTool: async (call) => ({ callId: call.id, content: `ran ${call.name}` }),
				appendToolExchange,
				// Complete once BOTH read_file and run_command have executed (a 2-tool required chain).
				assessCompletion: (steps) => {
					const used = new Set(steps.map((s) => s.toolCall.name));
					return used.has("read_file") && used.has("run_command");
				},
			},
		);
		// The chain ADVANCED past read_file — run_command fired via the force path — and the run completed.
		expect(result.steps.map((s) => s.toolCall.name)).toEqual(["read_file", "run_command"]);
		expect(result.finalText).toBe("All four steps done.");
		expect(result.hitIterationLimit).toBe(false);
		// The force signal was actually raised (a forceToolCall:true call happened) — this is the mechanism under test.
		expect(forceFlags).toContain(true);
	});

	it("§5.AB guardrail: forcing STOPS once the run is complete — a finished task ends in a normal prose answer", async () => {
		// After the one required tool runs, the model re-emits it (repeat). The run is now COMPLETE by evidence, so the
		// stuck-branch must NOT force another tool (no infinite forcing) — it falls through to the final answer.
		const forceFlags: (boolean | undefined)[] = [];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 8 },
			{
				complete: async (_messages, allow, _onToken, _used, forceToolCall) => {
					forceFlags.push(forceToolCall);
					turn += 1;
					if (!allow) {
						return { text: "Card created — all done.", toolCalls: [] };
					}
					// Turn 1: create_card (real). Every later discovery turn: re-emit create_card (repeat → deduped).
					return { text: "", toolCalls: [{ id: `cc${turn}`, name: "create_card", arguments: { title: "X" } }] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "created" }),
				appendToolExchange,
				assessCompletion: (steps) => steps.some((s) => s.toolCall.name === "create_card"),
			},
		);
		// create_card ran exactly once; once complete, the loop forced a normal final answer (no force-advance).
		expect(result.steps.map((s) => s.toolCall.name)).toEqual(["create_card"]);
		expect(result.finalText).toBe("Card created — all done.");
		expect(result.hitIterationLimit).toBe(false);
		// The force signal was NEVER raised — the guardrail (complete ⇒ don't force) held.
		expect(forceFlags).not.toContain(true);
	});

	it("§5.AB force-advance: happy path is UNCHANGED — a chain that advances naturally never triggers forcing", async () => {
		// Each turn emits a DISTINCT next tool (natural progress, executedNew>0 every turn), so the stuck-branch is never
		// entered and forceToolCall is never set — the fix is inert on a healthy multi-step run.
		const forceFlags: (boolean | undefined)[] = [];
		const turns: ChatAgentModelResponse[] = [
			{ text: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "FACT.txt" } }] },
			{ text: "", toolCalls: [{ id: "c2", name: "run_command", arguments: { command: "cat FACT.txt" } }] },
			{ text: "", toolCalls: [{ id: "c3", name: "create_card", arguments: { title: "X" } }] },
			{ text: "Done.", toolCalls: [] },
		];
		let turn = 0;
		const result = await runChatAgentLoop(
			{ messages: start, maxIterations: 8 },
			{
				complete: async (_messages, _allow, _onToken, _used, forceToolCall) => {
					forceFlags.push(forceToolCall);
					return turns[turn++] ?? { text: "", toolCalls: [] };
				},
				executeTool: async (call) => ({ callId: call.id, content: "ok" }),
				appendToolExchange,
				assessCompletion: (steps) => {
					const used = new Set(steps.map((s) => s.toolCall.name));
					return used.has("read_file") && used.has("run_command") && used.has("create_card");
				},
			},
		);
		expect(result.steps.map((s) => s.toolCall.name)).toEqual(["read_file", "run_command", "create_card"]);
		expect(result.finalText).toBe("Done.");
		// forceToolCall was never true (the stuck-branch was never reached on a naturally-advancing chain).
		expect(forceFlags.every((flag) => !flag)).toBe(true);
	});
});
