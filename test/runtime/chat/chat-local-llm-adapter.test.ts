import { describe, expect, it } from "vitest";
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
});
