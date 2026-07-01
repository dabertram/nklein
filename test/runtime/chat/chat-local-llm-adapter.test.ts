import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatAgentModelResponse } from "../../../src/chat/chat-agent-loop";
import {
	appendChatToolExchange,
	type ChatAgentCompletionClient,
	type ChatCompletionClient,
	createChatAgentModel,
	createChatModelDeps,
} from "../../../src/chat/chat-local-llm-adapter";
import type { ChatMessage } from "../../../src/chat/chat-transcript-store";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";
import type { LocalLlmChatMessage, LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";

function fakeClient(reply: string): { client: ChatCompletionClient; calls: LocalLlmChatMessage[][] } {
	const calls: LocalLlmChatMessage[][] = [];
	const client: ChatCompletionClient = {
		complete: async (request) => {
			calls.push(request.messages);
			return { content: reply, finishReason: "stop", raw: {} };
		},
	};
	return { client, calls };
}

describe("createChatModelDeps", () => {
	it("maps the rendered prompt to the client and strips inline reasoning from the reply", async () => {
		const { client, calls } = fakeClient("<think>hmm let me consider</think>The answer is 42.");
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([
			{ role: "system", content: "be helpful" },
			{ role: "user", content: "what is the answer?" },
		]);
		expect(reply).toBe("The answer is 42.");
		expect(calls[0]).toEqual([
			{ role: "system", content: "be helpful" },
			{ role: "user", content: "what is the answer?" },
		]);
	});

	it("streams via completeStream when an onToken is provided, returning the stripped reply", async () => {
		const tokens: string[] = [];
		const client: ChatCompletionClient = {
			complete: async () => {
				throw new Error("should stream, not call complete");
			},
			completeStream: async (_request, onChunk) => {
				onChunk("<think>x</think>");
				onChunk("Hello");
				onChunk(" world");
				return { content: "<think>x</think>Hello world", finishReason: "stop", raw: {} };
			},
		};
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([{ role: "user", content: "hi" }], (delta) => tokens.push(delta));
		expect(tokens).toEqual(["<think>x</think>", "Hello", " world"]);
		expect(reply).toBe("Hello world");
	});

	it("falls back to non-streaming complete when no onToken is given", async () => {
		const { client, calls } = fakeClient("plain reply");
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([{ role: "user", content: "hi" }]);
		expect(reply).toBe("plain reply");
		expect(calls).toHaveLength(1);
	});

	it("salvages a runaway repeated-tail loop in the reply (§5.AA)", async () => {
		// A model that finished but looped its closing line — collapse the loop to its useful prefix.
		const sentence = "Done! The file config.json has been created.";
		const looped = Array(6).fill(sentence).join(" ");
		const { client } = fakeClient(looped);
		const deps = createChatModelDeps(client);
		const reply = await deps.complete([{ role: "user", content: "make the file" }]);
		const occurrences = reply.split(sentence).length - 1;
		expect(occurrences).toBeGreaterThanOrEqual(1);
		expect(occurrences).toBeLessThanOrEqual(2);
		expect(reply.length).toBeLessThan(looped.length);
	});

	it("summarizes the overflow via a system+user prompt", async () => {
		const { client, calls } = fakeClient("Summary: discussed the merge.");
		const deps = createChatModelDeps(client);
		const overflow: ChatMessage[] = [
			{ schemaVersion: 1, id: "1", role: "user", content: "about the merge", createdAt: 1 },
			{ schemaVersion: 1, id: "2", role: "assistant", content: "ok", createdAt: 2 },
		];
		const summary = await deps.summarize(overflow);
		expect(summary).toBe("Summary: discussed the merge.");
		expect(calls[0]?.[0]?.role).toBe("system");
		expect(calls[0]?.[1]?.content).toContain("user: about the merge");
		expect(calls[0]?.[1]?.content).toContain("assistant: ok");
	});
});

describe("createChatAgentModel + appendChatToolExchange", () => {
	function toolClient(): { client: ChatAgentCompletionClient; toolsOffered: number[] } {
		const toolsOffered: number[] = [];
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (_request, tools) => {
				toolsOffered.push(tools.length);
				return {
					content: "<think>plan</think>done",
					toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		return { client, toolsOffered };
	}

	const tools: LocalLlmToolDefinition[] = [{ name: "read_file", description: "read", parameters: { type: "object" } }];

	it("offers tools only when allowTools is set and strips reasoning from the text", async () => {
		const { client, toolsOffered } = toolClient();
		const model = createChatAgentModel(client, tools);
		const withTools = await model([{ role: "user", content: "go" }], true);
		expect(withTools.text).toBe("done");
		expect(withTools.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: { path: "a" } }]);
		await model([{ role: "user", content: "go" }], false);
		expect(toolsOffered).toEqual([1, 0]);
	});

	it("folds assistant text + tool results back as system notes", () => {
		const base: ChatPromptMessage[] = [{ role: "user", content: "go" }];
		const response: ChatAgentModelResponse = { text: "let me check", toolCalls: [] };
		const folded = appendChatToolExchange(base, response, [{ callId: "c1", content: "file body" }]);
		expect(folded).toEqual([
			{ role: "user", content: "go" },
			{ role: "assistant", content: "let me check" },
			{ role: "system", content: "Tool result (c1):\nfile body" },
		]);
		// No assistant note when the turn produced no text.
		const noText = appendChatToolExchange(base, { text: "", toolCalls: [] }, [{ callId: "c2", content: "x" }]);
		expect(noText.map((m) => m.role)).toEqual(["user", "system"]);
	});

	const SIX_TOOLS: LocalLlmToolDefinition[] = [
		"read_file",
		"list_dir",
		"get_board",
		"update_focus_chain",
		"create_card",
		"run_command",
	].map((name) => ({ name, description: name, parameters: { type: "object" } }));

	it("§5.AA: retries with a reduced tool set when the model returns no call but the instruction names a tool", async () => {
		const offeredCounts: number[] = [];
		let callIndex = 0;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (_request, toolsArg) => {
				offeredCounts.push(toolsArg.length);
				callIndex += 1;
				// First call (all 6 tools) → the model drowns and returns no tool call; the reduced retry → emits the call.
				if (callIndex === 1) {
					return {
						content: "I am not sure which tool to use here.",
						toolCalls: [],
						finishReason: "stop",
						raw: {},
					};
				}
				return {
					content: "",
					toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		const result = await model([{ role: "user", content: 'Use create_card to make a card titled "X".' }], true);
		expect(result.toolCalls).toEqual([{ id: "c1", name: "create_card", arguments: { title: "X" } }]);
		// First attempt offered all 6; the retry offered just the 1 referenced tool (grounded: phi works with 1).
		expect(offeredCounts).toEqual([6, 1]);
	});

	it("§5.AA: does NOT retry when the no-call reply references no tool by name (legit direct answer)", async () => {
		const offeredCounts: number[] = [];
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (_request, toolsArg) => {
				offeredCounts.push(toolsArg.length);
				return { content: "Here is my direct answer.", toolCalls: [], finishReason: "stop", raw: {} };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		const result = await model([{ role: "user", content: "Just explain how merging works." }], true);
		expect(result.text).toBe("Here is my direct answer.");
		expect(offeredCounts).toEqual([6]); // no anchor → no retry, no wasted calls
	});

	it("§5.AA truncation rung: re-asks with a larger token budget when a no-call turn hit finish:length", async () => {
		const budgets: (number | undefined)[] = [];
		let callIndex = 0;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (request, _tools) => {
				budgets.push(request.sampling?.maxTokens);
				callIndex += 1;
				// First call: truncated by the budget (reasoning model ran out) → no call. Retry with more budget lands it.
				if (callIndex === 1) {
					return { content: "", toolCalls: [], finishReason: "length", raw: {} };
				}
				return {
					content: "",
					toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { sampling: { temperature: 0, maxTokens: 1024 } });
		const result = await model([{ role: "user", content: "Use create_card to make a card." }], true);
		expect(result.toolCalls).toEqual([{ id: "c1", name: "create_card", arguments: { title: "X" } }]);
		// The retry used a BIGGER budget than the first attempt (3× = 3072).
		expect(budgets[0]).toBe(1024);
		expect(budgets[1]).toBe(3072);
	});

	it("§5.AA truncation rung: ESCALATES the budget once more when the first bump STILL truncated", async () => {
		const budgets: (number | undefined)[] = [];
		let callIndex = 0;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (request) => {
				budgets.push(request.sampling?.maxTokens);
				callIndex += 1;
				// A big reasoner truncates even at the ×3 bump (calls 1 AND 2); call 3 (escalated) lands the tool call.
				if (callIndex <= 2) {
					return { content: "", toolCalls: [], finishReason: "length", raw: {} };
				}
				return {
					content: "",
					toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { sampling: { temperature: 0, maxTokens: 1024 } });
		const result = await model([{ role: "user", content: "Use create_card to make a card." }], true);
		expect(result.toolCalls).toEqual([{ id: "c1", name: "create_card", arguments: { title: "X" } }]);
		// 1024 → 3072 (×3 bump) → 6144 (raisedTokenBudget escalation from 3072, ×2 under the 8192 ceiling).
		expect(budgets.slice(0, 3)).toEqual([1024, 3072, 6144]);
	});

	it("§5.AA truncation rung: DISABLES thinking on the retry for a model with a soft-switch (qwen3 /no_think)", async () => {
		const prompts: string[] = [];
		let callIndex = 0;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (request) => {
				prompts.push([...request.messages].reverse().find((m) => m.role === "user")?.content ?? "");
				callIndex += 1;
				if (callIndex === 1) {
					return { content: "", toolCalls: [], finishReason: "length", raw: {} };
				}
				return {
					content: "",
					toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen/qwen3-8b" });
		await model([{ role: "user", content: "Use create_card to make a card." }], true);
		// The truncation retry appended the /no_think switch (root-cause fix); the first attempt did not.
		expect(prompts[0]).toBe("Use create_card to make a card.");
		expect(prompts[1]).toBe("Use create_card to make a card. /no_think");
	});

	it("§5.AA truncation rung: ALSO fires when reasoningTokens ate ≥90% of the budget (no exact finish:length)", async () => {
		let callIndex = 0;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async () => {
				callIndex += 1;
				// finish_reason is NOT "length" (endpoint reported "stop"), but reasoning consumed ~95% of the 1024 budget
				// with no call — the §5.AN reasoning-starvation case. The rung should still fire and recover on retry.
				if (callIndex === 1) {
					return { content: "", toolCalls: [], finishReason: "stop", reasoningTokens: 980, raw: {} };
				}
				return {
					content: "",
					toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { sampling: { temperature: 0, maxTokens: 1024 } });
		const result = await model([{ role: "user", content: "Use create_card to make a card." }], true);
		expect(result.toolCalls).toEqual([{ id: "c1", name: "create_card", arguments: { title: "X" } }]);
		expect(callIndex).toBe(2); // the rung fired despite finish:stop
	});

	it("§5.AA truncation rung: does NOT fire when the no-call turn finished normally (finish:stop)", async () => {
		let calls = 0;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async () => {
				calls += 1;
				return { content: "Here is a direct answer.", toolCalls: [], finishReason: "stop", raw: {} };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		await model([{ role: "user", content: "Just explain how merging works." }], true);
		// No anchor + a clean stop ⇒ only the single attempt (no truncation retry, no reduction).
		expect(calls).toBe(1);
	});

	it("§5.AA prompt-variation rung: recovers a call by re-phrasing the instruction (before the forced-schema resort)", async () => {
		const original = 'Use create_card to make a card titled "X".';
		let rephrasedPrompt: string | null = null;
		let constrainedCalled = false;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (request, _tools) => {
				const lastUser = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
				// The original + every reduction retry (same text, fewer tools) come up empty; only a RE-PHRASED variant
				// (text differs from the original) lands the call — proving the prompt-variation rung is what recovered it.
				if (lastUser === original) {
					return { content: "I'm not sure.", toolCalls: [], finishReason: "stop", raw: {} };
				}
				rephrasedPrompt = lastUser;
				return {
					content: "",
					toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
			complete: async () => {
				constrainedCalled = true;
				return { content: "{}" };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		const result = await model([{ role: "user", content: original }], true);
		expect(result.toolCalls).toEqual([{ id: "c1", name: "create_card", arguments: { title: "X" } }]);
		// The recovering attempt's prompt was a re-FRAMED variant that still preserves the verbatim instruction.
		expect(rephrasedPrompt).not.toBeNull();
		expect(rephrasedPrompt).toContain(original);
		// The natural-path recovery means the forced-schema last resort never had to fire.
		expect(constrainedCalled).toBe(false);
	});

	it("§5.AA prompt-variation rung: does NOT fire when the instruction names no tool (no wasted re-phrasing)", async () => {
		const prompts: string[] = [];
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (request) => {
				prompts.push([...request.messages].reverse().find((m) => m.role === "user")?.content ?? "");
				return { content: "Merging combines branches.", toolCalls: [], finishReason: "stop", raw: {} };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		await model([{ role: "user", content: "Just explain how merging works." }], true);
		// No anchor ⇒ only the single original attempt, no variant re-asks.
		expect(prompts).toEqual(["Just explain how merging works."]);
	});

	it("§5.AA constrained rung: FORCES a parseable call when the model never emits one but a tool is named", async () => {
		let constrainedFormat: unknown = null;
		const client: ChatAgentCompletionClient = {
			// The model never emits a structured call and never narrates one (no recovery upstream).
			completeWithTools: async () => ({
				content: "Hmm, I'll think about it.",
				toolCalls: [],
				finishReason: "stop",
				raw: {},
			}),
			// The constrained-decoding rung forces a JSON tool call.
			complete: async (request) => {
				constrainedFormat = request.format;
				return { content: '{"tool":"create_card","arguments":{"title":"X"}}' };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		const result = await model([{ role: "user", content: 'Use create_card to make a card titled "X".' }], true);
		expect(result.toolCalls).toEqual([expect.objectContaining({ name: "create_card", arguments: { title: "X" } })]);
		expect(result.text).toBe("");
		// The rung used response_format json_schema constrained to the anchored tool.
		expect(constrainedFormat).toMatchObject({ jsonSchema: { name: "klein_tool_call" } });
	});

	it("§5.AA constrained rung: EXCLUDES already-executed tools so a stalled chain is steered to the next step", async () => {
		let forcedEnum: unknown = null;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async () => ({ content: "All done!", toolCalls: [], finishReason: "stop", raw: {} }),
			complete: async (request) => {
				forcedEnum = (
					request.format?.jsonSchema?.schema as { properties?: { tool?: { enum?: string[] } } } | undefined
				)?.properties?.tool?.enum;
				return { content: '{"tool":"create_card","arguments":{"title":"X"}}' };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		// The instruction names read_file + create_card; read_file is already used this run → it must be excluded.
		const result = await model(
			[{ role: "user", content: "First read_file FACT.txt, then create_card titled X." }],
			true,
			undefined,
			["read_file"],
		);
		expect(forcedEnum).toEqual(["create_card"]); // read_file dropped, steering to the undone step
		expect(result.toolCalls).toEqual([expect.objectContaining({ name: "create_card" })]);
	});

	it("§5.AB force-advance: with forceToolCall + a REPEATED real call, forces the next OFFERED-unused tool (json_schema)", async () => {
		// The §5.AB stuck-branch path: the model returns a real call (not empty), but the loop asks the adapter to FORCE
		// because that call was an already-done repeat. The instruction only named read_file (already used), so the anchor
		// is exhausted — the fallback must steer to an offered-but-unused tool. On a NON-reasoning model the json_schema
		// rung does the forcing.
		let forcedEnum: string[] | undefined;
		const client: ChatAgentCompletionClient = {
			// The "primary" turn returns a repeated read_file (a real call) — the loop, not the adapter, detects the repeat
			// and re-invokes with forceToolCall=true; here we just model that forced invocation directly.
			completeWithTools: async () => ({
				content: "",
				toolCalls: [{ id: "again", name: "read_file", arguments: { path: "FACT.txt" } }],
				finishReason: "tool_calls",
				raw: {},
			}),
			complete: async (request) => {
				forcedEnum = (
					request.format?.jsonSchema?.schema as { properties?: { tool?: { enum?: string[] } } } | undefined
				)?.properties?.tool?.enum;
				return { content: '{"tool":"run_command","arguments":{"command":"cat FACT.txt"}}' };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen2.5-coder-14b" });
		// Instruction names only read_file; read_file is already used → anchor exhausted → steer to an offered-unused tool.
		const result = await model(
			[{ role: "user", content: "Use read_file to read FACT.txt." }],
			true,
			undefined,
			["read_file"],
			/* forceToolCall */ true,
		);
		// The forced schema excluded read_file and offered the remaining un-used tools (steering to the next step).
		expect(forcedEnum).toBeDefined();
		expect(forcedEnum).not.toContain("read_file");
		expect(forcedEnum).toContain("run_command");
		expect(result.toolCalls).toEqual([expect.objectContaining({ name: "run_command" })]);
	});

	it("§5.AB force-advance: on a REASONING model the native tool_choice:'required' channel forces BY DEFAULT (no flag)", async () => {
		// The correctness fix: reasoning models dead-end on json_schema, so the force-advance path must use the native
		// channel by DEFAULT (no NKLEIN_NATIVE_FORCE_TOOL_CALL). The flag is NOT set here.
		const savedFlag = process.env.NKLEIN_NATIVE_FORCE_TOOL_CALL;
		delete process.env.NKLEIN_NATIVE_FORCE_TOOL_CALL;
		try {
			const toolChoices: (string | undefined)[] = [];
			const requiredToolNames: string[][] = [];
			let jsonSchemaCalled = false;
			const client: ChatAgentCompletionClient = {
				completeWithTools: async (_request, toolsArg, opts) => {
					toolChoices.push(opts?.toolChoice);
					if (opts?.toolChoice === "required") {
						requiredToolNames.push(toolsArg.map((t) => t.name));
						return {
							content: "",
							toolCalls: [{ id: "native", name: "run_command", arguments: { command: "cat FACT.txt" } }],
							finishReason: "tool_calls",
							raw: {},
						};
					}
					// The (modeled) primary turn: a repeated real call the loop would dedupe.
					return {
						content: "",
						toolCalls: [{ id: "again", name: "read_file", arguments: { path: "FACT.txt" } }],
						finishReason: "tool_calls",
						raw: {},
					};
				},
				complete: async () => {
					jsonSchemaCalled = true;
					return { content: '{"tool":"run_command","arguments":{}}' };
				},
			};
			const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen3.5-9b-mlx" });
			const result = await model(
				[{ role: "user", content: "Use read_file to read FACT.txt." }],
				true,
				undefined,
				["read_file"],
				/* forceToolCall */ true,
			);
			// Native channel forced the next step; json_schema (which dead-ends on reasoning models) was never reached.
			expect(toolChoices).toContain("required");
			expect(jsonSchemaCalled).toBe(false);
			expect(result.toolCalls).toEqual([
				{ id: "native", name: "run_command", arguments: { command: "cat FACT.txt" } },
			]);
			// §5.AB Fix 5: the forced native call was offered exactly ONE tool (the next undone step) — probe-proven
			// deterministic on qwopus3.6-27b (a multi-tool required call let it narrate the wrong, already-done tool).
			expect(requiredToolNames).toHaveLength(1);
			expect(requiredToolNames[0]).toHaveLength(1);
		} finally {
			if (savedFlag === undefined) {
				delete process.env.NKLEIN_NATIVE_FORCE_TOOL_CALL;
			} else {
				process.env.NKLEIN_NATIVE_FORCE_TOOL_CALL = savedFlag;
			}
		}
	});

	it("§5.AB force-advance: drives the native call from a TRIMMED context (drops narration + nudge chatter, keeps facts)", async () => {
		// Root cause on qwopus3.6-27b: the running transcript's repeated first-tool turns + stacked nudges fixate the model
		// so hard that even required-forcing returns the done tool. The force must use a CLEAN context. This asserts the
		// messages sent to the forced (required) call: leading system framing + the original user instruction + the
		// tool-RESULT facts + a next-step directive — with the model's narration turns and the loop's `incomplete-` nudge
		// notes DROPPED.
		let forcedMessages: LocalLlmChatMessage[] = [];
		const client: ChatAgentCompletionClient = {
			completeWithTools: async (request, _tools, opts) => {
				if (opts?.toolChoice === "required") {
					forcedMessages = [...request.messages];
					return {
						content: "",
						toolCalls: [{ id: "n", name: "run_command", arguments: { command: "cat FACT.txt" } }],
						finishReason: "tool_calls",
						raw: {},
					};
				}
				// Primary turn: a repeated read_file the loop would dedupe (drives the force path).
				return {
					content: "",
					toolCalls: [{ id: "again", name: "read_file", arguments: { path: "FACT.txt" } }],
					finishReason: "tool_calls",
					raw: {},
				};
			},
			complete: async () => ({ content: "{}" }),
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwopus3.6-27b-v2-mlx" });
		// A realistic poisoned wire: system framing, the user instruction, a real tool-result fact, a REPEATED-call nudge,
		// an assistant narration turn, and an `incomplete-` nudge note.
		const poisonedWire: ChatPromptMessage[] = [
			{ role: "system", content: "You are a workspace agent. Tools: read_file, run_command, create_card." },
			{ role: "user", content: "First read_file FACT.txt, then run_command cat FACT.txt, then create_card." },
			{ role: "system", content: "Tool result (call_1):\nECHO-MARKER-7777-XYZ" },
			{ role: "assistant", content: "<tool_code>read_file(FACT.txt)</tool_code>" },
			{ role: "system", content: "Tool result (incomplete-1):\nYou have NOT yet completed all the required steps." },
		];
		const result = await model(poisonedWire, true, undefined, ["read_file"], /* forceToolCall */ true);
		expect(result.toolCalls).toEqual([{ id: "n", name: "run_command", arguments: { command: "cat FACT.txt" } }]);
		// The forced call's context was reshaped for the fixation-prone model:
		const roles = forcedMessages.map((m) => m.role);
		const contents = forcedMessages.map((m) => m.content);
		expect(roles).not.toContain("assistant"); // the narration turn was dropped
		expect(contents).toContain("You are a workspace agent. Tools: read_file, run_command, create_card."); // framing kept
		expect(contents.some((c) => c.includes("ECHO-MARKER-7777-XYZ"))).toBe(true); // the FACT (tool result) kept
		expect(contents.some((c) => c.includes("incomplete-1"))).toBe(false); // the nudge note DROPPED
		// CRITICAL (probe-verified on qwopus3.6-27b): the original instruction is NOT left as the USER turn — as an active
		// numbered task the model re-reads it and restarts at step 1 (read_file) even under required-forcing. It is instead
		// demoted to a SYSTEM reference note (so the next step's exact args are still available), and the USER turn is a
		// fresh single-step ask for just the next tool.
		const userTurns = forcedMessages.filter((m) => m.role === "user");
		expect(userTurns).toHaveLength(1);
		expect(userTurns[0]?.content).not.toContain("First read_file FACT.txt"); // the instruction is not the user turn
		expect(userTurns[0]?.content).toContain("run_command"); // the single-step ask names the next tool
		expect(userTurns[0]?.content.toLowerCase()).toContain("do not repeat");
		// The original instruction survives as a system REFERENCE (carries the next step's args).
		expect(contents.some((c) => c.includes("For reference") && c.includes("First read_file FACT.txt"))).toBe(true);
	});

	it("§5.AB force-advance: does NOT engage without forceToolCall — a lone repeated real call is left as-is (happy path)", async () => {
		// Without the loop's forceToolCall signal, a turn that returns a real (even repeated) call is NOT diverted into the
		// forcing rung — the adapter returns the call untouched, exactly as before §5.AB. (The loop handles the dedupe.)
		let constrainedCalled = false;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async () => ({
				content: "",
				toolCalls: [{ id: "again", name: "read_file", arguments: { path: "FACT.txt" } }],
				finishReason: "tool_calls",
				raw: {},
			}),
			complete: async () => {
				constrainedCalled = true;
				return { content: "{}" };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen2.5-coder-14b" });
		const result = await model(
			[{ role: "user", content: "Use read_file to read FACT.txt." }],
			true,
			undefined,
			["read_file"],
			// forceToolCall omitted (undefined)
		);
		expect(constrainedCalled).toBe(false);
		expect(result.toolCalls).toEqual([{ id: "again", name: "read_file", arguments: { path: "FACT.txt" } }]);
	});

	it("§5.AA constrained rung: does NOT fire when no tool is named (no fabricated call on a prose answer)", async () => {
		let constrainedCalled = false;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async () => ({
				content: "Merging combines branches.",
				toolCalls: [],
				finishReason: "stop",
				raw: {},
			}),
			complete: async () => {
				constrainedCalled = true;
				return { content: '{"tool":"create_card","arguments":{}}' };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		const result = await model([{ role: "user", content: "Just explain how merging works." }], true);
		expect(constrainedCalled).toBe(false);
		expect(result.text).toBe("Merging combines branches.");
		expect(result.toolCalls).toEqual([]);
	});

	it("§5.AA constrained rung: skipped when a structured/recovered call already exists (no wasted forcing)", async () => {
		let constrainedCalled = false;
		const client: ChatAgentCompletionClient = {
			completeWithTools: async () => ({
				content: "",
				toolCalls: [{ id: "c1", name: "create_card", arguments: { title: "X" } }],
				finishReason: "tool_calls",
				raw: {},
			}),
			complete: async () => {
				constrainedCalled = true;
				return { content: "{}" };
			},
		};
		const model = createChatAgentModel(client, SIX_TOOLS);
		const result = await model([{ role: "user", content: "Use create_card to make a card." }], true);
		expect(constrainedCalled).toBe(false);
		expect(result.toolCalls).toEqual([{ id: "c1", name: "create_card", arguments: { title: "X" } }]);
	});

	describe("§5.AA/§5.AN native-force tool-call lever (NKLEIN_NATIVE_FORCE_TOOL_CALL)", () => {
		const FLAG = "NKLEIN_NATIVE_FORCE_TOOL_CALL";
		let savedFlag: string | undefined;
		beforeEach(() => {
			savedFlag = process.env[FLAG];
			delete process.env[FLAG];
		});
		afterEach(() => {
			if (savedFlag === undefined) {
				delete process.env[FLAG];
			} else {
				process.env[FLAG] = savedFlag;
			}
		});

		/**
		 * A fake that records the `opts` passed to every `completeWithTools` call (so a test can assert the native lever's
		 * `toolChoice:"required"`), and whether the json_schema `complete` rung fired. The primary tools-offered turn always
		 * comes up empty (drives the ladder to the constrained rung); a `forcedCall` (when set) is returned ONLY for a
		 * `toolChoice:"required"` call, so the native channel is what recovers it.
		 */
		function forcingClient(opts: { forcedCall?: boolean }): {
			client: ChatAgentCompletionClient;
			toolChoices: (string | undefined)[];
			jsonSchemaCalled: () => boolean;
		} {
			const toolChoices: (string | undefined)[] = [];
			let jsonSchemaCalled = false;
			const client: ChatAgentCompletionClient = {
				completeWithTools: async (_request, _tools, callOpts) => {
					toolChoices.push(callOpts?.toolChoice);
					if (callOpts?.toolChoice === "required" && opts.forcedCall) {
						return {
							content: "",
							toolCalls: [{ id: "native1", name: "create_card", arguments: { title: "X" } }],
							finishReason: "tool_calls",
							raw: {},
						};
					}
					// Every non-forced (auto) turn comes up empty ⇒ the ladder falls to the constrained rung.
					return { content: "Hmm, let me think.", toolCalls: [], finishReason: "stop", raw: {} };
				},
				complete: async () => {
					jsonSchemaCalled = true;
					return { content: '{"tool":"create_card","arguments":{"title":"JSON"}}' };
				},
			};
			return { client, toolChoices, jsonSchemaCalled: () => jsonSchemaCalled };
		}

		const NAMED = 'Use create_card to make a card titled "X".';

		it("flag OFF ⇒ constrained path is UNCHANGED (json_schema rung fires; native never forced)", async () => {
			// No env flag set (cleared in beforeEach) — the reasoning modelId must NOT trigger the native branch.
			const { client, toolChoices, jsonSchemaCalled } = forcingClient({ forcedCall: true });
			const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen3.5-9b-mlx" });
			const result = await model([{ role: "user", content: NAMED }], true);
			// The json_schema rung recovered the call (parsed from `complete`), exactly as before the lever existed.
			expect(jsonSchemaCalled()).toBe(true);
			expect(result.toolCalls).toEqual([
				expect.objectContaining({ name: "create_card", arguments: { title: "JSON" } }),
			]);
			// completeWithTools was NEVER called with toolChoice:"required" — every call used the default (auto ⇒ undefined).
			expect(toolChoices.every((c) => c === undefined)).toBe(true);
		});

		it("flag ON + reasoning modelId + no primary call ⇒ forces via completeWithTools({toolChoice:'required'}), uses its toolCalls", async () => {
			process.env[FLAG] = "1";
			const { client, toolChoices, jsonSchemaCalled } = forcingClient({ forcedCall: true });
			const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen3.5-9b-mlx" });
			const result = await model([{ role: "user", content: NAMED }], true);
			// The native tool_calls channel supplied the call — the json_schema rung was never reached.
			expect(result.toolCalls).toEqual([{ id: "native1", name: "create_card", arguments: { title: "X" } }]);
			expect(result.text).toBe("");
			expect(jsonSchemaCalled()).toBe(false);
			expect(toolChoices).toContain("required");
		});

		it("flag ON + reasoning modelId but native yields NO call ⇒ falls through to the EXISTING json_schema path (strictly additive)", async () => {
			process.env[FLAG] = "1";
			// forcedCall:false ⇒ even the required call comes up empty, so the native branch must fall through, not fail.
			const { client, toolChoices, jsonSchemaCalled } = forcingClient({ forcedCall: false });
			const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen3.5-9b-mlx" });
			const result = await model([{ role: "user", content: NAMED }], true);
			expect(toolChoices).toContain("required"); // native was attempted
			expect(jsonSchemaCalled()).toBe(true); // …then fell through to json_schema
			expect(result.toolCalls).toEqual([
				expect.objectContaining({ name: "create_card", arguments: { title: "JSON" } }),
			]);
		});

		it("flag ON + NON-reasoning modelId ⇒ json_schema path (native branch skipped)", async () => {
			process.env[FLAG] = "1";
			const { client, toolChoices, jsonSchemaCalled } = forcingClient({ forcedCall: true });
			const model = createChatAgentModel(client, SIX_TOOLS, { modelId: "qwen2.5-coder-14b" });
			const result = await model([{ role: "user", content: NAMED }], true);
			// Non-reasoning ⇒ the flag does nothing; the classic json_schema rung runs and native is never forced.
			expect(jsonSchemaCalled()).toBe(true);
			expect(result.toolCalls).toEqual([
				expect.objectContaining({ name: "create_card", arguments: { title: "JSON" } }),
			]);
			expect(toolChoices.every((c) => c === undefined)).toBe(true);
		});
	});
});
